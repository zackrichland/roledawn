import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createHostedReservationRehearsal } from "../src/test-support/hosted-task-reservation-rehearsal.ts";
import { reserveHostedTaskModel, beginHostedTaskAdmissionModel, interruptHostedTaskModel,
  checkHostedAdmissionReplayModel, reconcileHostedTaskModel } from "../src/domain/hosted-task-admission-model.ts";
const candidate = "10000000-0000-4000-8000-000000000001";
const input = { applicationId: "10000000-0000-4000-8000-000000000002", sessionId: "sess_fixture",
  destinationUrl: "https://jobs.ashbyhq.com/fixture/10000000-0000-4000-8000-000000000003/application",
  packetSha256: "a".repeat(64), admissionKey: "admit_fixture", message: "Synthetic immutable task" };
const other = { ...input, applicationId: "10000000-0000-4000-8000-000000000004", sessionId: "sess_other", packetSha256: "c".repeat(64) };

test("persistent reservation excludes both provider owners across packet changes and restart", async () => {
  const path = await mkdtemp(join(tmpdir(), "roledawn-hosted-rehearsal-"));
  let db = new PGlite(path);
  try {
    let store = await createHostedReservationRehearsal(db);
    assert.equal(await store.reserve(candidate, "OPENAI_HOSTED", reserveHostedTaskModel(input)), true);
    assert.equal(await store.reserve(candidate, "BROWSERBASE", reserveHostedTaskModel(other)), false);
    const armed = await store.transition(input.applicationId, 0, beginHostedTaskAdmissionModel);
    assert.equal(armed.model.possibleEgress, true);
    await db.close(); db = new PGlite(path); store = await createHostedReservationRehearsal(db);
    const retained = await store.read(input.applicationId);
    assert.equal(retained?.model.binding.admissionKey, input.admissionKey);
    assert.equal(retained?.model.phase, "ADMISSION_PENDING");
    const lost = await store.transition(input.applicationId, 1, interruptHostedTaskModel);
    assert.equal(lost.model.phase, "UNCERTAIN"); assert.equal(lost.model.automaticRetryAllowed, false);
    await assert.rejects(store.transition(input.applicationId, 2, state => ({ ...state, phase: "RESERVED" })), /CONFLICT/);
    assert.equal(await store.reserve(candidate, "BROWSERBASE", reserveHostedTaskModel(other)), false);
    assert.equal(checkHostedAdmissionReplayModel(lost.model, input), lost.model);
    await assert.rejects(store.transition(input.applicationId, 1, interruptHostedTaskModel), /CONFLICT/);
    await assert.rejects(store.transition(input.applicationId, 2, state => ({ ...state, binding: { ...state.binding, packetSha256: "d".repeat(64) } })), /CONFLICT/);
    const confirmed = await store.transition(input.applicationId, 2, state => reconcileHostedTaskModel(state, {
      source: "VERIFIED_EMPLOYER_EVIDENCE", applicationId: input.applicationId, destinationUrl: input.destinationUrl,
      packetSha256: input.packetSha256, outcome: "CONFIRMED", evidenceSha256: "b".repeat(64),
    }));
    assert.equal(confirmed.model.phase, "CONFIRMED");
    await assert.rejects(store.transition(input.applicationId, 3, state => ({ ...state, phase: "ADMITTED" })), /CONFLICT/);
    assert.equal(await store.reserve(candidate, "BROWSERBASE", reserveHostedTaskModel(other)), false);
  } finally { await db.close(); await rm(path, { recursive: true, force: true }); }
});

test("competing reservations have one winner; failed transaction leaves immutable reservation intact", async () => {
  const db = new PGlite();
  try {
    const store = await createHostedReservationRehearsal(db);
    const results = await Promise.all([
      store.reserve(candidate, "OPENAI_HOSTED", reserveHostedTaskModel(input)),
      store.reserve(candidate, "BROWSERBASE", reserveHostedTaskModel(other)),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const winner = results[0] ? input : other;
    await assert.rejects(store.transition(winner.applicationId, 0, () => { throw new Error("simulated crash before commit"); }), /simulated crash/);
    assert.equal((await store.read(winner.applicationId))?.model.phase, "RESERVED");
    const starts = await Promise.allSettled([
      store.transition(winner.applicationId, 0, beginHostedTaskAdmissionModel),
      store.transition(winner.applicationId, 0, beginHostedTaskAdmissionModel),
    ]);
    assert.equal(starts.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await store.read(winner.applicationId))?.model.possibleEgress, true);
  } finally { await db.close(); }
});
