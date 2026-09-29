export const AGENT_QUESTION_LIMITS = Object.freeze({
  questions: 24,
  options: 80,
  labelCharacters: 1_000,
  answerCharacters: 8_000,
});

export const AGENT_QUESTION_KINDS = ["TEXT", "LONG_TEXT", "SINGLE_SELECT", "MULTI_SELECT", "BOOLEAN"] as const;
export const AGENT_QUESTION_REASONS = [
  "MISSING_EXACT_ANSWER", "SENSITIVE_REQUIRES_CANDIDATE", "AMBIGUOUS_ANSWER",
] as const;

export type AgentQuestionBinding = Readonly<{
  workspaceId: string;
  candidateId: string;
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  computerSessionId: string;
}>;

export type AgentQuestionDescriptor = Readonly<{
  fieldId: string;
  /** Hash of the current field's full schema, options, origin, and form identity. */
  fingerprint: string;
  label: string;
  kind: (typeof AGENT_QUESTION_KINDS)[number];
  required: boolean;
  options: readonly Readonly<{ value: string; label: string }>[];
  reasonCode: (typeof AGENT_QUESTION_REASONS)[number];
}>;

export type AgentQuestionValue = string | boolean | readonly string[];
export type AgentQuestionAnswer = Readonly<{
  answerId: string;
  fieldId: string;
  fingerprint: string;
  value: AgentQuestionValue;
}>;
export type ApplicationAgentQuestion = AgentQuestionDescriptor & Readonly<{
  id: string;
  status: "OPEN" | "ANSWERED" | "SUPERSEDED";
}>;

export interface ApplicationAgentQuestionRepository {
  requestQuestions(input: Readonly<{
    binding: AgentQuestionBinding;
    questions: readonly AgentQuestionDescriptor[];
  }>): Promise<readonly ApplicationAgentQuestion[]>;
  loadAnswers(input: Readonly<{
    binding: AgentQuestionBinding;
    questions: readonly AgentQuestionDescriptor[];
  }>): Promise<readonly AgentQuestionAnswer[]>;
}

export type SaveAgentQuestionAnswersCommand = Readonly<{
  commandId: string;
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  computerSessionId: string;
  expectedAggregateVersion: number;
  answers: readonly Readonly<{ questionId: string; fingerprint: string; value: AgentQuestionValue }>[];
}>;

export class ApplicationAgentQuestionError extends Error {
  readonly code: string;
  constructor(code: string, message = "RoleDawn could not save these details. Reload and try again.") {
    super(message);
    this.name = "ApplicationAgentQuestionError";
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Array.from(value).length <= limit && !CONTROL_CHARACTERS.test(value);
}
function fail(code: string): never { throw new ApplicationAgentQuestionError(code); }

export function validateAgentQuestionBinding(binding: AgentQuestionBinding): void {
  if (!record(binding) || (["workspaceId", "candidateId", "applicationId", "revisionId", "fillAttemptId", "computerSessionId"] as const)
    .some((key) => typeof binding[key] !== "string" || !UUID.test(binding[key]))) {
    fail("APPLICATION_AGENT_QUESTION_BINDING_INVALID");
  }
}

export function validateAgentQuestionDescriptors(questions: readonly AgentQuestionDescriptor[]): void {
  if (!Array.isArray(questions) || questions.length > AGENT_QUESTION_LIMITS.questions) {
    fail("APPLICATION_AGENT_QUESTION_INPUT_INVALID");
  }
  const fingerprints = new Set<string>();
  const fieldIds = new Set<string>();
  for (const question of questions) {
    if (!record(question) || !boundedText(question.fieldId, 160) ||
      typeof question.fingerprint !== "string" || !HASH.test(question.fingerprint) ||
      !boundedText(question.label, AGENT_QUESTION_LIMITS.labelCharacters) ||
      !(AGENT_QUESTION_KINDS as readonly unknown[]).includes(question.kind) || typeof question.required !== "boolean" ||
      !(AGENT_QUESTION_REASONS as readonly unknown[]).includes(question.reasonCode) || !Array.isArray(question.options) ||
      question.options.length > AGENT_QUESTION_LIMITS.options ||
      fingerprints.has(question.fingerprint) || fieldIds.has(question.fieldId)) {
      fail("APPLICATION_AGENT_QUESTION_INPUT_INVALID");
    }
    const isChoice = question.kind === "SINGLE_SELECT" || question.kind === "MULTI_SELECT";
    if ((isChoice && question.options.length === 0) || (!isChoice && question.options.length !== 0)) {
      fail("APPLICATION_AGENT_QUESTION_OPTIONS_INVALID");
    }
    const values = new Set<string>();
    for (const option of question.options) {
      if (!record(option) || !boundedText(option.value, 500) || !boundedText(option.label, 500) || values.has(option.value)) {
        fail("APPLICATION_AGENT_QUESTION_OPTIONS_INVALID");
      }
      values.add(option.value);
    }
    fingerprints.add(question.fingerprint);
    fieldIds.add(question.fieldId);
  }
}

/**
 * Display text for a question label. Some forms (Greenhouse) join a control's
 * accessible name and visible label, so the label reads twice; show it once.
 * The stored label, and the fingerprint bound to it, never change.
 */
export function displayQuestionLabel(label: string): string {
  const text = label.replace(/\s+/gu, " ").trim();
  const repeated = text.length <= 1_000 ? /^(.+?)[\s:?.!;,*]* \1[\s:?.!;,*]*$/u.exec(text) : null;
  return repeated ? repeated[1].replace(/[\s:;,]+$/u, "") : text.replace(/\s*\*$/u, "");
}

export function validateAgentQuestionAnswer(question: AgentQuestionDescriptor, value: unknown): asserts value is AgentQuestionValue {
  validateAgentQuestionDescriptors([question]);
  const options = new Set(question.options.map((option) => option.value));
  let valid = false;
  switch (question.kind) {
    case "BOOLEAN": valid = typeof value === "boolean"; break;
    case "TEXT":
    case "LONG_TEXT": valid = typeof value === "string" &&
      Array.from(value).length <= AGENT_QUESTION_LIMITS.answerCharacters &&
      (!question.required || value.trim().length > 0) && !CONTROL_CHARACTERS.test(value); break;
    case "SINGLE_SELECT": valid = typeof value === "string" && options.has(value); break;
    case "MULTI_SELECT": valid = Array.isArray(value) && value.length <= options.size &&
      (!question.required || value.length > 0) && new Set(value).size === value.length &&
      value.every((entry) => typeof entry === "string" && options.has(entry)); break;
  }
  if (!valid) fail("APPLICATION_AGENT_ANSWER_INVALID");
}

export function validateSaveAgentQuestionAnswersCommand(command: SaveAgentQuestionAnswersCommand): void {
  if (!record(command) || (["commandId", "applicationId", "revisionId", "fillAttemptId", "computerSessionId"] as const)
    .some((key) => typeof command[key] !== "string" || !UUID.test(command[key])) ||
    !Number.isSafeInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 1 ||
    !Array.isArray(command.answers) || command.answers.length < 1 || command.answers.length > AGENT_QUESTION_LIMITS.questions) {
    fail("APPLICATION_AGENT_ANSWER_INPUT_INVALID");
  }
  const ids = new Set<string>();
  for (const answer of command.answers) {
    if (!record(answer) || typeof answer.questionId !== "string" || !UUID.test(answer.questionId) ||
      typeof answer.fingerprint !== "string" || !HASH.test(answer.fingerprint) || ids.has(answer.questionId)) {
      fail("APPLICATION_AGENT_ANSWER_INPUT_INVALID");
    }
    const value = answer.value;
    if (!(typeof value === "boolean" ||
      (typeof value === "string" && Array.from(value).length <= AGENT_QUESTION_LIMITS.answerCharacters && !CONTROL_CHARACTERS.test(value)) ||
      (Array.isArray(value) && value.length <= AGENT_QUESTION_LIMITS.options &&
        new Set(value).size === value.length && value.every((entry) => boundedText(entry, 500))))) {
      fail("APPLICATION_AGENT_ANSWER_INPUT_INVALID");
    }
    ids.add(answer.questionId);
  }
}
