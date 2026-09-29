import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ApplicationDraftingAdapter } from "../src/domain/application-drafting.ts";
import { buildApplicationKitManifest } from "../src/domain/application-kit.ts";
import { applicationWritingFixture, WRITING_EVAL_PROFESSIONS, type WritingEvalProfession } from "../src/test-support/application-writing-fixtures.ts";
import { ApplicationDraftingPipelineError, withValidatedApplicationDraft } from "../src/server/applications/application-drafting-pipeline.ts";
import { renderApplicationKit } from "../src/server/applications/application-kit-renderer.ts";
import { loadApplicationWritingPolicy } from "../src/server/applications/application-writing-policy-loader.ts";
import { createOpenAIApplicationDraftingAdapter } from "../src/server/applications/openai-drafting-adapter.ts";
import { createOpenAIApplicationEntailmentAdapter } from "../src/server/applications/openai-entailment-adapter.ts";

// Default mode uses explicit synthetic adapter outputs. --live opts in to at
// most two drafts and two evidence checks for each of at most three professions.
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--live" && !arg.startsWith("--profession="))) throw new Error("WRITING_EVAL_ARGUMENT_INVALID");
const live = args.includes("--live");
const selected = args.find(arg => arg.startsWith("--profession="))?.split("=")[1];
if (selected && !(WRITING_EVAL_PROFESSIONS as readonly string[]).includes(selected)) throw new Error("WRITING_EVAL_PROFESSION_INVALID");
if (live && !process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY_REQUIRED");
const professions = selected ? [selected as WritingEvalProfession] : [...WRITING_EVAL_PROFESSIONS];
const directory = resolve("/tmp", `roledawn-writing-eval-${live ? "live" : "fixture"}-${Date.now()}`);
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const profession of professions) {
  const fixture = applicationWritingFixture(profession);
  const policy = await loadApplicationWritingPolicy();
  const rawDrafting: ApplicationDraftingAdapter = live ? createOpenAIApplicationDraftingAdapter() : {
    adapterRelease: "synthetic-fixture/1", async draft() { return { status: "COMPLETED", proposal: fixture.proposal,
      execution: { adapterRelease: "synthetic-fixture/1", modelRelease: "NO_LIVE_MODEL", requestId: null, writingPolicy: policy.provenance } }; },
  };
  const rawEntailment: ReturnType<typeof createOpenAIApplicationEntailmentAdapter> = live ? createOpenAIApplicationEntailmentAdapter() : {
    async validate(request) { return { execution: { adapterRelease: "openai-responses-entailment/2", modelRelease: "NO_LIVE_MODEL", requestId: null },
      result: { schemaVersion: 1, decisions: request.claims.map(claim => ({ claimId: claim.claimId, verdict: "ENTAILED", reason: "Fixed synthetic fixture; not an independent model evaluation." })) } }; },
  };
  const diagnosticDirectory = resolve(directory, profession); await mkdir(diagnosticDirectory, { recursive: true });
  let draftCalls = 0; let evidenceCalls = 0;
  // This executable constructs only synthetic fixtures. Diagnostics never run
  // in the production worker and never capture credentials or SDK errors.
  const drafting: ApplicationDraftingAdapter = { adapterRelease: rawDrafting.adapterRelease, async draft(request, revision) {
    const result = await rawDrafting.draft(request, revision); draftCalls++;
    await writeFile(resolve(diagnosticDirectory, `synthetic-draft-${draftCalls}.json`), JSON.stringify({ request, revision, result }, null, 2), { mode: 0o600 });
    return result;
  } };
  const entailment: ReturnType<typeof createOpenAIApplicationEntailmentAdapter> = { async validate(request) {
    const result = await rawEntailment.validate(request); evidenceCalls++;
    await writeFile(resolve(diagnosticDirectory, `synthetic-evidence-${evidenceCalls}.json`), JSON.stringify({ request, result }, null, 2), { mode: 0o600 });
    return result;
  } };
  process.stdout.write(`${JSON.stringify({ profession, mode: live ? "LIVE_SYNTHETIC" : "LOCAL_FIXTURE", stage: "DRAFTING" })}\n`);
  try {
    const result = await withValidatedApplicationDraft(fixture, { drafting, entailment }, async validated => {
      const exactFacts = { legalName: "Morgan Lee", contactLines: ["Springfield, US", "morgan@synthetic.example"], factVersionIds: [] };
      const artifacts = await renderApplicationKit({ proposal: validated.drafting.proposal, sourceResumeText: fixture.context.sourceResume.reviewedText, exactFacts });
      const kit = buildApplicationKitManifest({ context: fixture.context, research: fixture.research, proposal: validated.drafting.proposal,
        draftingExecution: validated.drafting.execution, draftingAttempts: validated.draftingAttempts,
        deterministicValidation: validated.deterministicValidation, semanticValidation: validated.semanticValidation, qualityValidation: validated.qualityValidation,
        entailmentExecution: validated.entailmentExecution, exactFactVersionIds: [], artifacts });
      const output = resolve(directory, profession); await mkdir(output, { recursive: true });
      for (const artifact of artifacts) await writeFile(resolve(output, artifact.displayName), artifact.bytes, { mode: 0o600 });
      await writeFile(resolve(output, "manifest.json"), JSON.stringify(kit.manifest, null, 2), { mode: 0o600 });
      return { profession, status: "PASSED", mode: live ? "LIVE_SYNTHETIC" : "LOCAL_FIXTURE", attempts: validated.draftingAttempts,
        model: validated.drafting.execution.modelRelease, policy: validated.drafting.execution.writingPolicy,
        deterministicPassed: validated.deterministicValidation.deterministicChecksPassed, semanticPassed: validated.semanticValidation.semanticChecksPassed,
        claimsChecked: validated.semanticValidation.decisions.length, declaredClaimsChecked: validated.drafting.proposal.claims.length, documentSegmentsChecked: validated.semanticValidation.decisions.length - validated.drafting.proposal.claims.length, quality: validated.qualityValidation.status,
        qualityIssueCodes: validated.qualityValidation.issues.map(issue => issue.code), measurements: validated.qualityValidation.measurements,
        artifacts: artifacts.map(({ variant, qaStatus, byteSize, sha256 }) => ({ variant, qaStatus, byteSize, sha256 })), packetHash: kit.packetHash, outputDirectory: output };
    });
    results.push(result);
    process.stdout.write(`${JSON.stringify({ profession, status: result.status, attempts: result.attempts.attempts.length,
      words: result.measurements.coverLetterWords, qualityIssueCodes: result.qualityIssueCodes, artifacts: result.artifacts.length })}\n`);
  } catch (error) {
    const result = { profession, status: "BLOCKED", diagnosticDirectory, errorCode: error instanceof ApplicationDraftingPipelineError ? error.message : "WRITING_EVAL_UNEXPECTED_FAILURE",
      attempts: error instanceof ApplicationDraftingPipelineError ? error.attempts : undefined };
    results.push(result); process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = 1;
  }
}
await writeFile(resolve(directory, "report.json"), JSON.stringify({ mode: live ? "LIVE_SYNTHETIC" : "LOCAL_FIXTURE", syntheticOnly: true,
  databaseWrites: false, employerFormsTouched: false, applicationsSubmitted: false, results }, null, 2), { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ report: resolve(directory, "report.json"), passed: results.filter(result => result.status === "PASSED").length, total: results.length })}\n`);
