import assert from "node:assert/strict";
import test from "node:test";

import {
  GreenhouseApplicationSchemaError,
  normalizeGreenhouseApplicationSchema,
} from "./greenhouse-application-schema.ts";

const fixture = {
  id: 8017323,
  questions: [
    {
      label: "First Name",
      required: true,
      fields: [{ name: "first_name", type: "input_text", values: [] }],
    },
    {
      label: "Résumé",
      description: "<p>Upload a PDF.</p>",
      required: true,
      fields: [{ name: "resume", type: "input_file", values: [] }],
    },
    {
      label: "May we contact you?",
      required: false,
      fields: [{
        name: "question_919191",
        type: "multi_value_single_select",
        values: [
          { label: "Yes", value: 1 },
          { label: "No", value: 0 },
        ],
      }],
    },
  ],
  location_questions: [{
    label: "Current location",
    required: false,
    fields: [{ name: "location", type: "input_text", values: [] }],
  }],
  compliance: [{
    label: "Veteran status",
    required: false,
    fields: [{
      name: "veteran_status",
      type: "multi_value_single_select",
      values: [{ label: "Prefer not to say", value: 3 }],
    }],
  }],
  demographic_questions: {
    header: "Diversity and inclusion",
    description: "<p>These questions are optional.</p>",
    questions: [{
      id: 4242,
      label: "Gender",
      description: "<p>Optional self-identification.</p>",
      required: false,
      type: "multi_value_single_select",
      answer_options: [
        { id: 51, label: "Prefer not to say", free_form: false },
        { id: 52, label: "Self-describe", free_form: true },
      ],
    }],
  },
  data_compliance: [{
    type: "gdpr",
    requires_consent: true,
    requires_processing_consent: true,
    requires_retention_consent: false,
    retention_period: 365,
    demographic_data_consent_applies: false,
  }],
  include_ai_disclaimer: true,
  ai_disclaimer: "<p>This employer may use AI to review applications.</p>",
  ai_opt_out_request_url: "https://example.com/ai-opt-out#request",
};

test("normalizes Greenhouse form semantics without leaking provider identifiers into the neutral schema", () => {
  const result = normalizeGreenhouseApplicationSchema(fixture);
  assert.ok(result);
  assert.equal(result.provider, "GREENHOUSE");
  assert.match(result.schemaHash, /^[0-9a-f]{64}$/u);
  assert.equal(result.normalizedSchema.questions.length, 6);
  assert.deepEqual(result.normalizedSchema.questions[0], {
    key: "core:0",
    section: "CORE",
    label: "First Name",
    descriptionText: null,
    required: true,
    fields: [{ key: "core:0:field:0", control: "SHORT_TEXT", options: [] }],
  });
  assert.equal(result.normalizedSchema.questions[1].descriptionText, "Upload a PDF.");
  assert.equal(result.normalizedSchema.questions[1].fields[0].control, "FILE");
  assert.equal(result.normalizedSchema.questions[2].fields[0].control, "SINGLE_SELECT");
  assert.equal(result.normalizedSchema.questions[4].section, "COMPLIANCE");
  assert.equal(result.normalizedSchema.questions[5].section, "DEMOGRAPHIC");
  assert.equal(result.normalizedSchema.questions[5].fields[0].options[1].allowsFreeForm, true);
  assert.deepEqual(result.normalizedSchema.compliance, [{
    key: "data-processing:0",
    kind: "DATA_PROCESSING",
    requiresConsent: true,
    requiresProcessingConsent: true,
    requiresRetentionConsent: false,
    retentionPeriodDays: 365,
    demographicDataConsentApplies: false,
  }]);
  assert.deepEqual(result.normalizedSchema.demographicNotice, {
    heading: "Diversity and inclusion",
    text: "These questions are optional.",
  });
  assert.deepEqual(result.normalizedSchema.aiUseNotice, {
    enabled: true,
    text: "This employer may use AI to review applications.",
    optOutUrl: "https://example.com/ai-opt-out",
  });

  const neutral = JSON.stringify(result.normalizedSchema);
  assert.equal(neutral.includes("question_919191"), false);
  assert.equal(neutral.includes("4242"), false);
  assert.equal(neutral.includes('"provider"'), false);

  assert.equal(result.providerBinding.questions[2].fields[0].providerName, "question_919191");
  assert.equal(result.providerBinding.questions[5].providerQuestionId, "4242");
  assert.deepEqual(result.providerBinding.questions[5].fields[0].options[1], {
    optionKey: "demographic:0:field:0:option:1",
    providerValue: "52",
  });
  assert.deepEqual(result.providerBinding.compliance, [{
    complianceKey: "data-processing:0",
    providerType: "gdpr",
  }]);
});

test("hashes the full form contract deterministically and changes on material form drift", () => {
  const first = normalizeGreenhouseApplicationSchema(fixture);
  const reordered = normalizeGreenhouseApplicationSchema({
    ai_opt_out_request_url: fixture.ai_opt_out_request_url,
    ai_disclaimer: fixture.ai_disclaimer,
    include_ai_disclaimer: fixture.include_ai_disclaimer,
    data_compliance: fixture.data_compliance,
    demographic_questions: fixture.demographic_questions,
    compliance: fixture.compliance,
    location_questions: fixture.location_questions,
    questions: fixture.questions,
    id: fixture.id,
  });
  const changed = structuredClone(fixture);
  changed.questions[0].required = false;
  const second = normalizeGreenhouseApplicationSchema(changed);

  assert.ok(first && reordered && second);
  assert.equal(first.schemaHash, reordered.schemaHash);
  assert.notEqual(first.schemaHash, second.schemaHash);
});

test("preserves unknown provider field types in the binding and fails closed on malformed schema", () => {
  const unknown = structuredClone(fixture);
  unknown.questions[0].fields[0].type = "new_provider_widget";
  const result = normalizeGreenhouseApplicationSchema(unknown);
  assert.ok(result);
  assert.equal(result.normalizedSchema.questions[0].fields[0].control, "UNKNOWN");
  assert.equal(result.providerBinding.questions[0].fields[0].providerType, "new_provider_widget");

  assert.throws(
    () => normalizeGreenhouseApplicationSchema({ ...fixture, questions: "not-an-array" }),
    GreenhouseApplicationSchemaError,
  );
  const optionWithoutProviderValue = structuredClone(fixture);
  delete (optionWithoutProviderValue.questions[2].fields[0].values[0] as { value?: number }).value;
  assert.throws(
    () => normalizeGreenhouseApplicationSchema(optionWithoutProviderValue),
    GreenhouseApplicationSchemaError,
  );
  // A non-public opt-out link is dropped, never rendered, and never fails the job.
  const unsafeOptOut = normalizeGreenhouseApplicationSchema({ ...fixture, ai_opt_out_request_url: "http://localhost/opt-out" });
  assert.equal(unsafeOptOut?.normalizedSchema.aiUseNotice?.optOutUrl ?? null, null);
});

test("flattens sectioned EEOC compliance questions and treats null sections as absent", () => {
  // Shape returned by boards-api.greenhouse.io for jobs with OFCCP/EEOC surveys (2026).
  const sectioned = {
    ...fixture,
    compliance: [
      { type: "eeoc", questions: [], description: "<p>PUBLIC BURDEN STATEMENT</p>" },
      {
        type: "eeoc",
        description: "<h3>Voluntary Self-Identification of Disability</h3>",
        questions: [{
          required: false,
          label: "DisabilityStatus",
          fields: [{
            name: "disability_status",
            type: "multi_value_single_select",
            values: [
              { label: "I do not want to answer", value: "3" },
              { label: "No, I do not have a disability and have not had one in the past", value: "2" },
              { label: "Yes, I have a disability, or have had one in the past", value: "1" },
            ],
          }],
        }],
      },
    ],
    demographic_questions: null,
    location_questions: null,
  };
  const result = normalizeGreenhouseApplicationSchema(sectioned);
  assert.ok(result);
  const compliance = result.normalizedSchema.questions.filter((question) => question.section === "COMPLIANCE");
  assert.equal(compliance.length, 1);
  assert.equal(compliance[0].label, "Disability Status");
  assert.equal(compliance[0].fields[0].control, "SINGLE_SELECT");
  assert.deepEqual(compliance[0].fields[0].options.map((option) => option.label)[0], "I do not want to answer");
  assert.equal(result.normalizedSchema.questions.some((question) => question.section === "LOCATION"), false);
  assert.equal(result.normalizedSchema.questions.some((question) => question.section === "DEMOGRAPHIC"), false);

  // The older flat shape keeps its exact labels.
  const flat = normalizeGreenhouseApplicationSchema({
    ...fixture,
    compliance: [{ label: "VeteranStatus", required: false, fields: [{ name: "veteran_status", type: "multi_value_single_select", values: [{ label: "I don't wish to answer", value: 3 }] }] }],
  });
  assert.equal(flat?.normalizedSchema.questions.find((question) => question.section === "COMPLIANCE")?.label, "VeteranStatus");
  assert.throws(
    () => normalizeGreenhouseApplicationSchema({ ...fixture, compliance: [{ type: "eeoc", questions: "bad" }] }),
    GreenhouseApplicationSchemaError,
  );
});

test("returns null when a payload contains no advertised application-schema surface", () => {
  assert.equal(normalizeGreenhouseApplicationSchema({ id: 8017323, title: "Data Scientist" }), null);
});
