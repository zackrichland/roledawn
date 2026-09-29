import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationDraftingProposal } from "../../domain/application-drafting.ts";
import {
  DOCX_MEDIA_TYPE,
  extractResumeText,
  PDF_MEDIA_TYPE,
} from "../resume/extract-resume.ts";
import type { ApplicationKitExactFacts } from "./application-kit-facts.ts";
import {
  APPLICATION_ARTIFACT_RENDERER_RELEASE,
  renderApplicationKit,
} from "./application-kit-renderer.ts";

function proposal(): ApplicationDraftingProposal {
  return {
    schemaVersion: 1,
    inputSnapshotId: "snapshot-1",
    snapshotHash: "a".repeat(64),
    target: { employerName: "Northstar Systems", title: "Platform Engineer" },
    claims: [{
      claimId: "resume-claim",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "RESUME",
      statement: "Built reliable scheduling systems for healthcare teams.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-1" }],
    }, {
      claimId: "letter-claim",
      claimType: "JOB_CONTEXT",
      surface: "COVER_LETTER",
      statement: "Northstar Systems is hiring a Platform Engineer.",
      citations: [{ sourceType: "JOB_FIELD", field: "TITLE" }],
    }],
    resume: {
      handling: "TAILOR_FROM_APPROVED_EVIDENCE",
      mode: "REORDER_AND_TIGHTEN",
      text: [
        "EXPERIENCE",
        "Community Services",
        "Built reliable scheduling systems for healthcare teams.",
        "Improved operational workflows across multiple sites.",
      ].join("\n"),
      claimIds: ["resume-claim"],
    },
    coverLetter: {
      title: "Application for Platform Engineer",
      paragraphs: [{
        paragraphId: "paragraph-1",
        text: "I built reliable scheduling systems for healthcare teams and improved operational workflows across multiple sites.",
        claimIds: ["resume-claim"],
      }, {
        paragraphId: "paragraph-2",
        text: "That experience is relevant to Northstar Systems and the Platform Engineer role.",
        claimIds: ["letter-claim"],
      }],
    },
  };
}

const EXACT_FACTS: ApplicationKitExactFacts = {
  legalName: "Morgan Lee",
  contactLines: [
    "Washington, DC, US",
    "morgan@example.com",
    "+1 202 555 0100",
    "https://www.linkedin.com/in/morgan-lee",
  ],
  factVersionIds: ["fact-name", "fact-email"],
};

for (const fixture of [
  { title: "Registered Nurse", employer: "Community Clinic", proof: "Coordinated discharge teaching with patients and the care team.", section: "LICENSURE", detail: "Registered Nurse, approved synthetic credential" },
  { title: "Financial Analyst", employer: "Cedar Finance", proof: "Reconciled monthly account balances and prepared variance explanations.", section: "EDUCATION", detail: "Bachelor of Science in Accounting" },
  { title: "Science Teacher", employer: "Riverbend School", proof: "Planned classroom investigations and used student work to adjust lessons.", section: "EDUCATION", detail: "Bachelor of Science in Education" },
]) {
  test(`renders a ${fixture.title} packet without injecting a different profession`, async () => {
    const base = proposal();
    const roleProposal: ApplicationDraftingProposal = { ...base, target: { employerName: fixture.employer, title: fixture.title },
      resume: { handling: "TAILOR_FROM_APPROVED_EVIDENCE", mode: "REORDER_AND_TIGHTEN", claimIds: [], text: `EXPERIENCE\n${fixture.title}\n${fixture.proof}\n\n${fixture.section}\n${fixture.detail}` },
      coverLetter: { ...base.coverLetter, paragraphs: [{ paragraphId: "proof", claimIds: [],
        text: `${fixture.employer}'s ${fixture.title} role connects to my work. ${fixture.proof}` }] } };
    const artifacts = await renderApplicationKit({ proposal: roleProposal, sourceResumeText: "Not selected.", exactFacts: EXACT_FACTS });
    const combined = artifacts.find(artifact => artifact.variant === "APPLICATION_PDF")!;
    const extracted = await extractResumeText({ bytes: combined.bytes, filename: combined.displayName, declaredMediaType: combined.mimeType });
    assert.equal(extracted.ok, true);
    if (!extracted.ok) return;
    const text = extracted.value.extraction.normalizedText;
    assert.equal(extracted.value.extraction.pageCount, 2);
    assert.ok(text.includes(fixture.proof));
    assert.ok(text.includes(fixture.detail));
    assert.doesNotMatch(text, /Platform Engineer|Forward Deployed|Zack|Richland|Built reliable scheduling/u);
  });
}

test("renders and text-QAs the exact PDF/DOCX resume and cover-letter set", async () => {
  const rendered = await renderApplicationKit({
    proposal: proposal(),
    sourceResumeText: "This server-side source is not selected in tailored mode.",
    exactFacts: EXACT_FACTS,
  });

  assert.deepEqual(rendered.map((artifact) => artifact.variant).sort(), [
    "APPLICATION_PDF",
    "COVER_LETTER_DOCX",
    "COVER_LETTER_PDF",
    "RESUME_DOCX",
    "RESUME_PDF",
  ]);
  assert.ok(rendered.every((artifact) => artifact.qaStatus === "PASSED"));
  assert.ok(rendered.every((artifact) => artifact.rendererRelease === APPLICATION_ARTIFACT_RENDERER_RELEASE));
  assert.ok(rendered.every((artifact) => artifact.byteSize === artifact.bytes.byteLength));
  assert.ok(rendered.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256)));
  assert.equal(new Set(rendered.map((artifact) => artifact.sha256)).size, 5);
  assert.ok(rendered.every((artifact) => artifact.displayName.startsWith("Morgan-Lee-Northstar-Systems-")));

  for (const artifact of rendered) {
    const extracted = await extractResumeText({
      bytes: artifact.bytes,
      filename: artifact.displayName,
      declaredMediaType: artifact.mimeType,
    });
    assert.equal(extracted.ok, true);
    if (!extracted.ok) continue;
    assert.match(extracted.value.extraction.normalizedText, /Morgan Lee/u);
    if (artifact.kind === "RESUME") {
      assert.match(extracted.value.extraction.normalizedText, /reliable scheduling systems/u);
      assert.match(extracted.value.extraction.normalizedText, /operational workflows/u);
    } else {
      assert.match(extracted.value.extraction.normalizedText, /Re: Platform Engineer/u);
      assert.match(extracted.value.extraction.normalizedText, /Northstar Systems/u);
      assert.match(extracted.value.extraction.normalizedText, /Sincerely/u);
    }
  }
});

test("preserve mode renders the reviewed server-side resume instead of model resume text", async () => {
  const base = proposal();
  const preserveProposal: ApplicationDraftingProposal = {
    ...base,
    resume: {
      handling: "PRESERVE_SERVER_SIDE",
      mode: "AS_UPLOADED",
      text: null,
      claimIds: [],
    },
  };
  const sourceResumeText = [
    "SOURCE RESUME",
    "Community Services",
    "Led a regulated healthcare modernization program.",
  ].join("\n");
  const rendered = await renderApplicationKit({
    proposal: preserveProposal,
    sourceResumeText,
    exactFacts: EXACT_FACTS,
  });

  for (const artifact of rendered.filter((item) => item.kind === "RESUME")) {
    const extracted = await extractResumeText({
      bytes: artifact.bytes,
      filename: artifact.displayName,
      declaredMediaType: artifact.mimeType,
    });
    assert.equal(extracted.ok, true);
    if (!extracted.ok) continue;
    assert.match(extracted.value.extraction.normalizedText, /regulated healthcare modernization/u);
    assert.doesNotMatch(extracted.value.extraction.normalizedText, /reliable scheduling systems/u);
  }
});

test("uses the declared media types that the persistence and extraction boundary accepts", async () => {
  const rendered = await renderApplicationKit({
    proposal: proposal(),
    sourceResumeText: "Not selected.",
    exactFacts: EXACT_FACTS,
  });

  assert.deepEqual(
    [...new Set(rendered.filter((artifact) => artifact.variant.endsWith("PDF")).map((artifact) => artifact.mimeType))],
    [PDF_MEDIA_TYPE],
  );
  assert.deepEqual(
    [...new Set(rendered.filter((artifact) => artifact.variant.endsWith("DOCX")).map((artifact) => artifact.mimeType))],
    [DOCX_MEDIA_TYPE],
  );
});

test("combined PDF starts with the letter and places the resume on the next page", async () => {
  const rendered = await renderApplicationKit({ proposal: proposal(), sourceResumeText: "Unused.", exactFacts: EXACT_FACTS });
  const combined = rendered.find(artifact => artifact.variant === "APPLICATION_PDF")!;
  assert.equal(combined.kind, "OTHER");
  const result = await extractResumeText({ bytes: combined.bytes, filename: combined.displayName, declaredMediaType: PDF_MEDIA_TYPE });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.extraction.pageCount, 2);
  const text = result.value.extraction.normalizedText;
  assert.ok(text.indexOf("Dear Hiring Team") < text.indexOf("EXPERIENCE"));
  assert.ok(text.indexOf("Sincerely") < text.indexOf("EXPERIENCE"));
  assert.doesNotMatch(text, /Application for Platform Engineer/u);
});

test("oversized letter fails PDF readiness rather than silently creating extra pages", async () => {
  const base = proposal();
  const oversized = { ...base, coverLetter: { ...base.coverLetter, paragraphs: [{ paragraphId: "oversized", claimIds: ["letter-claim"], text: "A supported sentence about teaching and assessment. ".repeat(250) }] } };
  await assert.rejects(renderApplicationKit({ proposal: oversized, sourceResumeText: "Unused.", exactFacts: EXACT_FACTS }), /APPLICATION_ARTIFACT_QA_PAGE_LIMIT/u);
});
