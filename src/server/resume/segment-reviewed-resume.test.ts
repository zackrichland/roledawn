import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MAX_RESUME_EVIDENCE_PASSAGE_CHARACTERS,
  MAX_RESUME_EVIDENCE_PASSAGES,
  segmentReviewedResume,
} from "./segment-reviewed-resume.ts";

const REVIEW_ID = "58bce17b-278c-4f9f-8eec-5abf9e7dc9de";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("segments reviewed resume sections into deterministic exact passages", () => {
  const text = [
    "SUMMARY",
    "Product builder focused on careful automation.",
    "",
    "EXPERIENCE",
    "RoleDawn",
    "• Built a source-linked evidence review flow.",
    "• Added immutable review history.",
    "",
    "SKILLS",
    "TypeScript, PostgreSQL, product design",
  ].join("\n");

  const first = segmentReviewedResume(REVIEW_ID, text);
  const second = segmentReviewedResume(REVIEW_ID, text);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((passage) => passage.category), [
    "SUMMARY",
    "EXPERIENCE",
    "EXPERIENCE",
    "EXPERIENCE",
    "SKILL",
  ]);
  for (const passage of first) {
    assert.equal(Array.from(text).slice(passage.startOffset, passage.endOffset).join(""), passage.excerpt);
    assert.equal(passage.excerptSha256, sha256(passage.excerpt));
    assert.equal(
      passage.stableKey,
      sha256(`${REVIEW_ID}\n${passage.startOffset}\n${passage.endOffset}\n${passage.excerptSha256}`),
    );
  }
});

test("reconstructs wrapped bullets and stops before the next employer", () => {
  const text = [
    "Zack Candidate",
    "zack@example.com | +1 555 555 5555",
    "",
    "EXPERIENCE",
    "First Company | Builder | 2024-Present",
    "Built the operating system.",
    "• Shipped a two-sided workflow for teams that",
    "  replaced calls and spreadsheets.",
    "Second Company | Operator | 2022-2024",
    "Led commercial operations.",
    "• Grew a durable product line across",
    "  multiple customer segments.",
  ].join("\n");

  const passages = segmentReviewedResume(REVIEW_ID, text);

  assert.deepEqual(passages.map((passage) => passage.excerpt), [
    "First Company | Builder | 2024-Present\nBuilt the operating system.",
    "• Shipped a two-sided workflow for teams that\n  replaced calls and spreadsheets.",
    "Second Company | Operator | 2022-2024\nLed commercial operations.",
    "• Grew a durable product line across\n  multiple customer segments.",
  ]);
  assert.ok(passages.every((passage) => passage.category === "EXPERIENCE"));
  assert.ok(passages.every((passage) => !passage.excerpt.includes("zack@example.com")));
});

test("uses Unicode code-point offsets instead of JavaScript UTF-16 indices", () => {
  const text = "SUMMARY\n👋 Built hiring software with care.";
  const [passage] = segmentReviewedResume(REVIEW_ID, text);

  assert.equal(passage.excerpt, "👋 Built hiring software with care.");
  assert.equal(passage.startOffset, 8);
  assert.equal(Array.from(text).slice(passage.startOffset, passage.endOffset).join(""), passage.excerpt);
  assert.notEqual(text.slice(passage.startOffset, passage.endOffset), passage.excerpt);
});

test("splits long evidence without exceeding the database character limit", () => {
  const text = `EXPERIENCE\n${"delivery ".repeat(1_200).trim()}`;
  const passages = segmentReviewedResume(REVIEW_ID, text);

  assert.ok(passages.length > 1);
  for (const passage of passages) {
    assert.ok(Array.from(passage.excerpt).length <= MAX_RESUME_EVIDENCE_PASSAGE_CHARACTERS);
  }
});

test("falls back to bounded exact chunks when a resume has too many bullets", () => {
  const text = ["EXPERIENCE", ...Array.from({ length: 275 }, (_, index) => `• Delivered result ${index + 1}`)].join("\n");
  const passages = segmentReviewedResume(REVIEW_ID, text);

  assert.ok(passages.length <= MAX_RESUME_EVIDENCE_PASSAGES);
  assert.equal(passages[0]?.category, "OTHER");
  for (const passage of passages) {
    assert.equal(Array.from(text).slice(passage.startOffset, passage.endOffset).join(""), passage.excerpt);
  }
});

test("rejects an empty review and an invalid review id", () => {
  assert.throws(() => segmentReviewedResume(REVIEW_ID, "   \n"), /between 1 and 200,000/);
  assert.throws(() => segmentReviewedResume("not-a-review", "Experience"), /reference is invalid/);
});
