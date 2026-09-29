import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ApplicationAgentQuestionError,
  validateAgentQuestionAnswer,
  validateAgentQuestionBinding,
  validateAgentQuestionDescriptors,
  validateSaveAgentQuestionAnswersCommand,
  type AgentQuestionAnswer,
  type AgentQuestionBinding,
  type AgentQuestionDescriptor,
  type ApplicationAgentQuestion,
  type ApplicationAgentQuestionRepository,
  type SaveAgentQuestionAnswersCommand,
} from "../../domain/application-agent-questions.ts";
import type { Database } from "../../lib/supabase/database.types.ts";

const QUESTION_COLUMNS = "id,field_id,field_fingerprint,label,control_type,options,required,reason_code,status";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type CandidateQuestionBinding = Pick<AgentQuestionBinding, "applicationId" | "revisionId" | "fillAttemptId" | "computerSessionId">;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failForDatabaseError(error: { code?: string; message?: string }): never {
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? "")) {
    throw new ApplicationAgentQuestionError(
      "APPLICATION_AGENT_QUESTIONS_UNAVAILABLE",
      "Application questions are not available yet. Your answers were not saved.",
    );
  }
  const code = error.message?.match(/\b(?:APPLICATION_AGENT_[A-Z_]+|APPLICATION_FILL_[A-Z_]+|COMMAND_[A-Z_]+|AUTHENTICATION_REQUIRED)\b/u)?.[0]
    ?? "APPLICATION_AGENT_QUESTION_DATABASE_FAILED";
  if (code.includes("STALE") || error.code === "P0002") {
    throw new ApplicationAgentQuestionError("APPLICATION_AGENT_ANSWERS_STALE", "This application or its questions changed. Reload before saving these details.");
  }
  if (code === "APPLICATION_FILL_RESUME_STATE_INVALID" || code === "APPLICATION_AGENT_QUESTION_STATE_INVALID") {
    throw new ApplicationAgentQuestionError(code, "This form is no longer available to continue. Your answers were not saved.");
  }
  if (code === "APPLICATION_AGENT_ANSWER_INVALID") {
    throw new ApplicationAgentQuestionError(code, "Check each answer and choose only the options shown.");
  }
  throw new ApplicationAgentQuestionError(code);
}

function parseQuestion(value: unknown): ApplicationAgentQuestion {
  if (!record(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
    (value.status !== "OPEN" && value.status !== "ANSWERED" && value.status !== "SUPERSEDED")) {
    throw new ApplicationAgentQuestionError("APPLICATION_AGENT_QUESTION_PROTOCOL_INVALID");
  }
  const descriptor = {
    fieldId: value.field_id,
    fingerprint: value.field_fingerprint,
    label: value.label,
    kind: value.control_type,
    options: value.options,
    required: value.required,
    reasonCode: value.reason_code,
  } as AgentQuestionDescriptor;
  validateAgentQuestionDescriptors([descriptor]);
  return Object.freeze({ ...descriptor, id: value.id, status: value.status });
}

function sameDescriptor(left: AgentQuestionDescriptor, right: AgentQuestionDescriptor): boolean {
  return left.fieldId === right.fieldId && left.fingerprint === right.fingerprint &&
    left.label === right.label && left.kind === right.kind && left.required === right.required &&
    left.options.length === right.options.length && left.options.every((option, index) =>
      option.value === right.options[index].value && option.label === right.options[index].label);
}

function validateCandidateBinding(binding: CandidateQuestionBinding): void {
  if (!record(binding) || (["applicationId", "revisionId", "fillAttemptId", "computerSessionId"] as const)
    .some((key) => typeof binding[key] !== "string" || !UUID.test(binding[key]))) {
    throw new ApplicationAgentQuestionError("APPLICATION_AGENT_QUESTION_BINDING_INVALID");
  }
}

/** Caller supplies an ordinary authenticated client; RLS owns candidate access. */
export async function listApplicationAgentQuestions(
  supabase: SupabaseClient<Database>,
  binding: CandidateQuestionBinding,
  options: Readonly<{ enabled: boolean }>,
): Promise<readonly ApplicationAgentQuestion[]> {
  if (!options.enabled) return Object.freeze([]);
  validateCandidateBinding(binding);
  // Validate the JSON/relation shape at this adapter boundary as well as in SQL.
  const client = supabase as unknown as SupabaseClient;
  const { data, error } = await client.from("application_agent_questions")
    .select(QUESTION_COLUMNS)
    .eq("application_id", binding.applicationId)
    .eq("revision_id", binding.revisionId)
    .eq("fill_attempt_id", binding.fillAttemptId)
    .eq("computer_session_id", binding.computerSessionId)
    .eq("status", "OPEN")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(25);
  if (error) failForDatabaseError(error);
  if (!Array.isArray(data) || data.length > 24) {
    throw new ApplicationAgentQuestionError("APPLICATION_AGENT_QUESTION_PROTOCOL_INVALID");
  }
  return Object.freeze(data.map(parseQuestion));
}

/** Worker-only repository. It never creates replies or receives model answer text. */
export function createApplicationAgentQuestionRepository(
  supabase: SupabaseClient<Database>,
): ApplicationAgentQuestionRepository {
  const client = supabase as unknown as SupabaseClient;
  return Object.freeze({
    async requestQuestions({ binding, questions }: Parameters<ApplicationAgentQuestionRepository["requestQuestions"]>[0]) {
      validateAgentQuestionBinding(binding);
      validateAgentQuestionDescriptors(questions);
      // An empty current set supersedes earlier unanswered questions for this
      // exact session, so it must cross the same binding and transaction gate.
      const { data, error } = await client.rpc("request_application_agent_questions", {
        p_workspace_id: binding.workspaceId,
        p_candidate_id: binding.candidateId,
        p_application_id: binding.applicationId,
        p_revision_id: binding.revisionId,
        p_fill_attempt_id: binding.fillAttemptId,
        p_computer_session_id: binding.computerSessionId,
        p_questions: questions,
      });
      if (error) failForDatabaseError(error);
      if (!Array.isArray(data) || data.length !== questions.length) {
        throw new ApplicationAgentQuestionError("APPLICATION_AGENT_QUESTION_PROTOCOL_INVALID");
      }
      const parsed = data.map(parseQuestion);
      if (new Set(parsed.map((question) => question.fingerprint)).size !== questions.length ||
        parsed.some((question) => !questions.some((expected) => sameDescriptor(question, expected)))) {
        throw new ApplicationAgentQuestionError("APPLICATION_AGENT_QUESTION_PROTOCOL_INVALID");
      }
      return Object.freeze(parsed);
    },
    async loadAnswers({ binding, questions }: Parameters<ApplicationAgentQuestionRepository["loadAnswers"]>[0]) {
      validateAgentQuestionBinding(binding);
      validateAgentQuestionDescriptors(questions);
      if (questions.length === 0) return Object.freeze([]);
      const { data, error } = await client.from("application_agent_questions")
        .select(`${QUESTION_COLUMNS},application_agent_answers(id,value_json)`)
        .eq("workspace_id", binding.workspaceId)
        .eq("candidate_id", binding.candidateId)
        .eq("application_id", binding.applicationId)
        .eq("revision_id", binding.revisionId)
        .eq("fill_attempt_id", binding.fillAttemptId)
        .eq("computer_session_id", binding.computerSessionId)
        .eq("status", "ANSWERED")
        .in("field_fingerprint", questions.map((question) => question.fingerprint))
        .limit(25);
      if (error) failForDatabaseError(error);
      if (!Array.isArray(data) || data.length > questions.length) {
        throw new ApplicationAgentQuestionError("APPLICATION_AGENT_QUESTION_PROTOCOL_INVALID");
      }
      const answers: AgentQuestionAnswer[] = [];
      const seen = new Set<string>();
      for (const row of data) {
        const question = parseQuestion(row);
        const expected = questions.find((item) => item.fieldId === question.fieldId && item.fingerprint === question.fingerprint);
        if (!expected || !sameDescriptor(question, expected) || seen.has(question.fingerprint)) {
          throw new ApplicationAgentQuestionError("APPLICATION_AGENT_ANSWER_BINDING_MISMATCH");
        }
        const relation: unknown = row.application_agent_answers;
        const answer = Array.isArray(relation) && relation.length === 1 ? relation[0] : relation;
        if (!record(answer) || typeof answer.id !== "string" || !UUID.test(answer.id)) {
          throw new ApplicationAgentQuestionError("APPLICATION_AGENT_ANSWER_PROTOCOL_INVALID");
        }
        validateAgentQuestionAnswer(question, answer.value_json);
        seen.add(question.fingerprint);
        answers.push(Object.freeze({
          answerId: answer.id,
          fieldId: question.fieldId,
          fingerprint: question.fingerprint,
          value: answer.value_json,
        }));
      }
      return Object.freeze(answers);
    },
  });
}

export async function saveApplicationAgentAnswersAndResume(
  supabase: SupabaseClient<Database>,
  command: SaveAgentQuestionAnswersCommand,
): Promise<Readonly<{ resumeAttemptId: string; aggregateVersion: number; replayed: boolean }>> {
  validateSaveAgentQuestionAnswersCommand(command);
  const client = supabase as unknown as SupabaseClient;
  const { data, error } = await client.rpc("save_application_agent_answers_and_resume", {
    p_command_id: command.commandId,
    p_application_id: command.applicationId,
    p_revision_id: command.revisionId,
    p_fill_attempt_id: command.fillAttemptId,
    p_computer_session_id: command.computerSessionId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
    p_answers: command.answers,
  });
  if (error) failForDatabaseError(error);
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!record(row) || row.application_id !== command.applicationId ||
    typeof row.resume_attempt_id !== "string" || !UUID.test(row.resume_attempt_id) ||
    typeof row.aggregate_version !== "number" || !Number.isSafeInteger(row.aggregate_version) || row.aggregate_version < 1 ||
    typeof row.replayed !== "boolean") {
    throw new ApplicationAgentQuestionError("APPLICATION_AGENT_ANSWER_PROTOCOL_INVALID");
  }
  return Object.freeze({ resumeAttemptId: row.resume_attempt_id, aggregateVersion: row.aggregate_version, replayed: row.replayed });
}
