import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationAgentQuestionError,
  displayQuestionLabel,
  validateAgentQuestionAnswer,
  validateAgentQuestionBinding,
  validateAgentQuestionDescriptors,
  validateSaveAgentQuestionAnswersCommand,
  type AgentQuestionDescriptor,
} from "./application-agent-questions.ts";

const id = "11111111-1111-4111-8111-111111111111";
const fingerprint = "a".repeat(64);
const question: AgentQuestionDescriptor = {
  fieldId: `field_${fingerprint}`, fingerprint, label: "When could you start?", kind: "TEXT",
  required: true, options: [], reasonCode: "MISSING_EXACT_ANSWER",
};
function rejects(run: () => void, code: string) {
  assert.throws(run, (error) => error instanceof ApplicationAgentQuestionError && error.code === code);
}

test("missing-answer contract requires full exact binding and unique field fingerprints", () => {
  validateAgentQuestionBinding({ workspaceId: id, candidateId: id, applicationId: id, revisionId: id, fillAttemptId: id, computerSessionId: id });
  rejects(() => validateAgentQuestionBinding({ workspaceId: id } as never), "APPLICATION_AGENT_QUESTION_BINDING_INVALID");
  validateAgentQuestionDescriptors([question]);
  rejects(() => validateAgentQuestionDescriptors([question, question]), "APPLICATION_AGENT_QUESTION_INPUT_INVALID");
  rejects(() => validateAgentQuestionDescriptors([{ ...question, fingerprint: "not-a-schema-hash" }]), "APPLICATION_AGENT_QUESTION_INPUT_INVALID");
  rejects(() => validateAgentQuestionDescriptors(Array.from({ length: 25 }, () => question)), "APPLICATION_AGENT_QUESTION_INPUT_INVALID");
});

test("sensitive booleans preserve an explicit no and cannot be inferred from strings", () => {
  const sensitive = { ...question, kind: "BOOLEAN", reasonCode: "SENSITIVE_REQUIRES_CANDIDATE" } as const;
  validateAgentQuestionAnswer(sensitive, false);
  validateAgentQuestionAnswer(sensitive, true);
  for (const value of ["false", "No", "", null, undefined, 0]) {
    rejects(() => validateAgentQuestionAnswer(sensitive, value), "APPLICATION_AGENT_ANSWER_INVALID");
  }
});

test("choice answers can only contain the exact displayed option values", () => {
  const choice = { ...question, kind: "SINGLE_SELECT", options: [{ value: "one", label: "First" }, { value: "two", label: "Second" }] } as const;
  validateAgentQuestionAnswer(choice, "two");
  rejects(() => validateAgentQuestionAnswer(choice, "Second"), "APPLICATION_AGENT_ANSWER_INVALID");
  rejects(() => validateAgentQuestionAnswer(choice, "invented"), "APPLICATION_AGENT_ANSWER_INVALID");
  const multi = { ...choice, kind: "MULTI_SELECT" } as const;
  validateAgentQuestionAnswer(multi, ["one", "two"]);
  for (const value of [["one", "one"], ["three"], [], "one"]) {
    rejects(() => validateAgentQuestionAnswer(multi, value), "APPLICATION_AGENT_ANSWER_INVALID");
  }
  validateAgentQuestionAnswer({ ...multi, required: false }, []);
  rejects(() => validateAgentQuestionDescriptors([{ ...choice, options: [...choice.options, choice.options[0]] }]), "APPLICATION_AGENT_QUESTION_OPTIONS_INVALID");
});

test("answer text is bounded and blank required or control-character values fail", () => {
  validateAgentQuestionAnswer(question, "Two weeks after accepting an offer");
  for (const value of ["   ", "a".repeat(8001), "hello\u0001world", { injected: true }]) {
    rejects(() => validateAgentQuestionAnswer(question, value), "APPLICATION_AGENT_ANSWER_INVALID");
  }
  validateAgentQuestionAnswer({ ...question, required: false }, "");
});

test("save commands require exact version, unique question IDs, and bounded reply values", () => {
  const command = { commandId: id, applicationId: id, revisionId: id, fillAttemptId: id, computerSessionId: id,
    expectedAggregateVersion: 8, answers: [{ questionId: id, fingerprint, value: false }] };
  validateSaveAgentQuestionAnswersCommand(command);
  rejects(() => validateSaveAgentQuestionAnswersCommand({ ...command, expectedAggregateVersion: 0 }), "APPLICATION_AGENT_ANSWER_INPUT_INVALID");
  rejects(() => validateSaveAgentQuestionAnswersCommand({ ...command, answers: [...command.answers, ...command.answers] }), "APPLICATION_AGENT_ANSWER_INPUT_INVALID");
  rejects(() => validateSaveAgentQuestionAnswersCommand({ ...command, answers: [] }), "APPLICATION_AGENT_ANSWER_INPUT_INVALID");
  rejects(() => validateSaveAgentQuestionAnswersCommand(null as never), "APPLICATION_AGENT_ANSWER_INPUT_INVALID");
});

test("question labels repeated by the form are shown once, without the form's own required marker", () => {
  assert.equal(displayQuestionLabel("Email Email*"), "Email");
  assert.equal(displayQuestionLabel("How did you hear about this job? Name the employee: How did you hear about this job? Name the employee:*"),
    "How did you hear about this job? Name the employee");
  assert.equal(displayQuestionLabel("Phone Country*"), "Phone Country");
  assert.equal(displayQuestionLabel("Do you have a Bachelor's degree? *"), "Do you have a Bachelor's degree?");
  assert.equal(displayQuestionLabel("Yes or no: yes or no"), "Yes or no: yes or no");
  assert.equal(displayQuestionLabel("  Portfolio   URL "), "Portfolio URL");
});
