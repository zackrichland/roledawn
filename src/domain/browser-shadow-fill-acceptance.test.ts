import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findInstalledChromium,
  runSyntheticShadowFillAcceptance,
  SyntheticShadowFillAttemptLedger,
  type ShadowFillAttemptBinding,
} from "../test-support/synthetic-ats-shadow-fill.ts";

const revisionHash = `sha256:${"a".repeat(64)}` as const;
const artifactHash = `sha256:${"b".repeat(64)}` as const;
const binding: ShadowFillAttemptBinding = {
  attemptId: "attempt-1",
  applicationId: "application-1",
  revisionId: "revision-1",
  revisionHash,
  artifactHash,
  authority: "FILL_ONLY_NO_SUBMIT",
};

test("the synthetic lifecycle ledger survives reload and rejects authority drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roledawn-shadow-ledger-"));
  const path = join(directory, "attempt.jsonl");
  let now = Date.parse("2026-08-16T12:00:00.000Z");
  try {
    const ledger = await SyntheticShadowFillAttemptLedger.create(path, binding, () => now);
    now += 1;
    await ledger.transition("SESSION_ACTIVE", { provider: "synthetic" });
    now += 1;
    await ledger.transition("FILLING");
    now += 1;
    await ledger.transition("READY_FOR_REVIEW", { submitAuthority: false });
    now += 1;
    await ledger.transition("CLOSED", { runtimeDestroyed: true });

    const reopened = await SyntheticShadowFillAttemptLedger.reopen(path, binding, () => now);
    assert.deepEqual(reopened.events.map((event) => event.state), [
      "CREATED",
      "SESSION_ACTIVE",
      "FILLING",
      "READY_FOR_REVIEW",
      "CLOSED",
    ]);
    assert.equal(reopened.events.every((event) => event.binding.authority === "FILL_ONLY_NO_SUBMIT"), true);
    await assert.rejects(
      SyntheticShadowFillAttemptLedger.reopen(path, { ...binding, revisionId: "revision-2" }, () => now),
      /binding does not match/,
    );
    await assert.rejects(reopened.transition("FILLING"), /Invalid shadow-fill transition/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const chromePath = findInstalledChromium();

test("a real local browser fills and uploads, reads back, and cannot submit", {
  skip: chromePath ? false : "No local Chromium executable is installed.",
}, async () => {
  if (!chromePath) return;
  let now = Date.parse("2026-08-16T12:00:00.000Z");
  const result = await runSyntheticShadowFillAcceptance({
    chromePath,
    candidate: {
      fullName: "Taylor Example",
      email: "taylor@example.test",
      phone: "+1 202 555 0198",
      workAuthorization: "YES",
    },
    applicationId: "application-1",
    revisionId: "revision-1",
    revisionHash,
    now: () => now++,
  });

  assert.deepEqual(result.readBack, {
    fullName: "Taylor Example",
    email: "taylor@example.test",
    phone: "+1 202 555 0198",
    workAuthorization: "YES",
    uploadedFile: {
      name: "candidate-resume.pdf",
      size: 55,
      type: "application/pdf",
    },
    sensitiveAttestationAnswered: false,
    submitControlDisabled: true,
    blockedDomSubmitAttempts: 1,
  });
  assert.equal(result.artifactHash.startsWith("sha256:"), true);
  assert.equal(result.submitRequestCount, 0);
  assert.deepEqual(result.ledgerEvents.map((event) => event.state), [
    "CREATED",
    "SESSION_ACTIVE",
    "FILLING",
    "READY_FOR_REVIEW",
    "CLOSED",
  ]);
  assert.equal(result.ledgerEvents.at(-1)?.summary.submitRequestCount, 0);

  // The harness surface itself has no submit or arbitrary interaction method.
  assert.equal("submit" in result, false);
  assert.equal("click" in result, false);
  assert.equal("type" in result, false);
});
