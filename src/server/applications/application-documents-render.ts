import { createHash } from "node:crypto";

import {
  coverLetterPlainText,
  resumePlainText,
  type CoverLetterDocumentModel,
  type ResumeDocumentModel,
} from "../../domain/application-documents.ts";
import type { ApplicationArtifactVariant } from "../../domain/application-kit.ts";
import { DOCX_MEDIA_TYPE, PDF_MEDIA_TYPE } from "../resume/extract-resume.ts";
import {
  APPLICATION_DOCUMENT_RENDERER_RELEASE,
  renderApplicationPdf,
  renderCoverLetterDocx,
  renderCoverLetterPdf,
  renderResumeDocx,
  renderResumePdf,
  verifyRenderedText,
  type RenderedDocument,
} from "./application-document-renderer.ts";

export type RenderedArtifact = Readonly<{
  kind: "RESUME" | "COVER_LETTER" | "OTHER";
  variant: ApplicationArtifactVariant;
  displayName: string;
  mimeType: typeof PDF_MEDIA_TYPE | typeof DOCX_MEDIA_TYPE;
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  rendererRelease: string;
  qaStatus: "PASSED";
  droppedBullets: readonly string[];
}>;

const MIN_TEXT_COVERAGE = 0.95;

function filePart(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/gu, "").replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60) || "Candidate";
}

async function checked(input: Readonly<{
  kind: RenderedArtifact["kind"];
  variant: ApplicationArtifactVariant;
  displayName: string;
  document: RenderedDocument;
  expectedText: string;
  maxPages: number | null;
}>): Promise<RenderedArtifact> {
  const verification = await verifyRenderedText(input.document, input.expectedText);
  if (verification.coverage < MIN_TEXT_COVERAGE) throw new Error("APPLICATION_ARTIFACT_QA_TEXT_MISMATCH");
  if (input.maxPages !== null && (verification.pageCount === null || verification.pageCount > input.maxPages)) {
    throw new Error("APPLICATION_ARTIFACT_QA_PAGE_LIMIT");
  }
  const bytes = input.document.bytes;
  return Object.freeze({
    kind: input.kind,
    variant: input.variant,
    displayName: input.displayName,
    mimeType: input.document.mimeType === PDF_MEDIA_TYPE ? PDF_MEDIA_TYPE : DOCX_MEDIA_TYPE,
    bytes,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    rendererRelease: APPLICATION_DOCUMENT_RENDERER_RELEASE,
    qaStatus: "PASSED",
    droppedBullets: input.document.droppedBullets,
  });
}

/**
 * Renders the five packet files from one pair of final document models and
 * proves each file's extracted text matches the model before it can be stored.
 */
export async function renderApplicationDocuments(input: Readonly<{
  resume: ResumeDocumentModel;
  coverLetter: CoverLetterDocumentModel;
  employerName: string;
}>): Promise<readonly RenderedArtifact[]> {
  const stem = `${filePart(input.resume.name)}-${filePart(input.employerName)}`;
  const resumeText = resumePlainText(input.resume);
  const letterText = coverLetterPlainText(input.coverLetter);
  const [resumePdf, resumeDocx, letterPdf, letterDocx, applicationPdf] = await Promise.all([
    renderResumePdf(input.resume),
    renderResumeDocx(input.resume),
    renderCoverLetterPdf(input.coverLetter),
    renderCoverLetterDocx(input.coverLetter),
    renderApplicationPdf(input.coverLetter, input.resume),
  ]);
  // A bullet the layout had to drop must not remain in the QA expectation.
  const withoutDropped = (text: string, dropped: readonly string[]) =>
    dropped.reduce((current, bullet) => current.replace(`• ${bullet}`, ""), text);
  return Object.freeze(await Promise.all([
    checked({ kind: "RESUME", variant: "RESUME_PDF", displayName: `${stem}-Resume.pdf`, document: resumePdf,
      expectedText: withoutDropped(resumeText, resumePdf.droppedBullets), maxPages: 2 }),
    checked({ kind: "RESUME", variant: "RESUME_DOCX", displayName: `${stem}-Resume.docx`, document: resumeDocx,
      expectedText: withoutDropped(resumeText, resumeDocx.droppedBullets), maxPages: null }),
    checked({ kind: "COVER_LETTER", variant: "COVER_LETTER_PDF", displayName: `${stem}-Cover-Letter.pdf`, document: letterPdf,
      expectedText: letterText, maxPages: 1 }),
    checked({ kind: "COVER_LETTER", variant: "COVER_LETTER_DOCX", displayName: `${stem}-Cover-Letter.docx`, document: letterDocx,
      expectedText: letterText, maxPages: null }),
    checked({ kind: "OTHER", variant: "APPLICATION_PDF", displayName: `${stem}-Application.pdf`, document: applicationPdf,
      expectedText: `${letterText}\n${withoutDropped(resumeText, applicationPdf.droppedBullets)}`, maxPages: 3 }),
  ]));
}
