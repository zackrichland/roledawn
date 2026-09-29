import assert from "node:assert/strict";
import test from "node:test";

import OpenAI from "openai";

import {
  buildApplicationDraftingRequest,
  type ApplicationDraftingContext,
  type ApplicationDraftingProposal,
} from "../../domain/application-drafting.ts";
import { ROLEDAWN_APPLICATION_WRITING_POLICY } from "../../domain/application-writing-policy.ts";
import { loadApplicationWritingPolicy } from "./application-writing-policy-loader.ts";
import {
  createOpenAIApplicationDraftingAdapter,
  DEFAULT_OPENAI_DRAFTING_MODEL,
  OPENAI_DRAFTING_ADAPTER_RELEASE,
} from "./openai-drafting-adapter.ts";

const SNAPSHOT_HASH = "a".repeat(64);

function context(): ApplicationDraftingContext {
  return {
    schemaVersion: 1,
    source: {
      inputSnapshotId: "snapshot-1",
      snapshotHash: SNAPSHOT_HASH,
      capturedAt: "2026-08-16T10:00:00.000Z",
    },
    application: { workspaceId: "workspace-1", applicationId: "application-1", candidateId: "candidate-secret" },
    policy: {
      tailoringMode: "REORDER_AND_TIGHTEN",
      writingPolicyRelease: ROLEDAWN_APPLICATION_WRITING_POLICY.policyRelease,
      assemblerRelease: "snapshot/1",
      exactFactsAllowedInNarrativeContext: false,
    },
    job: {
      jobId: "job-1",
      jobVersionId: "job-version-1",
      contentSha256: "b".repeat(64),
      employerName: "Northstar",
      title: "Platform Engineer",
      description: "Improve reliable systems.",
      location: "Remote",
      employmentType: "Full-time",
      workMode: "REMOTE",
      applyUrl: "https://jobs.example.com/platform-engineer",
    },
    sourceResume: {
      documentId: "document-secret",
      documentVersionId: "document-version-secret",
      textReviewId: "review-secret",
      sourceSha256: "c".repeat(64),
      reviewedTextSha256: "d".repeat(64),
      reviewedText: "Private raw resume text.",
    },
    approvedNarrativeEvidence: [{
      evidenceVersionId: "evidence-1",
      documentId: "document-secret",
      claimSha256: "e".repeat(64),
      claimText: "Built reliable systems for Acme.",
      usagePolicy: "RESUME_AND_COVER_LETTER",
    }],
    excludedExactFactCount: 3,
  };
}

function modelOutput(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    inputSnapshotId: "snapshot-1",
    snapshotHash: SNAPSHOT_HASH,
    target: { employerName: "Northstar", title: "Platform Engineer" },
    claims: [{
      claimId: "resume-1",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "RESUME",
      statement: "Built reliable systems for Acme.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-1" }],
    }, {
      claimId: "letter-1",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "COVER_LETTER",
      statement: "Built reliable systems for Acme.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-1" }],
    }, {
      claimId: "job-1",
      claimType: "JOB_CONTEXT",
      surface: "COVER_LETTER",
      statement: "Northstar is hiring a Platform Engineer.",
      citations: [{ sourceType: "JOB_FIELD", field: "TITLE" }],
    }],
    resume: {
      handling: "TAILOR_FROM_APPROVED_EVIDENCE",
      mode: "REORDER_AND_TIGHTEN",
      text: "Built reliable systems for Acme.",
      claimIds: ["resume-1"],
    },
    coverLetter: {
      title: "Application for Platform Engineer",
      paragraphs: [{
        paragraphId: "paragraph-1",
        text: "I built reliable systems for Acme.",
        claimIds: ["letter-1"],
      }, {
        paragraphId: "paragraph-2",
        text: "That work fits Northstar's Platform Engineer role.",
        claimIds: ["job-1"],
      }],
    },
  };
}

function responseBody(output: unknown): Record<string, unknown> {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1,
    status: "completed",
    completed_at: 2,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 12_000,
    model: DEFAULT_OPENAI_DRAFTING_MODEL,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: "medium", summary: null },
    store: false,
    text: { format: { type: "json_schema" } },
    tool_choice: "auto",
    tools: [],
    usage: null,
  };
}

function fakeClient(body: Record<string, unknown>): { client: OpenAI; requests: unknown[] } {
  const requests: unknown[] = [];
  const client = new OpenAI({
    apiKey: "test-key",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, requests };
}

test("sends only the bounded provider request and parses a completed Terra proposal", async () => {
  const { client, requests } = fakeClient(responseBody([{
    id: "msg_test",
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text: JSON.stringify(modelOutput()), annotations: [] }],
  }]));
  const adapter = createOpenAIApplicationDraftingAdapter({ client });
  const request = buildApplicationDraftingRequest(context(), ROLEDAWN_APPLICATION_WRITING_POLICY);
  const result = await adapter.draft(request);

  assert.equal(result.status, "COMPLETED");
  assert.equal(requests.length, 1);
  const serialized = JSON.stringify(requests[0]);
  assert.ok(serialized.includes("Owned writing policy: resume.md"));
  assert.ok(serialized.includes("Owned writing policy: cover-letter.md"));
  assert.equal(serialized.includes("candidate-secret"), false);
  assert.equal(serialized.includes("document-secret"), false);
  assert.equal(serialized.includes("Private raw resume text"), false);
  assert.equal(serialized.includes("OPENAI_API_KEY"), false);
  assert.equal(serialized.includes('\"store\":false'), true);
  assert.equal(serialized.includes('\"model\":\"gpt-5.6-terra\"'), true);
  const requestBody = requests[0] as {
    text: { format: { schema: { properties: { claims: { items: { anyOf: Array<{
      properties: {
        claimType: { enum: string[] };
        surface: { enum: string[] };
        citations: { items: { properties: { sourceType: { enum: string[] } } } };
      };
    }> } } } } } };
  };
  const claimVariants = requestBody.text.format.schema.properties.claims.items.anyOf;
  assert.deepEqual(
    claimVariants.map((variant) => ({
      claimType: variant.properties.claimType.enum,
      surfaces: variant.properties.surface.enum,
      citationSource: variant.properties.citations.items.properties.sourceType.enum,
    })),
    [{
      claimType: ["CANDIDATE_EVIDENCE"],
      surfaces: ["RESUME", "COVER_LETTER"],
      citationSource: ["CANDIDATE_EVIDENCE"],
    }, {
      claimType: ["JOB_CONTEXT"],
      surfaces: ["COVER_LETTER"],
      citationSource: ["JOB_FIELD"],
    }, {
      claimType: ["RESEARCH_CONTEXT"],
      surfaces: ["COVER_LETTER"],
      citationSource: ["RESEARCH_CLAIM"],
    }],
  );
  if (result.status === "COMPLETED") {
    assert.equal(result.execution.adapterRelease, OPENAI_DRAFTING_ADAPTER_RELEASE);
    assert.equal(result.execution.requestId, "resp_test");
    assert.match(result.execution.writingPolicy?.sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(result.execution.writingPolicy?.documents.length, 5);
  }
});

test("maps a refusal without inventing a proposal", async () => {
  const { client } = fakeClient(responseBody([{
    id: "msg_refusal",
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "refusal", refusal: "Cannot comply." }],
  }]));
  const request = buildApplicationDraftingRequest(context(), ROLEDAWN_APPLICATION_WRITING_POLICY);
  const result = await createOpenAIApplicationDraftingAdapter({ client }).draft(request);
  assert.equal(result.status, "REFUSED");
});

test("maps an incomplete response and preserves its bounded reason", async () => {
  const body = responseBody([]);
  body.status = "incomplete";
  body.completed_at = null;
  body.incomplete_details = { reason: "max_output_tokens" };
  const { client } = fakeClient(body);
  const request = buildApplicationDraftingRequest(context(), ROLEDAWN_APPLICATION_WRITING_POLICY);
  const result = await createOpenAIApplicationDraftingAdapter({ client }).draft(request);
  assert.equal(result.status, "INCOMPLETE");
  if (result.status === "INCOMPLETE") assert.equal(result.reasonCode, "max_output_tokens");
});

test("loads current guidance for every generation and blocks provider calls when loading fails", async () => {
  const { client, requests } = fakeClient(responseBody([]));
  const policy = await loadApplicationWritingPolicy();
  let loads = 0;
  const adapter = createOpenAIApplicationDraftingAdapter({ client, loadWritingPolicy: async () => {
    loads += 1;
    if (loads === 3) throw new Error("APPLICATION_WRITING_POLICY_LOAD_FAILED");
    return { ...policy, instructions: `${policy.instructions}\nRevision marker ${loads}` };
  } });
  const request = buildApplicationDraftingRequest(context(), ROLEDAWN_APPLICATION_WRITING_POLICY);
  await adapter.draft(request);
  await adapter.draft(request);
  assert.match(JSON.stringify(requests[0]), /Revision marker 1/u);
  assert.match(JSON.stringify(requests[1]), /Revision marker 2/u);
  await assert.rejects(adapter.draft(request), { message: "APPLICATION_WRITING_POLICY_LOAD_FAILED" });
  assert.equal(requests.length, 2);
});

test("revision requests retain original evidence and hard bounds while supplying measured feedback", async () => {
  const { client, requests } = fakeClient(responseBody([]));
  const request = buildApplicationDraftingRequest(context(), ROLEDAWN_APPLICATION_WRITING_POLICY);
  await createOpenAIApplicationDraftingAdapter({ client }).draft(request, {
    previousProposal: modelOutput() as unknown as ApplicationDraftingProposal,
    issueCodes: ["COVER_LETTER_LENGTH_OUT_OF_RANGE"], measurements: { coverLetterWords: 138, coverLetterParagraphs: 3, resumeWords: 80 }, targetCoverLetterWords: 220,
  });
  const body = requests[0] as { instructions: string; input: { content: { text: string }[] }[] };
  const supplied = JSON.parse(body.input[0].content[0].text);
  assert.deepEqual(supplied.approvedNarrativeEvidence, request.approvedNarrativeEvidence);
  assert.deepEqual(supplied.policy, request.policy);
  assert.equal(supplied.revision.measurements.coverLetterWords, 138);
  assert.equal(supplied.revision.targetCoverLetterWords, 220);
  assert.match(body.instructions, /previous proposal is a draft, not evidence/u);
  assert.match(body.instructions, /separate candidate and job claims/u);
  assert.match(body.instructions, /never what the candidate did or wants/u);
  assert.match(body.instructions, /exact causal relationship in the evidence/u);
  assert.doesNotMatch(JSON.stringify(supplied), /Private raw resume text|candidate-secret/u);
});
