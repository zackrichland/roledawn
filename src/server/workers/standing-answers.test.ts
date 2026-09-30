import assert from "node:assert/strict";
import test from "node:test";

import type { AgentQuestionDescriptor } from "../../domain/application-agent-questions.ts";
import { acceptStandingAnswer, createStandingAnswerResolver, standingAnswerEligible } from "./standing-answers.ts";

const GPA_ID = "7f0c2f64-5a52-4b51-9d1e-7c1c0f3f7a10";
const ONSITE_ID = "0b6f0d9e-2f7a-4c3e-8a55-3a0d4d9f1b22";

function question(label: string, kind: AgentQuestionDescriptor["kind"], options: readonly string[] = [], extra: Partial<AgentQuestionDescriptor> = {}): AgentQuestionDescriptor {
  const fingerprint = Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64);
  return {
    fieldId: `field_${fingerprint}`, fingerprint, label, kind, required: true, reasonCode: "MISSING_EXACT_ANSWER",
    options: options.map((option, index) => ({ value: `option-${index}`, label: option })), ...extra,
  };
}

const gpa = question("What were your undergrad and grad school (if applicable) GPAs? *", "MULTI_SELECT", ["< 3.0", "3.0 - 3.19", "3.2 - 3.39", "3.4 - 3.59", "3.6 - 3.79", "3.8 - 4.0"]);
const onsite = question("Are you able to work 5 days on-site in Tempe, Arizona for this position?", "SINGLE_SELECT", ["Yes", "No"]);
const sponsorship = question("Will you require visa sponsorship in the future?", "SINGLE_SELECT", ["Yes", "No"], { reasonCode: "SENSITIVE_REQUIRES_CANDIDATE" });
const basis = new Map([["s1", GPA_ID], ["s2", ONSITE_ID], ["f:work_authorization.us.sponsorship_required", "fact:work_authorization.us.sponsorship_required"], ["f:location.city", "fact:location.city"]]);
const draft = (choices: string[], ids: string[], text = "") => ({ questionId: "q1", decision: "ANSWER", choices, text, basis: ids });

test("demographic, legal, consent and optional questions always stay with the candidate", () => {
  assert.equal(standingAnswerEligible(gpa), true);
  assert.equal(standingAnswerEligible(onsite), true);
  for (const label of ["Gender", "Are you a protected veteran?", "Have you ever been convicted of a felony?", "I agree to the privacy policy", "Signature", "Are you a U.S. citizen?"]) {
    assert.equal(standingAnswerEligible(question(label, "SINGLE_SELECT", ["Yes", "No"])), false, label);
  }
  assert.equal(standingAnswerEligible({ ...gpa, required: false }), false);
});

test("an answer is kept only with choices on the form and cited saved answers", () => {
  const kept = acceptStandingAnswer(gpa, draft(["3.4 - 3.59"], ["s1"]), basis);
  assert.deepEqual(kept?.value, ["option-3"]);
  assert.deepEqual(kept?.basis, [GPA_ID]);
  // Punctuation and case differences still name exactly one option.
  assert.deepEqual(acceptStandingAnswer(gpa, draft(["3.4-3.59"], ["s1"]), basis)?.value, ["option-3"]);
  assert.equal(acceptStandingAnswer(gpa, draft(["3.5"], ["s1"]), basis), null, "not an option");
  assert.equal(acceptStandingAnswer(gpa, draft(["3.4 - 3.59"], []), basis), null, "no basis");
  assert.equal(acceptStandingAnswer(gpa, draft(["3.4 - 3.59"], ["s9"]), basis), null, "unknown basis");
  assert.equal(acceptStandingAnswer(onsite, draft(["Yes", "No"], ["s2"]), basis), null, "two choices for one");
  assert.equal(acceptStandingAnswer(onsite, { ...draft(["Yes"], ["s2"]), decision: "ASK_CANDIDATE" }, basis), null);
  assert.equal(acceptStandingAnswer(onsite, draft(["Yes"], ["s2"]), basis)?.value, "option-0");
  assert.equal(acceptStandingAnswer(question("Can you start in two weeks?", "BOOLEAN"), draft(["Yes"], ["s2"]), basis)?.value, true);
  assert.equal(acceptStandingAnswer(question("Undergraduate GPA", "TEXT"), draft([], ["s1"], " 3.5 "), basis)?.value, "3.5");
  assert.equal(acceptStandingAnswer(question("Undergraduate GPA", "TEXT"), draft([], ["s1"], ""), basis), null);
});

test("a sensitive question may rest only on standing answers or work-authorization facts", () => {
  assert.equal(acceptStandingAnswer(sponsorship, draft(["No"], ["f:work_authorization.us.sponsorship_required"]), basis)?.value, "option-1");
  assert.equal(acceptStandingAnswer(sponsorship, draft(["No"], ["f:location.city"]), basis), null);
});

test("the resolver sends short ids only, skips ineligible questions, and maps the model's answers", async () => {
  const calls: { input: string; schema: unknown }[] = [];
  const client = { responses: { async create(request: { input: { content: { text: string }[] }[]; text: { format: { schema: unknown } } }) {
    calls.push({ input: request.input[0].content[0].text, schema: request.text.format.schema });
    return { status: "completed", output_text: JSON.stringify({ answers: [
      { questionId: "q1", decision: "ANSWER", choices: ["3.4 - 3.59"], text: "", basis: ["s1"] },
      { questionId: "q2", decision: "ANSWER", choices: ["Yes"], text: "", basis: ["s2"] },
      { questionId: "q3", decision: "ASK_CANDIDATE", choices: [], text: "", basis: [] },
    ] }) };
  } } };
  const resolver = createStandingAnswerResolver({ client: client as never });
  const why = question("Why do you want to work here?", "LONG_TEXT");
  const result = await resolver.resolve({
    questions: [gpa, question("Gender", "SINGLE_SELECT", ["Man", "Woman", "Decline to self-identify"]), onsite, why],
    context: { answers: [{ id: GPA_ID, topic: "Undergraduate GPA", answer: "3.5" }, { id: ONSITE_ID, topic: "Able to work on-site", answer: "Yes" }],
      job: { title: "Strategy Analyst", employer: "Carvana", location: "Tempe, AZ", workMode: null } },
    facts: [{ factKey: "identity.legal_name", value: "Private Person" }, { factKey: "work_authorization.us.sponsorship_required", value: "false" }],
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].input, /Gender|Private Person|identity\.legal_name/u, "ineligible questions and identity facts never reach the model");
  assert.doesNotMatch(calls[0].input, new RegExp(`${GPA_ID}|${gpa.fingerprint}`, "u"), "database ids and fingerprints stay out of the prompt");
  assert.match(calls[0].input, /work_authorization\.us\.sponsorship_required/u);
  assert.deepEqual(result.map((item) => [item.descriptor.fieldId, item.value, item.basis]), [
    [gpa.fieldId, ["option-3"], [GPA_ID]],
    [onsite.fieldId, "option-0", [ONSITE_ID]],
  ]);
});

test("no model call without an eligible question or anything saved to use", async () => {
  let called = false;
  const resolver = createStandingAnswerResolver({ client: { responses: { async create() { called = true; throw new Error("UNREACHABLE"); } } } as never });
  assert.deepEqual(await resolver.resolve({ questions: [question("Gender", "SINGLE_SELECT", ["Man"])], context: { answers: [{ id: GPA_ID, topic: "GPA", answer: "3.5" }], job: null }, facts: [] }), []);
  assert.deepEqual(await resolver.resolve({ questions: [gpa], context: { answers: [], job: null }, facts: [{ factKey: "identity.legal_name", value: "x" }] }), []);
  assert.equal(called, false);
});
