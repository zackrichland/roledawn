import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import mammoth from "mammoth";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

export const PDF_MEDIA_TYPE = "application/pdf";
export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const SUPPORTED_RESUME_MEDIA_TYPES = [
  PDF_MEDIA_TYPE,
  DOCX_MEDIA_TYPE,
] as const;

export type SupportedResumeMediaType =
  (typeof SUPPORTED_RESUME_MEDIA_TYPES)[number];

// These limits intentionally match or narrow the persistence boundary. Parsing
// still belongs in an isolated worker; this module never accepts unbounded input.
export const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_PDF_PAGES = 25;
export const MAX_RESUME_TEXT_CHARACTERS = 200_000;
export const MAX_DOCX_ARCHIVE_ENTRIES = 256;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_DOCX_PART_BYTES = 4 * 1024 * 1024;
export const MAX_DOCX_COMPRESSION_RATIO = 200;
const MAX_DOCX_CONTENT_TYPES_BYTES = 1024 * 1024;
const DOCX_MAIN_DOCUMENT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export const RESUME_PARSER_RELEASES = {
  [PDF_MEDIA_TYPE]: "unpdf@1.8.0/pdfjs@5.6.205",
  [DOCX_MEDIA_TYPE]: "mammoth@1.12.1",
} as const satisfies Record<SupportedResumeMediaType, string>;

export type ResumeExtractionFailureCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_FILENAME"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "FILE_EXTENSION_MISMATCH"
  | "CONTENT_SIGNATURE_MISMATCH"
  | "ENCRYPTED_DOCUMENT"
  | "MALFORMED_DOCUMENT"
  | "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED"
  | "PDF_PAGE_LIMIT_EXCEEDED"
  | "TEXT_LIMIT_EXCEEDED"
  | "OCR_REQUIRED"
  | "NO_EXTRACTABLE_TEXT"
  | "PARSER_FAILED";

export type ResumeExtractionFailureCategory =
  | "INPUT_REJECTED"
  | "UNSUPPORTED_DOCUMENT"
  | "SAFETY_LIMIT"
  | "DOCUMENT_INVALID"
  | "OCR_REQUIRED"
  | "PARSER_FAILURE";

export type ResumeExtractionFailure = Readonly<{
  code: ResumeExtractionFailureCode;
  category: ResumeExtractionFailureCategory;
  message: string;
  retryable: false;
}>;

export type ResumeExtractionInput = Readonly<{
  bytes: Uint8Array;
  filename: string;
  declaredMediaType: string;
}>;

export type ResumeTextArtifact = Readonly<{
  schemaVersion: 1;
  source: Readonly<{
    filename: string;
    mediaType: SupportedResumeMediaType;
    byteSize: number;
    sha256: string;
  }>;
  extraction: Readonly<{
    parserRelease: string;
    pageCount: number | null;
    normalizedText: string;
    characterCount: number;
    sha256: string;
    warningCount: number;
    warnings: readonly string[];
  }>;
}>;

export type ResumeExtractionResult =
  | Readonly<{ ok: true; value: ResumeTextArtifact }>
  | Readonly<{ ok: false; error: ResumeExtractionFailure }>;

const FAILURE_DETAILS: Readonly<
  Record<
    ResumeExtractionFailureCode,
    Omit<ResumeExtractionFailure, "code" | "retryable">
  >
> = {
  EMPTY_FILE: {
    category: "INPUT_REJECTED",
    message: "The resume file is empty.",
  },
  FILE_TOO_LARGE: {
    category: "SAFETY_LIMIT",
    message: "The resume file exceeds the 10 MB upload limit.",
  },
  INVALID_FILENAME: {
    category: "INPUT_REJECTED",
    message: "The resume filename is invalid.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    category: "UNSUPPORTED_DOCUMENT",
    message: "RoleDawn currently accepts PDF and DOCX resumes only.",
  },
  FILE_EXTENSION_MISMATCH: {
    category: "INPUT_REJECTED",
    message: "The filename extension does not match the declared file type.",
  },
  CONTENT_SIGNATURE_MISMATCH: {
    category: "INPUT_REJECTED",
    message: "The file contents do not match the declared file type.",
  },
  ENCRYPTED_DOCUMENT: {
    category: "UNSUPPORTED_DOCUMENT",
    message: "Password-protected or encrypted resumes are not supported.",
  },
  MALFORMED_DOCUMENT: {
    category: "DOCUMENT_INVALID",
    message: "The resume file is malformed or incomplete.",
  },
  DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED: {
    category: "SAFETY_LIMIT",
    message: "The resume archive exceeds safe processing limits.",
  },
  PDF_PAGE_LIMIT_EXCEEDED: {
    category: "SAFETY_LIMIT",
    message: `PDF resumes may contain at most ${MAX_RESUME_PDF_PAGES} pages.`,
  },
  TEXT_LIMIT_EXCEEDED: {
    category: "SAFETY_LIMIT",
    message: "The extracted resume text exceeds safe processing limits.",
  },
  OCR_REQUIRED: {
    category: "OCR_REQUIRED",
    message:
      "This PDF does not contain usable text. Upload a text-based PDF or DOCX; scanned resumes require a future OCR review path.",
  },
  NO_EXTRACTABLE_TEXT: {
    category: "DOCUMENT_INVALID",
    message: "The resume does not contain usable text.",
  },
  PARSER_FAILED: {
    category: "PARSER_FAILURE",
    message: "The resume could not be parsed safely.",
  },
};

function failed(code: ResumeExtractionFailureCode): ResumeExtractionResult {
  return {
    ok: false,
    error: { code, ...FAILURE_DETAILS[code], retryable: false },
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeMediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function supportedMediaType(value: string): SupportedResumeMediaType | null {
  const normalized = normalizeMediaType(value);
  return SUPPORTED_RESUME_MEDIA_TYPES.find((item) => item === normalized) ?? null;
}

function normalizedFilename(value: string): string | null {
  const normalized = value.trim().normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > 255 ||
    normalized.includes("\0") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    return null;
  }
  return normalized;
}

function filenameMatchesMediaType(
  filename: string,
  mediaType: SupportedResumeMediaType,
): boolean {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return mediaType === PDF_MEDIA_TYPE ? extension === ".pdf" : extension === ".docx";
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function normalizeResumeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\f\v]/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasUsableText(value: string): boolean {
  return value.replace(/[\s\p{P}\p{S}]/gu, "").length >= 16;
}

function success(
  input: Readonly<{
    bytes: Uint8Array;
    filename: string;
    mediaType: SupportedResumeMediaType;
    parserRelease: string;
    pageCount: number | null;
    text: string;
    warnings: readonly string[];
  }>,
): ResumeExtractionResult {
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      source: {
        filename: input.filename,
        mediaType: input.mediaType,
        byteSize: input.bytes.byteLength,
        sha256: sha256(input.bytes),
      },
      extraction: {
        parserRelease: input.parserRelease,
        pageCount: input.pageCount,
        normalizedText: input.text,
        characterCount: input.text.length,
        sha256: sha256(input.text),
        warningCount: input.warnings.length,
        warnings: [...input.warnings],
      },
    },
  };
}

function readUint16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x1_0000 +
    bytes[offset + 3]! * 0x1_000000
  );
}

type DocxPreflightResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: ResumeExtractionFailureCode }>;

function preflightDocxArchive(bytes: Uint8Array): DocxPreflightResult {
  const minimumEndOffset = Math.max(0, bytes.length - 22 - 65_535);
  let endOffset = -1;
  for (let index = bytes.length - 22; index >= minimumEndOffset; index -= 1) {
    if (readUint32(bytes, index) !== 0x0605_4b50) continue;
    const commentLength = readUint16(bytes, index + 20);
    if (commentLength !== null && index + 22 + commentLength === bytes.length) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) return { ok: false, code: "MALFORMED_DOCUMENT" };

  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDisk = readUint16(bytes, endOffset + 6);
  const diskEntries = readUint16(bytes, endOffset + 8);
  const entryCount = readUint16(bytes, endOffset + 10);
  const centralSize = readUint32(bytes, endOffset + 12);
  const centralOffset = readUint32(bytes, endOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries === null ||
    entryCount === null ||
    diskEntries !== entryCount ||
    centralSize === null ||
    centralOffset === null ||
    entryCount === 0xffff ||
    centralSize === 0xffff_ffff ||
    centralOffset === 0xffff_ffff ||
    centralOffset + centralSize > endOffset
  ) {
    return { ok: false, code: "MALFORMED_DOCUMENT" };
  }
  if (entryCount > MAX_DOCX_ARCHIVE_ENTRIES) {
    return { ok: false, code: "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED" };
  }

  let cursor = centralOffset;
  let totalUncompressedBytes = 0;
  let hasContentTypes = false;
  let hasMainDocument = false;
  let contentTypesXml: string | null = null;
  const paths = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, cursor) !== 0x0201_4b50) {
      return { ok: false, code: "MALFORMED_DOCUMENT" };
    }
    const flags = readUint16(bytes, cursor + 8);
    const compressionMethod = readUint16(bytes, cursor + 10);
    const compressedSize = readUint32(bytes, cursor + 20);
    const uncompressedSize = readUint32(bytes, cursor + 24);
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const localHeaderOffset = readUint32(bytes, cursor + 42);
    if (
      flags === null ||
      compressionMethod === null ||
      compressedSize === null ||
      uncompressedSize === null ||
      nameLength === null ||
      extraLength === null ||
      commentLength === null ||
      localHeaderOffset === null
    ) {
      return { ok: false, code: "MALFORMED_DOCUMENT" };
    }
    if ((flags & 0x1) !== 0) return { ok: false, code: "ENCRYPTED_DOCUMENT" };
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      return { ok: false, code: "UNSUPPORTED_MEDIA_TYPE" };
    }
    if (compressedSize > bytes.length || uncompressedSize > MAX_DOCX_PART_BYTES) {
      return { ok: false, code: "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED" };
    }
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 ||
        uncompressedSize > compressedSize * MAX_DOCX_COMPRESSION_RATIO)
    ) {
      return { ok: false, code: "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED" };
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      return { ok: false, code: "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED" };
    }

    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLength + extraLength + commentLength;
    if (nextCursor > centralOffset + centralSize || nextCursor > endOffset) {
      return { ok: false, code: "MALFORMED_DOCUMENT" };
    }
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    } catch {
      return { ok: false, code: "MALFORMED_DOCUMENT" };
    }
    if (
      path.length === 0 ||
      path.includes("\\") ||
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      paths.has(path)
    ) {
      return { ok: false, code: "MALFORMED_DOCUMENT" };
    }
    paths.add(path);
    hasContentTypes ||= path === "[Content_Types].xml";
    hasMainDocument ||= path === "word/document.xml";

    if (path === "[Content_Types].xml") {
      if (
        uncompressedSize > MAX_DOCX_CONTENT_TYPES_BYTES ||
        readUint32(bytes, localHeaderOffset) !== 0x0403_4b50
      ) {
        return { ok: false, code: "DOCUMENT_COMPLEXITY_LIMIT_EXCEEDED" };
      }
      const localNameLength = readUint16(bytes, localHeaderOffset + 26);
      const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
      if (localNameLength === null || localExtraLength === null) {
        return { ok: false, code: "MALFORMED_DOCUMENT" };
      }
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataStart < 0 || dataEnd > centralOffset || dataEnd > bytes.length) {
        return { ok: false, code: "MALFORMED_DOCUMENT" };
      }
      try {
        const compressed = Buffer.from(bytes.subarray(dataStart, dataEnd));
        const content =
          compressionMethod === 0
            ? compressed
            : inflateRawSync(compressed, {
                maxOutputLength: MAX_DOCX_CONTENT_TYPES_BYTES,
              });
        if (content.byteLength !== uncompressedSize) {
          return { ok: false, code: "MALFORMED_DOCUMENT" };
        }
        contentTypesXml = decoder.decode(content);
      } catch {
        return { ok: false, code: "MALFORMED_DOCUMENT" };
      }
    }
    cursor = nextCursor;
  }

  if (
    cursor !== centralOffset + centralSize ||
    !hasContentTypes ||
    !hasMainDocument ||
    !contentTypesXml
  ) {
    return { ok: false, code: "MALFORMED_DOCUMENT" };
  }
  const mainDocumentOverride = /<Override\b(?=[^>]*\bPartName=["']\/word\/document\.xml["'])(?=[^>]*\bContentType=["']([^"']+)["'])[^>]*>/u.exec(
    contentTypesXml,
  );
  if (mainDocumentOverride?.[1] !== DOCX_MAIN_DOCUMENT_CONTENT_TYPE) {
    return { ok: false, code: "CONTENT_SIGNATURE_MISMATCH" };
  }
  return { ok: true };
}

function appendPdfTextItem(output: string, item: unknown): string {
  if (
    typeof item !== "object" ||
    item === null ||
    !("str" in item) ||
    typeof item.str !== "string"
  ) {
    return output;
  }
  const fragment = item.str;
  if (fragment.length > 0) {
    const needsSpace =
      output.length > 0 &&
      !/[\s\n]$/u.test(output) &&
      !/^\s/u.test(fragment);
    output += `${needsSpace ? " " : ""}${fragment}`;
  }
  if ("hasEOL" in item && item.hasEOL === true) output += "\n";
  return output;
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  errorCode: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(errorCode)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function extractPdf(
  bytes: Uint8Array,
  filename: string,
): Promise<ResumeExtractionResult> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    document = await withTimeout(
      getDocumentProxy(Uint8Array.from(bytes), {
        disableFontFace: true,
        stopAtErrors: true,
        useWorkerFetch: false,
        verbosity: 0,
      }),
      5_000,
      "PDF_DOCUMENT_OPEN_TIMEOUT",
    );
    if (document.numPages > MAX_RESUME_PDF_PAGES) {
      return failed("PDF_PAGE_LIMIT_EXCEEDED");
    }

    const pages: string[] = [];
    let observedCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await withTimeout(
          page.getTextContent({
            disableNormalization: false,
            includeMarkedContent: false,
          }),
          5_000,
          "PDF_PAGE_PARSE_TIMEOUT",
        );
        let pageText = "";
        for (const item of content.items) {
          const beforeLength = pageText.length;
          pageText = appendPdfTextItem(pageText, item);
          observedCharacters += pageText.length - beforeLength;
          if (observedCharacters > MAX_RESUME_TEXT_CHARACTERS * 2) {
            return failed("TEXT_LIMIT_EXCEEDED");
          }
        }
        pages.push(pageText);
      } finally {
        page.cleanup();
      }
    }

    const text = normalizeResumeText(pages.join("\n\n"));
    if (text.length > MAX_RESUME_TEXT_CHARACTERS) return failed("TEXT_LIMIT_EXCEEDED");
    if (!hasUsableText(text)) return failed("OCR_REQUIRED");
    return success({
      bytes,
      filename,
      mediaType: PDF_MEDIA_TYPE,
      parserRelease: RESUME_PARSER_RELEASES[PDF_MEDIA_TYPE],
      pageCount: document.numPages,
      text,
      warnings: [],
    });
  } catch (error) {
    const pdfjs = await getResolvedPDFJS();
    if (error instanceof pdfjs.PasswordException) return failed("ENCRYPTED_DOCUMENT");
    if (error instanceof pdfjs.InvalidPDFException) return failed("MALFORMED_DOCUMENT");
    return failed("PARSER_FAILED");
  } finally {
    if (document) await document.loadingTask.destroy();
  }
}

async function extractDocx(
  bytes: Uint8Array,
  filename: string,
): Promise<ResumeExtractionResult> {
  const preflight = preflightDocxArchive(bytes);
  if (!preflight.ok) return failed(preflight.code);
  try {
    const parsed = await withTimeout(
      mammoth.extractRawText({ buffer: Buffer.from(bytes) }),
      15_000,
      "DOCX_PARSE_TIMEOUT",
    );
    if (parsed.messages.some((message) => message.type === "error")) {
      return failed("PARSER_FAILED");
    }
    const text = normalizeResumeText(parsed.value);
    if (text.length > MAX_RESUME_TEXT_CHARACTERS) return failed("TEXT_LIMIT_EXCEEDED");
    if (!hasUsableText(text)) return failed("NO_EXTRACTABLE_TEXT");
    return success({
      bytes,
      filename,
      mediaType: DOCX_MEDIA_TYPE,
      parserRelease: RESUME_PARSER_RELEASES[DOCX_MEDIA_TYPE],
      pageCount: null,
      text,
      warnings: parsed.messages
        .filter((message) => message.type === "warning")
        .map((message) => message.message.slice(0, 500)),
    });
  } catch {
    return failed("PARSER_FAILED");
  }
}

export async function extractResumeText(
  input: ResumeExtractionInput,
): Promise<ResumeExtractionResult> {
  if (input.bytes.byteLength === 0) return failed("EMPTY_FILE");
  if (input.bytes.byteLength > MAX_RESUME_FILE_BYTES) return failed("FILE_TOO_LARGE");

  const filename = normalizedFilename(input.filename);
  if (!filename) return failed("INVALID_FILENAME");
  const mediaType = supportedMediaType(input.declaredMediaType);
  if (!mediaType) return failed("UNSUPPORTED_MEDIA_TYPE");
  if (!filenameMatchesMediaType(filename, mediaType)) {
    return failed("FILE_EXTENSION_MISMATCH");
  }
  if (mediaType === PDF_MEDIA_TYPE && !hasPdfSignature(input.bytes)) {
    return failed("CONTENT_SIGNATURE_MISMATCH");
  }
  if (mediaType === DOCX_MEDIA_TYPE && !hasZipSignature(input.bytes)) {
    return failed("CONTENT_SIGNATURE_MISMATCH");
  }

  return mediaType === PDF_MEDIA_TYPE
    ? extractPdf(input.bytes, filename)
    : extractDocx(input.bytes, filename);
}
