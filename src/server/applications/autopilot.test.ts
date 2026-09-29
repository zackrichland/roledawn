import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationAutopilotError, validateAutopilotDelegation, validateAutopilotLease } from "../../domain/application-autopilot.ts";
import { createApplicationAutopilotRepository, delegateApplicationAutopilot, getApplicationAutopilot, saveApplicationAutopilotAnswers } from "./autopilot.ts";

const ids = Array.from({ length: 7 }, (_, index) => `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
const lease = { id: ids[0], leaseToken: ids[1] };
const hash = "a".repeat(64);
const command = { commandId: ids[0], applicationId: ids[2], revisionId: ids[3], packetHash: hash, expectedAggregateVersion: 2 };
function client(data: unknown, error: { code?: string; message?: string } | null = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return { calls, rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data, error }; } };
}
function destinationClient(data: unknown = { job_version: { apply_url: "https://job-boards.greenhouse.io/example/jobs/1234" } }, error: { code?: string; message?: string } | null = null) {
  const reads: unknown[][] = [];
  return { ...client({ id: ids[4], replayed: true }), reads,
    from(table: string) { return { select(columns: string) { return { eq(column: string, value: string) {
      reads.push([table, columns, column, value]); return { maybeSingle: async () => ({ data, error }) };
    } }; } }; },
  };
}
test("delegation validates exact revision, packet hash and positive version before DB", async () => {
  validateAutopilotDelegation(command); validateAutopilotLease(lease);
  for (const invalid of [{ ...command, revisionId: "other" }, { ...command, packetHash: "current" }, { ...command, expectedAggregateVersion: 0 }]) {
    assert.throws(() => validateAutopilotDelegation(invalid), ApplicationAutopilotError);
  }
  const db = destinationClient();
  assert.deepEqual(await delegateApplicationAutopilot(db, command), { id: ids[4], replayed: true });
  assert.equal(db.calls[0].args.p_command_id, command.commandId);
  assert.equal(db.calls[0].args.p_packet_hash, command.packetHash);
  assert.deepEqual(db.reads, [["applications", "job_version:job_versions!applications_job_id_job_version_id_fkey(apply_url)", "id", command.applicationId]]);
});
test("delegation cannot use a caller-supplied URL to override the RLS-owned application destination", async () => {
  for (const apply_url of ["https://jobs.lever.co/example/1234", "https://jobs.ashbyhq.com/example/1234", null]) {
    const db = destinationClient({ job_version: { apply_url } });
    const forged = { ...command, destinationUrl: "https://job-boards.greenhouse.io/example/jobs/1234" };
    await assert.rejects(delegateApplicationAutopilot(db, forged), error => error instanceof ApplicationAutopilotError && error.code === "APPLICATION_AUTOPILOT_DESTINATION_UNSUPPORTED");
    assert.equal(db.calls.length, 0);
  }
});
test("delegation is denied before RPC when RLS hides the application or its related destination", async () => {
  for (const data of [null, { job_version: null }]) {
    const db = destinationClient(data);
    await assert.rejects(delegateApplicationAutopilot(db, command), ApplicationAutopilotError);
    assert.equal(db.calls.length, 0);
  }
});
test("delegation read failures are redacted and cannot queue work", async () => {
  const db = destinationClient(null, { code: "42501", message: "secret candidate destination" });
  await assert.rejects(delegateApplicationAutopilot(db, command), error => error instanceof ApplicationAutopilotError && !error.message.includes("secret"));
  assert.equal(db.calls.length, 0);
});
test("disabled candidate loader performs no DB operation", async () => {
  assert.equal(await getApplicationAutopilot({}, ids[0], false), null);
});
test("targeted claims include an exact UUID and cannot silently consume a different queue item", async () => {
  const db = client(null); const repository = createApplicationAutopilotRepository(db);
  assert.equal(await repository.claim("acceptance-worker", 300, ids[0]), null);
  assert.deepEqual(db.calls[0].args, { p_worker_id: "acceptance-worker", p_lease_seconds: 300, p_target_id: ids[0] });
  await assert.rejects(repository.claim("acceptance-worker", 300, ""), ApplicationAutopilotError);
  assert.equal(db.calls.length, 1);
  await assert.rejects(createApplicationAutopilotRepository(client({ id: ids[1] })).claim("acceptance-worker", 300, ids[0]), ApplicationAutopilotError);
});
test("submit permission requires DB attempt, exact sealed hash and request fingerprint", async () => {
  const input = { sealHash: hash, requestFingerprint: "b".repeat(64), adapterRelease: "delivery/1" };
  const db = client({ attempt_id: ids[5], idempotency_key: `autopilot:${lease.id}`, seal_hash: hash, request_fingerprint: input.requestFingerprint });
  const permit = await createApplicationAutopilotRepository(db).beginSubmit(lease, input);
  assert.equal(permit.attemptId, ids[5]); assert.equal(db.calls[0].args.p_lease_token, lease.leaseToken);
  await assert.rejects(createApplicationAutopilotRepository(client({ ...permit })).beginSubmit(lease, input), ApplicationAutopilotError);
  await assert.rejects(createApplicationAutopilotRepository(client(null, { code: "55000", message: "APPLICATION_AUTOPILOT_MUTATION_DENIED" })).beginSubmit(lease, input),
    (error) => error instanceof ApplicationAutopilotError && error.code === "APPLICATION_AUTOPILOT_MUTATION_DENIED");
});
test("read-only reconciliation and lease-scoped cleanup preserve explicit binding", async () => {
  const db = client(null); const repo = createApplicationAutopilotRepository(db);
  await repo.assertLease(lease, false); await repo.bindRuntime(lease, null); await repo.setAgentSession(lease, null);
  assert.deepEqual(db.calls.map(call => call.args), [
    { p_id: lease.id, p_lease_token: lease.leaseToken, p_mutating: false },
    { p_id: lease.id, p_lease_token: lease.leaseToken, p_kind: "BROWSER", p_reference: null },
    { p_id: lease.id, p_lease_token: lease.leaseToken, p_kind: "AGENT", p_reference: null },
  ]);
});
test("candidate answers preserve explicit false and use one authenticated command", async () => {
  const db = client({});
  const command = { commandId: ids[2], id: ids[0], expectedVersion: 3, answers: [{ questionId: ids[4], fingerprint: hash, value: false }] };
  await saveApplicationAutopilotAnswers(db, command);
  assert.equal(db.calls.length, 1); assert.deepEqual(db.calls[0].args.p_answers, command.answers);
  await assert.rejects(saveApplicationAutopilotAnswers(db, { ...command, answers: [...command.answers, ...command.answers] }), ApplicationAutopilotError);
});
test("durable ledger will not convert uncertain prior effects into new tool permission", async () => {
  const key = { sessionId: "session1", turnId: "turn1", callId: "call1", name: "fill_field", argumentsHash: hash };
  const db = client({ status: "uncertain" });
  assert.deepEqual(await createApplicationAutopilotRepository(db).ledger(lease).begin(key), { status: "uncertain" });
  assert.equal(db.calls[0].args.p_session_id, key.sessionId);
  assert.equal(db.calls[0].args.p_lease_token, lease.leaseToken);
});
test("provider and database errors cannot expose answer payloads", async () => {
  const db = { rpc: async () => { throw new Error("secret candidate answer"); } };
  await assert.rejects(createApplicationAutopilotRepository(db).assertLease(lease), error =>
    error instanceof ApplicationAutopilotError && !error.message.includes("secret candidate answer"));
  const missing = client(null, { code: "PGRST202", message: "private details" });
  await assert.rejects(createApplicationAutopilotRepository(missing).claim("worker"), error =>
    error instanceof ApplicationAutopilotError && error.code === "APPLICATION_AUTOPILOT_UNAVAILABLE");
});

test("a retry after an employer refusal gets its own numbered submit key; other keys are refused", async () => {
  const input = { sealHash: hash, requestFingerprint: "b".repeat(64), adapterRelease: "delivery/1" };
  const permit = (key: string) => createApplicationAutopilotRepository(client({ attempt_id: ids[5], idempotency_key: key, seal_hash: hash, request_fingerprint: input.requestFingerprint })).beginSubmit(lease, input);
  assert.equal((await permit(`autopilot:${lease.id}:1`)).idempotencyKey, `autopilot:${lease.id}:1`);
  for (const key of [`autopilot:${ids[1]}`, `autopilot:${lease.id}:0`, `autopilot:${lease.id}:x`, `autopilot:${lease.id}:1:2`]) {
    await assert.rejects(permit(key), ApplicationAutopilotError, key);
  }
});

test("finish accepts an employer refusal as its own outcome", async () => {
  const db = client(null);
  await createApplicationAutopilotRepository(db).finish(lease, { outcome: "NOT_ACCEPTED", failureCode: "DELIVERY_EMAIL_VERIFICATION_TIMEOUT" });
  assert.equal(db.calls[0].args.p_outcome, "NOT_ACCEPTED");
  assert.equal(db.calls[0].args.p_failure_code, "DELIVERY_EMAIL_VERIFICATION_TIMEOUT");
});
