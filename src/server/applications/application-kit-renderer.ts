import { createHash } from "node:crypto";

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";

import type { ApplicationDraftingProposal } from "../../domain/application-drafting.ts";
import type { ApplicationArtifactVariant } from "../../domain/application-kit.ts";
import {
  DOCX_MEDIA_TYPE,
  extractResumeText,
  normalizeResumeText,
  PDF_MEDIA_TYPE,
} from "../resume/extract-resume.ts";
import type { ApplicationKitExactFacts } from "./application-kit-facts.ts";

export const APPLICATION_ARTIFACT_RENDERER_RELEASE = "roledawn-application-kit/2";

export type RenderedApplicationKitArtifact = Readonly<{
  kind: "RESUME" | "COVER_LETTER" | "OTHER";
  variant: ApplicationArtifactVariant;
  displayName: string;
  mimeType: typeof PDF_MEDIA_TYPE | typeof DOCX_MEDIA_TYPE;
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  rendererRelease: typeof APPLICATION_ARTIFACT_RENDERER_RELEASE;
  qaStatus: "PASSED";
}>;

function safeFilePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "application";
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdfBytes(build: (document: PDFKit.PDFDocument) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "LETTER", margins: { top: 48, right: 54, bottom: 48, left: 54 } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    build(document);
    document.end();
  });
}

function addPdfHeader(document: PDFKit.PDFDocument, facts: ApplicationKitExactFacts): void {
  document.font("Helvetica-Bold").fontSize(18).fillColor("#0b1739")
    .text(facts.legalName ?? "Candidate", { align: "center" });
  if (facts.contactLines.length > 0) {
    document.moveDown(0.25).font("Helvetica").fontSize(8.5).fillColor("#334155")
      .text(facts.contactLines.join("  •  "), { align: "center" });
  }
  document.moveDown(0.8).strokeColor("#cbd5e1").lineWidth(0.75)
    .moveTo(54, document.y).lineTo(558, document.y).stroke().moveDown(0.7);
}

function addResumeTextToPdf(document: PDFKit.PDFDocument, text: string): void {
  for (const line of normalizeResumeText(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      document.moveDown(0.35);
      continue;
    }
    const heading = trimmed.length <= 80 && (
      /^[A-Z][A-Z &/+-]{2,}$/u.test(trimmed) || trimmed.endsWith(":"));
    if (heading && document.y > document.page.height - document.page.margins.bottom - 42) document.addPage();
    document.font(heading ? "Helvetica-Bold" : "Helvetica")
      .fontSize(heading ? 10.5 : 9.25)
      .fillColor(heading ? "#0b1739" : "#111827")
      .text(trimmed, { lineGap: heading ? 2 : 1.5 });
    if (heading) document.moveDown(0.2);
  }
}

function resumeDocx(text: string, facts: ApplicationKitExactFacts): Document {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: facts.legalName ?? "Candidate", bold: true, size: 34, color: "0B1739" })],
      spacing: { after: 80 },
    }),
    ...(facts.contactLines.length > 0
      ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: facts.contactLines.join(" • "), size: 17, color: "475569" })],
          spacing: { after: 180 },
        })]
      : []),
  ];
  for (const line of normalizeResumeText(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    const heading = trimmed.length <= 80 && (
      /^[A-Z][A-Z &/+-]{2,}$/u.test(trimmed) || trimmed.endsWith(":"));
    paragraphs.push(new Paragraph({
      ...(heading ? { heading: HeadingLevel.HEADING_2 } : {}),
      children: [new TextRun({ text: trimmed, bold: heading, size: heading ? 21 : 18 })],
      spacing: { after: heading ? 70 : 45, line: 240 },
    }));
  }
  return new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
      },
      children: paragraphs,
    }],
  });
}

function coverLetterDocx(input: Readonly<{
  proposal: ApplicationDraftingProposal;
  facts: ApplicationKitExactFacts;
}>): Document {
  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.facts.legalName ?? "Candidate", bold: true, size: 34, color: "0B1739" })],
      spacing: { after: 80 },
    }),
    ...(input.facts.contactLines.length > 0
      ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: input.facts.contactLines.join(" • "), size: 18, color: "475569" })],
          spacing: { after: 260 },
        })]
      : []),
    new Paragraph({
      children: [new TextRun({ text: `Hiring Team\n${input.proposal.target.employerName}\nRe: ${input.proposal.target.title}`, size: 22 })],
      spacing: { after: 240 },
    }),
    new Paragraph({ children: [new TextRun({ text: "Dear Hiring Team,", size: 22 })], spacing: { after: 200 } }),
    ...input.proposal.coverLetter.paragraphs.map((paragraph) => new Paragraph({
      children: [new TextRun({ text: paragraph.text, size: 22 })],
      spacing: { after: 220, line: 300 },
    })),
    new Paragraph({
      children: [new TextRun({ text: `Sincerely,\n${input.facts.legalName ?? "Candidate"}`, size: 22 })],
      spacing: { before: 120 },
    }),
  ];
  return new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: paragraphs,
    }],
  });
}

function expectedTokenCoverage(expected: string, actual: string): number {
  const expectedTokens = new Set(
    normalizeResumeText(expected).toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}+.#-]{2,}/gu) ?? [],
  );
  if (expectedTokens.size === 0) return 0;
  const actualTokens = new Set(
    normalizeResumeText(actual).toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}+.#-]{2,}/gu) ?? [],
  );
  return [...expectedTokens].filter((token) => actualTokens.has(token)).length / expectedTokens.size;
}

async function checkedArtifact(input: Readonly<{
  kind: RenderedApplicationKitArtifact["kind"];
  variant: ApplicationArtifactVariant;
  displayName: string;
  mimeType: RenderedApplicationKitArtifact["mimeType"];
  bytes: Uint8Array;
  expectedText: string;
  maxPages?: number;
}>): Promise<RenderedApplicationKitArtifact> {
  const extraction = await extractResumeText({
    bytes: input.bytes,
    filename: input.displayName,
    declaredMediaType: input.mimeType,
  });
  if (!extraction.ok) throw new Error(`APPLICATION_ARTIFACT_QA_${extraction.error.code}`);
  if (input.maxPages !== undefined && (extraction.value.extraction.pageCount === null
    || extraction.value.extraction.pageCount > input.maxPages)) throw new Error("APPLICATION_ARTIFACT_QA_PAGE_LIMIT");
  if (expectedTokenCoverage(input.expectedText, extraction.value.extraction.normalizedText) < 0.95) {
    throw new Error("APPLICATION_ARTIFACT_QA_TEXT_MISMATCH");
  }
  return Object.freeze({
    kind: input.kind,
    variant: input.variant,
    displayName: input.displayName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    byteSize: input.bytes.byteLength,
    sha256: sha256(input.bytes),
    rendererRelease: APPLICATION_ARTIFACT_RENDERER_RELEASE,
    qaStatus: "PASSED",
  });
}

export async function renderApplicationKit(input: Readonly<{
  proposal: ApplicationDraftingProposal;
  sourceResumeText: string;
  exactFacts: ApplicationKitExactFacts;
}>): Promise<readonly RenderedApplicationKitArtifact[]> {
  const resumeText = input.proposal.resume.handling === "PRESERVE_SERVER_SIDE"
    ? input.sourceResumeText
    : input.proposal.resume.text;
  const coverLetterText = [
    "Hiring Team", input.proposal.target.employerName, `Re: ${input.proposal.target.title}`, "Dear Hiring Team,",
    ...input.proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text),
    "Sincerely",
    input.exactFacts.legalName ?? "Candidate",
  ].join("\n\n");
  const stem = `${safeFilePart(input.exactFacts.legalName ?? "Candidate")}-${safeFilePart(input.proposal.target.employerName)}`;

  const resumePdf = await pdfBytes((document) => {
    addPdfHeader(document, input.exactFacts);
    addResumeTextToPdf(document, resumeText);
  });
  function addCoverLetter(document: PDFKit.PDFDocument): void {
    addPdfHeader(document, input.exactFacts);
    document.font("Helvetica").fontSize(10.5).fillColor("#111827")
      .text(`Hiring Team\n${input.proposal.target.employerName}\nRe: ${input.proposal.target.title}`).moveDown(1)
      .text("Dear Hiring Team,").moveDown(0.8);
    for (const paragraph of input.proposal.coverLetter.paragraphs) {
      document.font("Helvetica").fontSize(10.5).fillColor("#111827")
        .text(paragraph.text, { lineGap: 3 }).moveDown(0.8);
    }
    document.moveDown(0.5).text(`Sincerely,\n${input.exactFacts.legalName ?? "Candidate"}`);
  }
  const coverPdf = await pdfBytes(addCoverLetter);
  const applicationPdf = await pdfBytes(document => {
    addCoverLetter(document);
    document.addPage();
    addPdfHeader(document, input.exactFacts);
    addResumeTextToPdf(document, resumeText);
  });
  const resumeDocxBytes = new Uint8Array(await Packer.toBuffer(resumeDocx(resumeText, input.exactFacts)));
  const coverDocxBytes = new Uint8Array(await Packer.toBuffer(coverLetterDocx({
    proposal: input.proposal,
    facts: input.exactFacts,
  })));

  return Object.freeze(await Promise.all([
    checkedArtifact({
      kind: "RESUME", variant: "RESUME_PDF", displayName: `${stem}-Resume.pdf`,
      mimeType: PDF_MEDIA_TYPE, bytes: resumePdf,
      expectedText: `${input.exactFacts.legalName ?? "Candidate"}\n${resumeText}`, maxPages: 2,
    }),
    checkedArtifact({
      kind: "RESUME", variant: "RESUME_DOCX", displayName: `${stem}-Resume.docx`,
      mimeType: DOCX_MEDIA_TYPE, bytes: resumeDocxBytes,
      expectedText: `${input.exactFacts.legalName ?? "Candidate"}\n${resumeText}`,
    }),
    checkedArtifact({
      kind: "COVER_LETTER", variant: "COVER_LETTER_PDF", displayName: `${stem}-Cover-Letter.pdf`,
      mimeType: PDF_MEDIA_TYPE, bytes: coverPdf, expectedText: coverLetterText, maxPages: 1,
    }),
    checkedArtifact({
      kind: "COVER_LETTER", variant: "COVER_LETTER_DOCX", displayName: `${stem}-Cover-Letter.docx`,
      mimeType: DOCX_MEDIA_TYPE, bytes: coverDocxBytes, expectedText: coverLetterText,
    }),
    checkedArtifact({
      kind: "OTHER", variant: "APPLICATION_PDF", displayName: `${stem}-Application.pdf`,
      mimeType: PDF_MEDIA_TYPE, bytes: applicationPdf,
      expectedText: `${coverLetterText}\n${resumeText}`, maxPages: 3,
    }),
  ]));
}
