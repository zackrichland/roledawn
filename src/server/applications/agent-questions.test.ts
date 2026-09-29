import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApplicationAgentQuestionError, type AgentQuestionBinding, type AgentQuestionDescriptor } from "../../domain/application-agent-questions.ts";
import type { Database } from "../../lib/supabase/database.types.ts";
import { createApplicationAgentQuestionRepository, listApplicationAgentQuestions, saveApplicationAgentAnswersAndResume } from "./agent-questions.ts";

const ids = Array.from({ length: 9 }, (_, index) => `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
const binding: AgentQuestionBinding = { workspaceId: ids[0], candidateId: ids[1], applicationId: ids[2], revisionId: ids[3], fillAttemptId: ids[4], computerSessionId: ids[5] };
const question: AgentQuestionDescriptor = { fieldId: "field_" + "a".repeat(64), fingerprint: "a".repeat(64), label: "Are you available?",
  kind: "BOOLEAN", options: [], required: true, reasonCode: "MISSING_EXACT_ANSWER" };
const row = { id: ids[6], field_id: question.fieldId, field_fingerprint: question.fingerprint, label: question.label,
  control_type: question.kind, options: question.options, required: true, reason_code: question.reasonCode, status: "ANSWERED",
  application_agent_answers: [{ id: ids[7], value_json: false }] };

function database(result: { data: unknown; error: { code: string; message?: string } | null }) {
  const calls: readonly unknown[][] = [];
  const mutable = calls as unknown[][];
  const builder = {
    select(value: string) { mutable.push(["select", value]); return builder; },
    eq(key: string, value: unknown) { mutable.push(["eq", key, value]); return builder; },
    in(key: string, value: unknown) { mutable.push(["in", key, value]); return builder; },
    order(key: string, value: unknown) { mutable.push(["order", key, value]); return builder; },
    limit(value: number) { mutable.push(["limit", value]); return Promise.resolve(result); },
  };
  const client = {
    from(table: string) { mutable.push(["from", table]); return builder; },
    rpc(name: string, parameters: unknown) { mutable.push(["rpc", name, parameters]); return Promise.resolve(result); },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

test("disabled questions make no database calls; enabled missing schema fails explicitly", async () => {
  const db = database({ data: null, error: { code: "42P01" } });
  assert.deepEqual(await listApplicationAgentQuestions(db.client, binding, { enabled: false }), []);
  assert.equal(db.calls.length, 0);
  await assert.rejects(listApplicationAgentQuestions(db.client, binding, { enabled: true }), (error) =>
    error instanceof ApplicationAgentQuestionError && error.code === "APPLICATION_AGENT_QUESTIONS_UNAVAILABLE");
});

test("trusted answer reads filter every binding dimension and preserve explicit false", async () => {
  const db = database({ data: [row], error: null });
  const answers = await createApplicationAgentQuestionRepository(db.client).loadAnswers({ binding, questions: [question] });
  assert.deepEqual(answers, [{ answerId: ids[7], fieldId: question.fieldId, fingerprint: question.fingerprint, value: false }]);
  for (const [column, value] of [["workspace_id", ids[0]], ["candidate_id", ids[1]], ["application_id", ids[2]],
    ["revision_id", ids[3]], ["fill_attempt_id", ids[4]], ["computer_session_id", ids[5]]]) {
    assert.ok(db.calls.some((call) => call[0] === "eq" && call[1] === column && call[2] === value));
  }
});

test("answers cannot cross changed labels, controls, choices, or fingerprints", async () => {
  for (const changed of [{ ...row, label: "A different legal question" }, { ...row, field_fingerprint: "b".repeat(64) },
    { ...row, control_type: "TEXT" }, { ...row, required: false }]) {
    const db = database({ data: [changed], error: null });
    await assert.rejects(createApplicationAgentQuestionRepository(db.client).loadAnswers({ binding, questions: [question] }),
      (error) => error instanceof ApplicationAgentQuestionError && error.code === "APPLICATION_AGENT_ANSWER_BINDING_MISMATCH");
  }
});

test("requesting questions uses only the service RPC and binds all identifiers", async () => {
  const db = database({ data: [{ ...row, status: "OPEN" }], error: null });
  const requested = await createApplicationAgentQuestionRepository(db.client).requestQuestions({ binding, questions: [question] });
  assert.equal(requested[0].status, "OPEN");
  assert.deepEqual(db.calls, [["rpc", "request_application_agent_questions", {
    p_workspace_id: ids[0], p_candidate_id: ids[1], p_application_id: ids[2], p_revision_id: ids[3],
    p_fill_attempt_id: ids[4], p_computer_session_id: ids[5], p_questions: [question],
  }]]);
});

test("saving answers and continuation is one RPC, with stable caller command", async () => {
  const db = database({ data: [{ application_id: ids[2], resume_attempt_id: ids[8], aggregate_version: 9, replayed: true }], error: null });
  const command = { commandId: ids[7], ...binding, expectedAggregateVersion: 8,
    answers: [{ questionId: ids[6], fingerprint: question.fingerprint, value: false }] };
  assert.deepEqual(await saveApplicationAgentAnswersAndResume(db.client, command), { resumeAttemptId: ids[8], aggregateVersion: 9, replayed: true });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0][1], "save_application_agent_answers_and_resume");
  const parameters = db.calls[0][2] as Record<string, unknown>;
  assert.equal(parameters.p_command_id, command.commandId);
  assert.deepEqual(parameters.p_answers, command.answers);
});

test("an empty current question set reaches the bound RPC to supersede stale open questions", async () => {
  const db = database({ data: [], error: null });
  assert.deepEqual(await createApplicationAgentQuestionRepository(db.client).requestQuestions({ binding, questions: [] }), []);
  assert.deepEqual(db.calls, [["rpc", "request_application_agent_questions", {
    p_workspace_id: ids[0], p_candidate_id: ids[1], p_application_id: ids[2], p_revision_id: ids[3],
    p_fill_attempt_id: ids[4], p_computer_session_id: ids[5], p_questions: [],
  }]]);
  const unavailable = database({ data: null, error: { code: "42P01" } });
  await assert.rejects(createApplicationAgentQuestionRepository(unavailable.client).requestQuestions({ binding, questions: [] }),
    (error) => error instanceof ApplicationAgentQuestionError && error.code === "APPLICATION_AGENT_QUESTIONS_UNAVAILABLE");
});

test("migration enforces candidate authority, immutable replies, and atomic exact continuation", async () => {
  const sql = await readFile(new URL("../../../supabase/migrations/20260916221952_application_agent_questions.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.application_agent_questions enable row level security/u);
  assert.match(sql, /alter table public\.application_agent_answers enable row level security/u);
  assert.match(sql, /candidate\.auth_user_id = \(select auth\.uid\(\)\)/u);
  assert.match(sql, /revoke all on public\.application_agent_answers from service_role/u);
  assert.match(sql, /grant select on public\.application_agent_answers to service_role/u);
  assert.match(sql, /before update on public\.application_agent_answers/u);
  assert.match(sql, /question_id uuid not null unique/u);
  assert.match(sql, /v_existing\.request_hash <> v_hash or v_existing\.actor_id <> v_actor/u);
  assert.match(sql, /v_application\.aggregate_version <> p_expected_aggregate_version/u);
  assert.match(sql, /field_fingerprint = v_answer ->> 'fingerprint'/u);
  assert.match(sql, /select \* into strict v_resume from public\.request_application_fill_resume/u);
  assert.doesNotMatch(sql, /insert into public\.(?:application_attempts|receipts|candidate_facts|candidate_fact_versions)/u);
});

test("resume forward migration fixes only the output-variable version ambiguity", async () => {
  const source = await readFile(new URL("../../../supabase/migrations/20260819061711_resume_takeover_application_fill.sql", import.meta.url), "utf8");
  const original = source.slice(source.indexOf("create function public.request_application_fill_resume("),
    source.indexOf("create function public.complete_application_fill_resume("));
  const expected = original.replace("create function public.request_application_fill_resume(", "create or replace function public.request_application_fill_resume(")
    .replace("update public.applications\n  set aggregate_version = aggregate_version + 1,\n      updated_at = statement_timestamp()\n  where id = v_application.id\n  returning aggregate_version into v_new_aggregate;",
      "update public.applications as application\n  set aggregate_version = application.aggregate_version + 1,\n      updated_at = statement_timestamp()\n  where application.id = v_application.id\n  returning application.aggregate_version into v_new_aggregate;");
  assert.notEqual(expected, original);
  const migration = await readFile(new URL("../../../supabase/migrations/20260916222023_qualify_application_fill_resume_version.sql", import.meta.url), "utf8");
  assert.equal(migration.slice(migration.indexOf("create or replace function")), expected);
});
