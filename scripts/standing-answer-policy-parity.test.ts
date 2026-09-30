import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";

import type { AgentQuestionDescriptor } from "../src/domain/application-agent-questions.ts";
import { createStandingAnswerResolver, exactStandingAnswerValue, EXACT_CLEARANCE_TOPIC, standingAnswerEligible } from "../src/server/workers/standing-answers.ts";

import { APPLICATION_ACKNOWLEDGEMENTS_AUTHORIZATION, APPLICATION_ACKNOWLEDGEMENTS_TOPIC, delegatedAcknowledgementValue } from "../src/domain/application-delegated-acknowledgements.ts";

let db: PGlite;
before(async () => {
  // The shared harness is JavaScript; a URL import keeps its local-only setup
  // reusable without widening this repository's TypeScript include settings.
  const harness = await import(new URL("./migration-harness.mjs", import.meta.url).href) as {
    createMigratedDatabase(): Promise<{ db: PGlite }>;
  };
  ({ db } = await harness.createMigratedDatabase());
});
after(async () => { await db?.close(); });

test("exact clearance subscriptions have identical SQL and worker scope and choice mapping", async () => {
  const labels = ["Do you currently possess an active TS/SCI with FSP or CI?", "Do you have an active TS/SCI clearance with FSP or CI?", " DO YOU CURRENTLY possess an active TS/SCI with FSP or CI? * ", "Do you have security clearance?", "Do you currently possess an active TS/SCI?", "Do you currently possess an active TS/SCI with FSP and CI?", "Do you not currently possess an active TS/SCI with FSP or CI?", "Do you currently possess an active TS/SCI with FSP or CI? Certify this is true", "Gender", "Can you work on-site?"];
  for (const label of labels) for (const answer of ["Yes", "No", "Maybe"]) for (const kind of ["BOOLEAN", "SINGLE_SELECT", "TEXT"] as const) {
    const descriptor = { ...question(label, true, kind === "SINGLE_SELECT" ? ["Yes", "No"] : []), kind };
    const result = await db.query<{ value: unknown }>("select private.autopilot_exact_standing_value($1::jsonb,$2,$3) as value", [JSON.stringify(descriptor), EXACT_CLEARANCE_TOPIC, answer]);
    assert.deepEqual(result.rows[0].value, exactStandingAnswerValue(descriptor, { topic: EXACT_CLEARANCE_TOPIC, answer }), `${label} / ${kind} / ${answer}`);
  }
});

function question(label: string, required = true, options: readonly string[] = []): AgentQuestionDescriptor {
  return {
    fieldId: "synthetic-field", fingerprint: "a".repeat(64), label, required,
    kind: options.length ? "SINGLE_SELECT" : "TEXT", reasonCode: "MISSING_EXACT_ANSWER",
    options: options.map((item, index) => ({ value: String(index), label: item })),
  };
}

test("database and worker agree on every standing-answer eligibility category", async () => {
  const descriptors = [
    ...[
      "Gender", "Sex", "Sexual orientation", "Race", "Racial identity", "Ethnicity", "Hispanic", "Latinx",
      "Protected veteran status", "Disability", "Pronouns", "Transgender", "Religion", "Marital status",
      "Pregnancy", "US citizenship", "Nationality", "Passport", "Social security", "SSN", "Criminal history",
      "Convictions", "Felony", "Misdemeanors", "Arrests", "Background check", "Drug screening", "Medical history",
      "Health", "Signature", "Sign here", "Consent", "Agreement", "Acknowledgment", "Certify", "Attestation",
      "Terms", "Privacy", "EEO", "I AGREE TO THE PRIVACY POLICY", "Candidate's gender?",
      "Do you accept binding arbitration?", "Please confirm that all information provided is true",
      "Are you bound by a non-compete?", "Do you identify as a person of color?",
      "Do you identify as a person of colour?", "Please declare that the statements you provided are accurate",
      "Please confirm that all information\nprovided is true", "Confirm your start date",
      "Confirm information true", "Confirm preinformation is true", "Confirm information is untrue",
      "ſex", "Genderſ", "GenderK", "Kgender",
      "Do you currently possess an active TS/SCI with FSP or CI?", "Do you have security clearance?",
      "Current TS SCI status", "Top-secret eligibility", "Have you completed a polygraph?", "Active FSP?",
      "Experience with CI pipelines", "Designing security software", "ClearanceSale software experience",
      "Tell us why you are interested. We would love to hear this in your own words, without using AI.",
      "Do not use artificial intelligence to answer this question.", "Please don't use AI for this answer.",
      "Please don’t use artificial intelligence.", "No AI in this response.", "NO ARTIFICIAL INTELLIGENCE",
      "Answer without\nusing\nAI.", "Describe your experience using AI", "No aircraft experience required",
      "Undergraduate GPA", "Work on-site five days a week?", "Will you require visa sponsorship?",
      "Are you at least 18 years of age?", "Healthcare experience", "Redesign experience", "Disagreement resolution",
    ].map(label => question(label)),
    question("Undergraduate GPA", false),
    question("Select one", true, ["Man", "Prefer not to disclose gender"]),
    question("Select one", true, ["Yes", "Decline to disclose veteran status"]),
    question("Select one", true, ["Yes", "Prefer not to answer"]),
    question("Select one", true, ["Yes", "DeclineK gender"]),
    question("Work on-site?", true, ["Yes", "No"]),
  ];
  for (const descriptor of descriptors) {
    const result = await db.query<{ eligible: boolean }>(
      "select private.autopilot_standing_answer_eligible($1::jsonb) as eligible", [JSON.stringify(descriptor)],
    );
    assert.equal(result.rows[0].eligible, standingAnswerEligible(descriptor), JSON.stringify(descriptor));
  }
});

test("database accepts only the same profile fact keys the worker exposes to the resolver", async () => {
  const factKeys = [
    "work_authorization.us.authorized", "work_authorization.us.sponsorship_required",
    "work_authorization.ca.authorized", "work_authorization.ca.sponsorship_required",
    "education.highest_degree", "application.heard_about", "preferences.willing_to_relocate",
    "availability.start_date", "compensation.expected_salary", "location.city", "location.region", "location.country_code",
    "identity.legal_name", "contact.application_email", "demographics.gender", "work_authorization.uk.authorized",
    "work_authorization.us.unknown", "nonexistent.fake", "location.city.extra", "location.city\n",
  ];
  const visibleKeys: string[] = [];
  const resolver = createStandingAnswerResolver({ client: { responses: { async create(request: {
    input: { content: { text: string }[] }[];
  }) {
    const input = JSON.parse(request.input[0].content[0].text) as { profileFacts: { fact: string }[] };
    visibleKeys.push(...input.profileFacts.map(fact => fact.fact));
    return { status: "completed", output_text: '{"answers":[]}' };
  } } } as never });
  await resolver.resolve({
    questions: [question("Undergraduate GPA")], context: { answers: [], job: null },
    facts: factKeys.map(factKey => ({ factKey, value: "Synthetic value" })),
  });
  for (const factKey of factKeys) {
    const result = await db.query<{ allowed: boolean }>(
      "select private.autopilot_standing_fact_allowed($1) as allowed", [factKey],
    );
    assert.equal(result.rows[0].allowed, visibleKeys.includes(factKey), factKey);
  }
});


test("delegated acknowledgements have identical SQL and worker scope, signature and choice mapping", async () => {
  const authorization = { topic: APPLICATION_ACKNOWLEDGEMENTS_TOPIC, answer: APPLICATION_ACKNOWLEDGEMENTS_AUTHORIZATION };
  for (const label of ["I agree to the privacy policy", "Do you consent to a background check?", "I accept binding arbitration", "I certify that all information provided is true and complete", "Signature", "Electronic signature", "Signature (type your full name)", "Gender", "I certify that I am licensed", "I acknowledge that I have a degree", "Do you have security clearance?", "I do not agree to the terms", "I certify I used no AI", "Can you work on-site?", "Terms", "Privacy", "I have read and agree to the privacy policy", "I agree that I have worked in retail", "I certify I am over 18 years old", "I accept a non-compete agreement", "I acknowledge I am bound by a non-compete"])
    for (const kind of ["BOOLEAN", "TEXT", "SINGLE_SELECT", "MULTI_SELECT"] as const)
    for (const options of [[], ["Yes", "No"], ["I agree"], ["Yes", "I agree"], ["I agree to the privacy policy"]])
    for (const required of [true, false]) {
      const descriptor = { ...question(label, required, options), kind };
      const result = await db.query<{ value: unknown }>("select private.autopilot_delegated_standing_value($1::jsonb,$2,$3,$4) as value", [JSON.stringify(descriptor), authorization.topic, authorization.answer, "Synthetic Candidate"]);
      assert.deepEqual(result.rows[0].value, delegatedAcknowledgementValue(descriptor, authorization, "Synthetic Candidate"), `${label} / ${kind} / ${options} / ${required}`);
    }
});
