import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import {
  DOCX_MEDIA_TYPE,
  extractResumeText,
  MAX_DOCX_PART_BYTES,
  MAX_RESUME_FILE_BYTES,
  MAX_RESUME_PDF_PAGES,
  MAX_RESUME_TEXT_CHARACTERS,
  normalizeResumeText,
  PDF_MEDIA_TYPE,
  RESUME_PARSER_RELEASES,
} from "./extract-resume.ts";

function pdfString(value: string): string {
  return value.replace(/([\\()])/g, "\\$1").replace(/\n/g, ") Tj T* (");
}

function createPdf(pageTexts: readonly string[]): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const contentObjectNumbers: number[] = [];
  let nextObjectNumber = 3;
  for (let index = 0; index < pageTexts.length; index += 1) {
    pageObjectNumbers.push(nextObjectNumber++);
    contentObjectNumbers.push(nextObjectNumber++);
  }
  const fontObjectNumber = nextObjectNumber;
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Count ${pageTexts.length} /Kids [${pageObjectNumbers
    .map((number) => `${number} 0 R`)
    .join(" ")}] >>`;
  for (let index = 0; index < pageTexts.length; index += 1) {
    const pageObjectNumber = pageObjectNumbers[index]!;
    const contentObjectNumber = contentObjectNumbers[index]!;
    objects[pageObjectNumber - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> ` +
      `/Contents ${contentObjectNumber} 0 R >>`;
    const content = pageTexts[index]
      ? `BT /F1 12 Tf 14 TL 72 720 Td (${pdfString(pageTexts[index]!)}) Tj ET`
      : "";
    objects[contentObjectNumber - 1] =
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  }
  objects[fontObjectNumber - 1] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let body = "%PDF-1.7\n% generated test fixture\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${offsets[index]!.toString().padStart(10, "0")} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}

async function createDocx(
  paragraphs: readonly string[],
  mainDocumentContentType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  compression: "DEFLATE" | "STORE" = "DEFLATE",
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${mainDocumentContentType}"/>` +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  const body = paragraphs
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t>${paragraph
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</w:t></w:r></w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression });
}

function expectFailure(
  result: Awaited<ReturnType<typeof extractResumeText>>,
  code: string,
): void {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error(`Expected ${code}.`);
  assert.equal(result.error.code, code);
  assert.equal(result.error.retryable, false);
}

test("extracts and hashes a bounded text-based PDF deterministically", async () => {
  const bytes = createPdf([
    "Jane Doe\nSenior Product Engineer\nBuilt reliable systems for healthcare teams.",
  ]);
  const first = await extractResumeText({
    bytes,
    filename: "jane-resume.pdf",
    declaredMediaType: "application/pdf; charset=binary",
  });
  const second = await extractResumeText({
    bytes,
    filename: "jane-resume.pdf",
    declaredMediaType: PDF_MEDIA_TYPE,
  });

  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (!first.ok) return;
  assert.equal(first.value.source.mediaType, PDF_MEDIA_TYPE);
  assert.equal(first.value.extraction.pageCount, 1);
  assert.equal(first.value.extraction.parserRelease, RESUME_PARSER_RELEASES[PDF_MEDIA_TYPE]);
  assert.match(first.value.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(first.value.extraction.sha256, /^[a-f0-9]{64}$/);
  assert.match(first.value.extraction.normalizedText, /Jane Doe/);
  assert.match(first.value.extraction.normalizedText, /reliable systems/);
});

test("extracts normalized text from a generated DOCX and preserves source provenance", async () => {
  const bytes = await createDocx([
    "Jane Doe",
    "Senior Product Engineer",
    "Built reliable systems for healthcare teams.",
  ]);
  const result = await extractResumeText({
    bytes,
    filename: "jane-resume.DOCX",
    declaredMediaType: DOCX_MEDIA_TYPE,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.source.byteSize, bytes.byteLength);
  assert.equal(result.value.extraction.pageCount, null);
  assert.equal(result.value.extraction.parserRelease, RESUME_PARSER_RELEASES[DOCX_MEDIA_TYPE]);
  assert.equal(
    result.value.extraction.normalizedText,
    "Jane Doe\n\nSenior Product Engineer\n\nBuilt reliable systems for healthcare teams.",
  );
  assert.equal(
    result.value.extraction.characterCount,
    result.value.extraction.normalizedText.length,
  );
});

test("normalizes line endings, Unicode spaces, controls, and excessive blank lines", () => {
  assert.equal(
    normalizeResumeText("  Jane\u00a0Doe\r\n\r\n\r\nBuilds\tthings\u0000  "),
    "Jane Doe\n\nBuilds things",
  );
});

test("rejects empty, oversized, unsupported, mislabeled, and path-like files before parsing", async () => {
  expectFailure(
    await extractResumeText({ bytes: new Uint8Array(), filename: "resume.pdf", declaredMediaType: PDF_MEDIA_TYPE }),
    "EMPTY_FILE",
  );
  expectFailure(
    await extractResumeText({
      bytes: new Uint8Array(MAX_RESUME_FILE_BYTES + 1),
      filename: "resume.pdf",
      declaredMediaType: PDF_MEDIA_TYPE,
    }),
    "FILE_TOO_LARGE",
  );
  expectFailure(
    await extractResumeText({ bytes: new Uint8Array([1]), filename: "resume.txt", declaredMediaType: "text/plain" }),
    "UNSUPPORTED_MEDIA_TYPE",
  );
  expectFailure(
    await extractResumeText({ bytes: createPdf(["A valid PDF with enough text for extraction."]), filename: "resume.docx", declaredMediaType: PDF_MEDIA_TYPE }),
    "FILE_EXTENSION_MISMATCH",
  );
  expectFailure(
    await extractResumeText({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), filename: "resume.pdf", declaredMediaType: PDF_MEDIA_TYPE }),
    "CONTENT_SIGNATURE_MISMATCH",
  );
  expectFailure(
    await extractResumeText({ bytes: createPdf(["A valid PDF with enough text for extraction."]), filename: "../resume.pdf", declaredMediaType: PDF_MEDIA_TYPE }),
    "INVALID_FILENAME",
  );
});

test("rejects PDFs beyond the page limit and sends image-only PDFs to the future OCR path", async () => {
  expectFailure(
    await extractResumeText({
      bytes: createPdf(Array.from({ length: MAX_RESUME_PDF_PAGES + 1 }, () => "Resume page with text.")),
      filename: "long-resume.pdf",
      declaredMediaType: PDF_MEDIA_TYPE,
    }),
    "PDF_PAGE_LIMIT_EXCEEDED",
  );
  expectFailure(
    await extractResumeText({
      bytes: createPdf([""]),
      filename: "scanned-resume.pdf",
      declaredMediaType: PDF_MEDIA_TYPE,
    }),
    "OCR_REQUIRED",
  );
});

test("rejects non-DOCX ZIP files, blank DOCX files, and excessive extracted text", async () => {
  const genericZip = new JSZip();
  genericZip.file("notes.txt", "This is not a Word document.");
  expectFailure(
    await extractResumeText({
      bytes: await createDocx(
        ["This is a macro-enabled package renamed with a DOCX extension."],
        "application/vnd.ms-word.document.macroEnabled.main+xml",
      ),
      filename: "renamed-macro-document.docx",
      declaredMediaType: DOCX_MEDIA_TYPE,
    }),
    "CONTENT_SIGNATURE_MISMATCH",
  );
  expectFailure(
    await extractResumeText({
      bytes: await genericZip.generateAsync({ type: "uint8array" }),
      filename: "resume.docx",
      declaredMediaType: DOCX_MEDIA_TYPE,
    }),
    "MALFORMED_DOCUMENT",
  );
  expectFailure(
    await extractResumeText({
      bytes: await createDocx([]),
      filename: "blank.docx",
      declaredMediaType: DOCX_MEDIA_TYPE,
    }),
    "NO_EXTRACTABLE_TEXT",
  );
  expectFailure(
    await extractResumeText({
      bytes: await createDocx(
        ["A".repeat(MAX_RESUME_TEXT_CHARACTERS + 1)],
        undefined,
        "STORE",
      ),
      filename: "oversized-text.docx",
      declaredMediaType: DOCX_MEDIA_TYPE,
    }),
    "TEXT_LIMIT_EXCEEDED",
  );
});

test("rejects a valid highly compressible DOCX before document parsing", async () => {
  const bytes = await createDocx(Array.from({ length: 20_000 }, () => ""));
  assert.ok(bytes.byteLength < 100_000);

  expectFailure(
    await extractResumeText({
      bytes,
      filename: "highly-compressible.docx",
      declaredMediaType: DOCX_MEDIA_TYPE,
    }),
    "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED",
  );
});

test("rejects a DOCX part whose declared expansion exceeds the archive bound", async () => {
  const bytes = await createDocx(["Enough text to otherwise form a valid resume document."]);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const centralOffset = Buffer.from(bytes).indexOf(signature);
  assert.notEqual(centralOffset, -1);
  const mutated = Uint8Array.from(bytes);
  const view = new DataView(mutated.buffer, mutated.byteOffset, mutated.byteLength);
  view.setUint32(centralOffset + 24, MAX_DOCX_PART_BYTES + 1, true);

  expectFailure(
    await extractResumeText({
      bytes: mutated,
      filename: "expanded.docx",
      declaredMediaType: DOCX_MEDIA_TYPE,
    }),
    "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED",
  );
});
