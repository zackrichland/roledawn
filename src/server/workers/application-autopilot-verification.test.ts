import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationAutopilotClaim } from "../../domain/application-autopilot.ts";
import type { ApplicationAutopilotStore, AutopilotVerificationState } from "../applications/autopilot.ts";
import { createAutopilotVerificationRelay, createExtendableBudget } from "./application-autopilot.ts";

const claim = { id: "10000000-0000-4000-8000-000000000001", leaseToken: "20000000-0000-4000-8000-000000000002" } as ApplicationAutopilotClaim;
const REQUEST = "30000000-0000-4000-8000-000000000003";

function harness(states: readonly (AutopilotVerificationState | null)[]) {
  let clock = 1_000_000;
  const calls: string[] = [];
  let reads = 0;
  const repository = {
    async extendLease(_lease: unknown, seconds: number) { calls.push(`extend:${seconds}`); },
    async requestVerification(_lease: unknown, input: { recipientHint: string; retry: boolean }) { calls.push(`request:${input.recipientHint}:${input.retry}`); return REQUEST; },
    async readVerification() { const state = states[Math.min(reads, states.length - 1)]; reads += 1; return state; },
    async settleVerification(_lease: unknown, id: string, outcome: string) { calls.push(`settle:${id === REQUEST}:${outcome}`); },
  } as unknown as ApplicationAutopilotStore;
  const extended: number[] = [];
  const budget = { signal: new AbortController().signal, deadline: () => 0, extendTo(next: number) { extended.push(next); }, clear() {} };
  return { repository, budget, calls, extended, now: () => clock, sleep: async (ms: number) => { clock += ms; }, advance: (ms: number) => { clock += ms; } };
}

test("the relay returns the candidate's code once, keeps the lease and settles it as used", async () => {
  const h = harness([{ id: REQUEST, status: "REQUESTED", code: null }, { id: REQUEST, status: "PROVIDED", code: "ABCD1234" }]);
  const relay = createAutopilotVerificationRelay({ claim, repository: h.repository, budget: h.budget, hardDeadline: h.now() + 14 * 60_000, now: h.now, sleep: h.sleep, pollMs: 2_000 });
  assert.equal(await relay.requestCode({ recipient: "z***@example.test", retry: false }), "ABCD1234");
  assert.deepEqual(h.calls, ["extend:600", "request:z***@example.test:false", `settle:true:USED`]);
  assert.equal(h.extended.length, 1);
  assert.ok(h.extended[0] > h.now());
});

test("no code before the wait ends expires the request and returns nothing", async () => {
  const h = harness([{ id: REQUEST, status: "REQUESTED", code: null }]);
  const relay = createAutopilotVerificationRelay({ claim, repository: h.repository, budget: h.budget, hardDeadline: h.now() + 14 * 60_000, now: h.now, sleep: h.sleep, waitMs: 60_000, pollMs: 2_000 });
  assert.equal(await relay.requestCode({ recipient: "z***@example.test", retry: true }), null);
  assert.deepEqual(h.calls.slice(0, 2), ["extend:600", "request:z***@example.test:true"]);
  assert.equal(h.calls.at(-1), "settle:true:EXPIRED");
});

test("a superseded or expired request stops the wait without a code", async () => {
  for (const state of [{ id: REQUEST, status: "EXPIRED" as const, code: null }, { id: "40000000-0000-4000-8000-000000000004", status: "PROVIDED" as const, code: "ZZZZ9999" }, null]) {
    const h = harness([state]);
    const relay = createAutopilotVerificationRelay({ claim, repository: h.repository, budget: h.budget, hardDeadline: h.now() + 14 * 60_000, now: h.now, sleep: h.sleep });
    assert.equal(await relay.requestCode({ recipient: "z***@example.test", retry: false }), null, JSON.stringify(state));
    assert.ok(!h.calls.some((call) => call.includes("USED")));
  }
});

test("without enough time left before the host limit, no request is made", async () => {
  const h = harness([{ id: REQUEST, status: "PROVIDED", code: "ABCD1234" }]);
  const relay = createAutopilotVerificationRelay({ claim, repository: h.repository, budget: h.budget, hardDeadline: h.now() + 60_000, now: h.now, sleep: h.sleep });
  assert.equal(await relay.requestCode({ recipient: "z***@example.test", retry: false }), null);
  assert.deepEqual(h.calls, []);
});

test("the run budget can move later but never earlier, and aborts at its deadline", async () => {
  const budget = createExtendableBudget(40);
  const first = budget.deadline();
  budget.extendTo(first - 20);
  assert.equal(budget.deadline(), first);
  budget.extendTo(first + 40);
  assert.equal(budget.deadline(), first + 40);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(budget.signal.aborted, false, "the extension moved the deadline");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(budget.signal.aborted, true);
  budget.clear();
});

function mailboxHarness(reader: { findCode: (query: { since: number; employerHint?: string | null; exclude?: ReadonlySet<string> }) => Promise<string | null> } | null) {
  let clock = 2_000_000;
  const calls: string[] = [];
  let provided: string | null = null;
  const repository = {
    async extendLease() { calls.push("extend"); },
    async requestVerification() { calls.push("request"); provided = null; return REQUEST; },
    async readVerification() { return provided ? { id: REQUEST, status: "PROVIDED" as const, code: provided } : { id: REQUEST, status: "REQUESTED" as const, code: null }; },
    async settleVerification(_lease: unknown, _id: string, outcome: string) { calls.push(`settle:${outcome}`); },
    async provideVerificationFromMailbox(_lease: unknown, _id: string, code: string) { calls.push(`mailbox:${code}`); provided = code; },
    async recordMailboxUse(_lease: unknown, error: string | null) { calls.push(`use:${error ?? "ok"}`); },
  } as unknown as ApplicationAutopilotStore;
  const budget = { signal: new AbortController().signal, deadline: () => 0, extendTo() {}, clear() {} };
  const relay = createAutopilotVerificationRelay({ claim, repository, budget, hardDeadline: clock + 14 * 60_000, now: () => clock,
    sleep: async (ms: number) => { clock += ms; }, waitMs: 60_000, pollMs: 2_000, mailboxPollMs: 5_000, employerHint: "carvana",
    mailbox: async () => reader });
  return { relay, calls };
}

test("a code found in the connected mailbox answers the request without the candidate", async () => {
  const queries: { employerHint?: string | null }[] = [];
  const { relay, calls } = mailboxHarness({ async findCode(query) { queries.push(query); return "MAIL1234"; } });
  assert.equal(await relay.requestCode({ recipient: "z***@example.test", retry: false }), "MAIL1234");
  assert.deepEqual(calls.filter((call) => !call.startsWith("extend")), ["request", "mailbox:MAIL1234", "use:ok", "settle:USED"]);
  assert.equal(queries[0].employerHint, "carvana");
});

test("a used code is excluded next round, and a revoked mailbox falls back to the candidate", async () => {
  const seen: string[][] = [];
  const first = mailboxHarness({ async findCode(query) { seen.push([...(query.exclude ?? [])]); return seen.length === 1 ? "MAIL1234" : null; } });
  assert.equal(await first.relay.requestCode({ recipient: "z", retry: false }), "MAIL1234");
  assert.equal(await first.relay.requestCode({ recipient: "z", retry: true }), null);
  assert.deepEqual(seen[1], ["MAIL1234"], "the rejected code is never tried again");

  let reads = 0;
  const revoked = mailboxHarness({ async findCode() { reads += 1; throw new Error("MAILBOX_TOKEN_REVOKED"); } });
  assert.equal(await revoked.relay.requestCode({ recipient: "z", retry: false }), null);
  assert.equal(reads, 1, "a revoked mailbox is not retried");
  assert.ok(revoked.calls.includes("use:MAILBOX_TOKEN_REVOKED"));
  assert.equal(revoked.calls.at(-1), "settle:EXPIRED");
});

test("browser verification bounds provider/host lifetime, renews the lease and clears public metadata", async () => {
 const { createAutopilotBrowserVerificationRelay } = await import('./application-autopilot.ts');
 let clock = Date.now(); const stages: string[] = []; const data: unknown[] = []; let assertions = 0; let renewals = 0;
 const budget = createExtendableBudget(10_000, () => clock);
 const repository = {
  async assertLease() { assertions++; }, async extendLease() { renewals++; },
  async checkpoint(_lease: unknown, input: { stage: string; data: unknown }) { stages.push(input.stage); data.push(input.data); },
 };
 try {
  const relay = createAutopilotBrowserVerificationRelay({ claim, repository, budget, now: () => clock,
   hardDeadline: clock + 250_000, runtimeExpiresAt: new Date(clock + 200_000).toISOString() });
  const deadline = await relay.open(); assert.equal(deadline, clock + 155_000);
  assert.equal(budget.deadline(), clock + 195_000); assert.equal(renewals, 1);
  await relay.poll(); clock += 120_001; await relay.poll(); assert.equal(renewals, 2); assert.equal(assertions, 3);
  await relay.close(); assert.deepEqual(stages, ['BROWSER_VERIFICATION','BROWSER_VERIFICATION_CLOSED']);
  assert.deepEqual(data.at(-1), { browserVerificationExpiresAt: null });
  const expired = createAutopilotBrowserVerificationRelay({ claim, repository, budget, now: () => clock, hardDeadline: clock + 60_000, runtimeExpiresAt: new Date(clock + 30_000).toISOString() });
  assert.equal(await expired.open(), null);
 } finally { budget.clear(); }
});
