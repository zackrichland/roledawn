import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ASHBY_QUERY_HASHES, createAshbyProtocol, inspectAshbyEnvelope, inspectAshbySubmissionResponse, parseAshbyEnvelope, ashbySubmissionAccepted, type AshbyEnvelope, type AshbyOperation, type AshbySubmissionDiagnostics } from "./ashby-delivery-protocol.ts";
import type { AgentBrowserField } from "./agents-browser-tools.ts";

const queries: Record<string, string> = JSON.parse(readFileSync(new URL("./fixtures/ashby-operations.json", import.meta.url), "utf8"));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://jobs.ashbyhq.com";
const board = "fixture";
const job = id(1);
const envelope = (operation: AshbyOperation, variables: Record<string, unknown>): AshbyEnvelope => ({ operation, variables });
const postingRequest = envelope("ApiJobPosting", { organizationHostedJobsPageName: board, jobPostingId: job });
const form = (n = 2, values: Record<string, unknown> = {}) => ({
  id: id(n), sourceFormDefinitionId: id(n + 1), formControls: [{ identifier: id(n + 2), title: "Submit Application" }],
  sections: [{ isHidden: false, fieldEntries: [
    ["_systemfield_name", "String"], ["eligible", "Boolean"], ["_systemfield_location", "Location"], ["_systemfield_resume", "File"],
  ].map(([path, type]) => ({ field: { path, type, isMany: false }, isRequired: true, isHidden: false,
    fieldValue: Object.hasOwn(values, path) ? type === "File" ? values[path] : { __typename: "JSONBox", value: values[path] } : null })) }],
});
function initialized(survey = false) {
  const protocol = createAshbyProtocol(board, job);
  assert.equal(protocol.authorize(postingRequest), "READ");
  protocol.observe(postingRequest, { data: { jobPosting: { id: job, applicationForm: form(), surveyForms: survey ? [form(12)] : [], automatedProcessingLegalNotice: null } } });
  return protocol;
}
function field(path: string, type = "TEXT"): AgentBrowserField {
  return { fieldId: `fixture-${path}`, fingerprint: "a".repeat(64), domId: path, formKey: id(2), name: path,
    label: path, kind: type as AgentBrowserField["kind"], inputType: "text", autocomplete: "", placeholder: "", required: true,
    readOnly: false, candidateOnly: false, options: [], accept: "", multiple: false, hasValue: false, valid: false, optionCount: 0, searchable: false };
}
const save = (path: string, value: unknown, extra: Record<string, unknown> = {}) => envelope("ApiSetFormValue", {
  organizationHostedJobsPageName: board, formRenderIdentifier: id(2), formDefinitionIdentifier: id(3), path, value, ...extra,
});
const compositeDefinition = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  kind: "CompositeFormDefinitionId-JobPostingApplicationFormV2", formDefinitionId: id(3),
  jobPostingId: job, jobBoardSuperType: "External", ...overrides,
});
function submission(survey = false, overrides: Record<string, unknown> = {}): AshbyEnvelope {
  return envelope(survey ? "ApiSubmitMultipleFormsAction" : "ApiSubmitSingleApplicationFormAction", {
    organizationHostedJobsPageName: board, jobPostingId: job, recaptchaToken: "fixture-passive-token",
    ...(survey ? { applicationFormRenderIdentifier: id(2), applicationFormDefinitionIdentifier: id(3), applicationFormActionIdentifier: id(4),
      surveyIdentifiers: [{ formRenderId: id(12), sourceFormDefinitionId: id(13), actionIdentifier: id(14) }] }
      : { formRenderIdentifier: id(2), formDefinitionIdentifier: id(3), actionIdentifier: id(4) }), ...overrides,
  });
}

test("final requests admit only the reviewed standard and Enterprise token envelopes", () => {
  for (const survey of [false, true]) {
    const protocol = initialized(survey);
    for (const token of ["fixture-passive-token", "ENT===fixture-passive-token", "UNIVERSAL_ENT===fixture-passive-token", "a".repeat(12_000)]) {
      assert.equal(protocol.authorize(submission(survey, { recaptchaToken: token }), undefined, true), "SUBMIT");
    }
    for (const token of [null, undefined, 42, "", "ENT===", "UNIVERSAL_ENT===", "OTHER===fixture", "ENT==fixture", "ENT====fixture",
      "ENT===ENT===fixture", "fixture=", "private spaces", "fixture\n", "a".repeat(12_001), "ENT===" + "a".repeat(12_000)]) {
      assert.equal(protocol.authorize(submission(survey, { recaptchaToken: token }), undefined, true), null);
      assert.equal(protocol.authorizationFailure(), `DELIVERY_ASHBY_REQUEST_SUBMIT_${survey ? "MULTIPLE" : "SINGLE"}_RECAPTCHA_TOKEN`);
    }
  }
});

test("reviewed Ashby operation documents cannot be spoofed by name, URL, extra arguments or a different query", () => {
  for (const operation of Object.keys(ASHBY_QUERY_HASHES) as AshbyOperation[]) {
    const data = { operationName: operation, variables: {}, query: queries[operation] };
    const url = `${origin}/api/non-user-graphql?op=${operation}`;
    const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
    assert.equal(parseAshbyEnvelope(url, "POST", bytes(data), origin)?.operation, operation);
    for (const forged of [{ ...data, operationName: "ApiJobPosting" === operation ? "ApiSetFormValue" : "ApiJobPosting" },
      { ...data, query: `${data.query} query Leak { secret }` }, { ...data, credentials: "extra" }, { ...data, variables: [] }]) {
      assert.equal(parseAshbyEnvelope(url, "POST", bytes(forged), origin), null);
    }
    for (const target of [url + "&x=y", url.replace("jobs.ashbyhq.com", "jobs.ashbyhq.com.evil.test"), url + "#other"]) {
      assert.equal(parseAshbyEnvelope(target, "POST", bytes(data), origin), null);
    }
    assert.equal(parseAshbyEnvelope(url, "GET", bytes(data), origin), null);
  }
});

test("draft saves require the current approved field and exact tenant, form, path and value", () => {
  const protocol = initialized();
  assert.equal(protocol.authorize(save("_systemfield_name", "Alex Candidate")), null);
  protocol.beginField(field("_systemfield_name"), "Alex Candidate");
  for (const override of [{ organizationHostedJobsPageName: "other" }, { formRenderIdentifier: id(20) },
    { formDefinitionIdentifier: id(20) }, { path: "eligible" }, { value: "Unapproved Person" }, { extra: "data" }]) {
    assert.equal(protocol.authorize(save("_systemfield_name", "Alex Candidate", override)), null);
  }
  const request = save("_systemfield_name", "Alex Candidate");
  assert.equal(protocol.authorize(request), "FIELD");
  assert.equal(protocol.authorize(request), null, "duplicate before acknowledgement is blocked");
  protocol.observe(request, { data: { setFormValue: form(2, { _systemfield_name: "Alex Candidate" }) } });
  assert.equal(protocol.fieldAcknowledged(), true);
  protocol.endField();
  assert.equal(protocol.authorize(request), null);
  assert.equal(protocol.review()[0].fields.find(f => f.path === "_systemfield_name")?.valueHash,
    createHash("sha256").update(JSON.stringify("Alex Candidate")).digest("hex"));
});

test("composite application definition IDs bind the exact named job, autosave echo and final review", () => {
  const protocol = createAshbyProtocol(board, job);
  const definition = compositeDefinition();
  protocol.observe(postingRequest, { data: { jobPosting: { id: job,
    applicationForm: { ...form(), sourceFormDefinitionId: definition }, surveyForms: [form(12)] } } });
  protocol.beginField(field("_systemfield_name"), "Alex Candidate");
  const request = save("_systemfield_name", "Alex Candidate", { formDefinitionIdentifier: definition });
  assert.equal(protocol.authorize(save("_systemfield_name", "Alex Candidate")), null);
  assert.equal(protocol.authorize(request), "FIELD");
  protocol.observe(request, { data: { setFormValue: { ...form(2, { _systemfield_name: "Alex Candidate" }), sourceFormDefinitionId: definition } } });
  assert.equal(protocol.fieldAcknowledged(), true);
  protocol.endField();
  assert.equal(protocol.review()[0].definitionId, definition);
  assert.equal(protocol.authorize(submission(true, { applicationFormDefinitionIdentifier: definition }), undefined, true), "SUBMIT");
  assert.equal(protocol.authorize(submission(true, { applicationFormDefinitionIdentifier: compositeDefinition({ formDefinitionId: id(90) }) }), undefined, true), null);
});

test("unreviewed composite schemas, other jobs, survey composites and changed server echoes stop before submit", () => {
  const invalid = [compositeDefinition({ jobPostingId: id(90) }), compositeDefinition({ kind: "Other" }),
    compositeDefinition({ formDefinitionId: "invalid" }), compositeDefinition({ jobBoardSuperType: "Internal" }),
    compositeDefinition({ extra: true }), "{}", "[1]", "null", "malformed", " ".repeat(513)];
  for (const definition of invalid) {
    const protocol = createAshbyProtocol(board, job);
    assert.throws(() => protocol.observe(postingRequest, { data: { jobPosting: { id: job,
      applicationForm: { ...form(), sourceFormDefinitionId: definition }, surveyForms: [] } } }), /FORM_DEFINITION_ID_DRIFT/u);
    assert.equal(protocol.ready(), false);
  }
  const survey = createAshbyProtocol(board, job);
  assert.throws(() => survey.observe(postingRequest, { data: { jobPosting: { id: job,
    applicationForm: form(), surveyForms: [{ ...form(12), sourceFormDefinitionId: compositeDefinition() }] } } }), /FORM_DEFINITION_ID_DRIFT/u);
  const protocol = createAshbyProtocol(board, job);
  protocol.observe(postingRequest, { data: { jobPosting: { id: job,
    applicationForm: { ...form(), sourceFormDefinitionId: compositeDefinition() }, surveyForms: [] } } });
  protocol.beginField(field("_systemfield_name"), "Alex Candidate");
  const request = save("_systemfield_name", "Alex Candidate", { formDefinitionIdentifier: compositeDefinition() });
  protocol.authorize(request);
  assert.throws(() => protocol.observe(request, { data: { setFormValue: {
    ...form(2, { _systemfield_name: "Alex Candidate" }), sourceFormDefinitionId: compositeDefinition({ formDefinitionId: id(90) }),
  } } }), /FORM_DEFINITION_ID_DRIFT/u);
  assert.equal(protocol.ready(), false);
});

test("a server echo that changes another answer or the form schema permanently stops this run", () => {
  for (const mutate of [
    () => form(2, { _systemfield_name: "Alex Candidate", eligible: true }),
    () => ({ ...form(2, { _systemfield_name: "Alex Candidate" }), sourceFormDefinitionId: id(50) }),
  ]) {
    const protocol = initialized(); protocol.beginField(field("_systemfield_name"), "Alex Candidate");
    const request = save("_systemfield_name", "Alex Candidate"); protocol.authorize(request);
    assert.throws(() => protocol.observe(request, { data: { setFormValue: mutate() } }), /DRIFT/u);
    assert.equal(protocol.ready(), false); assert.equal(protocol.authorize(submission(), undefined, true), null);
  }
});

test("Ashby explicit No remains false and cannot become an unanswered or affirmative field", () => {
  const protocol = initialized(); protocol.beginField(field("eligible", "SINGLE_SELECT"), "No");
  assert.equal(protocol.authorize(save("eligible", true)), null);
  assert.equal(protocol.authorize(save("eligible", null)), null);
  const request = save("eligible", false); assert.equal(protocol.authorize(request), "FIELD");
  protocol.observe(request, { data: { setFormValue: form(2, { eligible: false }) } });
  assert.equal(protocol.fieldAcknowledged(), true);
});

test("city autosave must be the one result confirmed by the approved city, region and country", () => {
  const protocol = initialized();
  const search = envelope("ApiAutocompleteGeoLocation", { text: "Springfield", locationTypes: ["City"] });
  assert.equal(protocol.authorize(search, "Springfield"), null);
  protocol.beginField(field("_systemfield_location", "SINGLE_SELECT"), "Springfield", { semantic: "CITY", source: "FACT", hints: { region: "IL", country: "US" } });
  assert.equal(protocol.authorize(search), null);
  assert.equal(protocol.authorize({ ...search, variables: { ...search.variables, text: "Private unrelated data" } }, "Springfield"), null);
  assert.equal(protocol.authorize(search, "Springfield"), "SEARCH");
  protocol.observe(search, { data: { result: { suggestions: [
    { name: "Springfield, Missouri, United States", geoLocationPath: [{ type: "City", providerLocationId: "city-mo" }] },
    { name: "Springfield, Illinois, United States", geoLocationPath: [{ type: "City", providerLocationId: "city-il" }] },
  ] } } });
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Missouri, United States", providerLocationId: "city-mo" })), null);
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Illinois, United States", providerLocationId: "forged" })), null);
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Illinois, United States", providerLocationId: "city-il" })), "FIELD");
});

test("mixed location widgets bind their reviewed lookup types and still accept only an approved city result", () => {
  const mixedForm = form();
  const location = mixedForm.sections[0].fieldEntries.find(entry => entry.field.path === "_systemfield_location")!;
  Object.assign(location.field, { locationTypes: ["Country", "Region", "City"] });
  const protocol = createAshbyProtocol(board, job);
  const empty = envelope("ApiAutocompleteGeoLocation", { text: "", locationTypes: ["Country", "Region", "City"] });
  assert.equal(protocol.authorize(empty), "READ", "mount can precede the posting response");
  protocol.observe(postingRequest, { data: { jobPosting: { id: job, applicationForm: mixedForm, surveyForms: [] } } });
  protocol.beginField(field("_systemfield_location", "SINGLE_SELECT"), "Springfield", { semantic: "CITY", source: "FACT", hints: { region: "IL", country: "US" } });
  const search = envelope("ApiAutocompleteGeoLocation", { text: "Springfield", locationTypes: ["Country", "Region", "City"] });
  assert.equal(protocol.authorize(search, "Springfield"), "SEARCH");
  assert.equal(protocol.authorize({ ...search, variables: { ...search.variables, locationTypes: ["City"] } }, "Springfield"), null);
  protocol.observe(search, { data: { result: { suggestions: [
    { name: "Springfield", geoLocationPath: [{ type: "Region", providerLocationId: "region-il" }] },
    { name: "Springfield, Illinois, United States", geoLocationPath: [{ type: "City", providerLocationId: "city-il" }] },
  ] } } });
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield", providerLocationId: "region-il" })), null);
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Illinois, United States", providerLocationId: "city-il" })), "FIELD");
  const changed = structuredClone(mixedForm);
  Object.assign(changed.sections[0].fieldEntries.find(entry => entry.field.path === "_systemfield_location")!.field, { locationTypes: ["City"] });
  assert.throws(() => protocol.observe(save("_systemfield_location", {}),
    { data: { setFormValue: changed } }), /LOCATION_TYPES_DRIFT/u);
  for (const types of [["Country"], ["Region", "City"], ["Country", "Region", "City", "Other"], ["City", "Country", "City"]]) {
    assert.equal(createAshbyProtocol(board, job).authorize(envelope("ApiAutocompleteGeoLocation", { text: "", locationTypes: types })), null);
  }
});

test("mixed location type order varies by employer while search remains bound to the exact returned array", () => {
  for (const types of [["Region", "City", "Country"], ["City", "Country", "Region"], ["Country", "City", "Region"]]) {
    const mixedForm = form();
    Object.assign(mixedForm.sections[0].fieldEntries.find(entry => entry.field.path === "_systemfield_location")!.field, { locationTypes: types });
    const protocol = createAshbyProtocol(board, job);
    assert.equal(protocol.authorize(envelope("ApiAutocompleteGeoLocation", { text: "", locationTypes: types })), "READ");
    protocol.observe(postingRequest, { data: { jobPosting: { id: job, applicationForm: mixedForm, surveyForms: [] } } });
    protocol.beginField(field("_systemfield_location", "SINGLE_SELECT"), "Springfield", { semantic: "CITY", source: "FACT", hints: { region: "IL", country: "US" } });
    const search = envelope("ApiAutocompleteGeoLocation", { text: "Springfield", locationTypes: types });
    assert.equal(protocol.authorize(search, "Springfield"), "SEARCH");
    assert.equal(protocol.authorize({ ...search, variables: { ...search.variables, locationTypes: [...types].reverse() } }, "Springfield"), null);
    assert.equal(protocol.authorize({ ...search, variables: { ...search.variables, text: "Unapproved city" } }, "Springfield"), null);
  }
});

test("a file handle cannot attach before byte acknowledgement or to another form field", () => {
  const protocol = initialized();
  const bytes = Buffer.from("%PDF-1.7 synthetic approved resume");
  const artifact = { artifactVersionId: id(50), variant: "RESUME_PDF" as const, filename: "resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  protocol.beginUpload(field("_systemfield_resume", "FILE"), artifact);
  const handle = envelope("ApiCreateFileUploadHandle", { organizationHostedJobsPageName: board, fileUploadContext: "NonUserFormEngine", filename: artifact.filename, contentType: artifact.mediaType, contentLength: artifact.byteSize });
  assert.equal(protocol.authorize({ ...handle, variables: { ...handle.variables, filename: "other.pdf" } }), null);
  assert.equal(protocol.authorize(handle), "HANDLE"); assert.equal(protocol.authorize(handle), null);
  protocol.observe(handle, { data: { fileUploadHandle: { handle: "fixture-handle", url: "https://fixture-uploads.s3.us-east-1.amazonaws.com/", fields: { key: "fixture/document", policy: "fixture-policy" } } } });
  const attach = envelope("ApiSetFormValueToFile", { organizationHostedJobsPageName: board, formRenderIdentifier: id(2), formDefinitionIdentifier: id(3), path: "_systemfield_resume", fileHandle: "fixture-handle" });
  assert.equal(protocol.authorize(attach), null);
  protocol.acknowledgeBytes();
  assert.equal(protocol.authorize({ ...attach, variables: { ...attach.variables, path: "_systemfield_name" } }), null);
  assert.equal(protocol.authorize(attach), "ATTACH"); assert.equal(protocol.authorize(attach), null);
  protocol.observe(attach, { data: { setFormValueToFile: form(2, { _systemfield_resume: { __typename: "File", id: id(55), filename: "resume.pdf" } }) } });
  assert.equal(protocol.upload()?.acknowledged, true);
});

test("single and survey submissions require the exact server form actions plus external sealed permission", () => {
  for (const survey of [false, true]) {
    const protocol = initialized(survey);
    assert.equal(protocol.authorize(submission(survey)), null);
    assert.equal(protocol.authorize(submission(survey), undefined, true), "SUBMIT");
    for (const overrides of [{ jobPostingId: id(90) }, { organizationHostedJobsPageName: "other" },
      { applicationRequestId: id(90) }, { viewedAutomatedProcessingLegalNoticeRuleId: id(90) }, { extra: "value" },
      survey ? { surveyIdentifiers: [] } : { actionIdentifier: id(90) }]) {
      assert.equal(protocol.authorize(submission(survey, overrides), undefined, true), null);
    }
    assert.equal(protocol.authorize(submission(!survey), undefined, true), null);
  }
});

test("only an employer application FormSubmitSuccess, without errors or a block, can establish acceptance", () => {
  const success = { applicationFormResult: { __typename: "FormSubmitSuccess" }, surveyFormResults: [{ __typename: "FormSubmitSuccess" }], messages: { blockMessageForCandidateHtml: null } };
  for (const operation of ["ApiSubmitSingleApplicationFormAction", "ApiSubmitMultipleFormsAction"] as const) {
    const key = operation === "ApiSubmitMultipleFormsAction" ? "submitMultipleFormsAction" : "submitApplicationFormAction";
    assert.equal(ashbySubmissionAccepted(operation, { data: { [key]: success } }, operation === "ApiSubmitMultipleFormsAction" ? 1 : 0), true);
    for (const body of [{ data: { [key]: { ...success, applicationFormResult: { __typename: "FormRender" } } } },
      { data: { [key]: { ...success, messages: { blockMessageForCandidateHtml: "Stopped" } } } },
      { data: { [key]: success }, errors: [{ message: "unknown" }] }, { success: true }, { data: {} }]) {
      assert.equal(ashbySubmissionAccepted(operation, body, operation === "ApiSubmitMultipleFormsAction" ? 1 : 0), false);
    }
  }
  assert.equal(ashbySubmissionAccepted("ApiSubmitMultipleFormsAction", { data: { submitMultipleFormsAction: { ...success, surveyFormResults: [] } } }, 1), false);
  assert.equal(ashbySubmissionAccepted("ApiSubmitMultipleFormsAction", { data: { submitMultipleFormsAction: success } }, 2), false);
});

test("submission diagnostics distinguish bounded structural causes without changing acceptance", () => {
  const success = { applicationFormResult: { __typename: "FormSubmitSuccess" }, surveyFormResults: [{ __typename: "FormSubmitSuccess" }] };
  const body = (response: unknown) => ({ data: { submitMultipleFormsAction: response } });
  const cases: [unknown, AshbySubmissionDiagnostics["classification"], number?][] = [
    [null, "ENVELOPE_INVALID"], [{}, "ENVELOPE_INVALID"], [{ data: {} }, "ENVELOPE_INVALID"],
    [{ errors: [{ message: "private error" }], data: null }, "GRAPHQL_ERRORS"],
    [{ ...body(success), errors: [] }, "GRAPHQL_ERRORS"],
    [body({ ...success, applicationFormResult: { __typename: "FormRender", fields: "private form data" } }), "MAIN_FORM_RENDER"],
    [body({ ...success, applicationFormResult: { __typename: "private foreign type" } }), "MAIN_RESULT_INVALID"],
    [body({ ...success, messages: { blockMessageForCandidateHtml: "private message" } }), "BLOCK_MESSAGE"],
    [body({ ...success, surveyFormResults: null }), "SURVEY_RESULTS_INVALID"],
    [body({ ...success, surveyFormResults: [] }), "SURVEY_COUNT_MISMATCH"],
    [body(success), "SURVEY_COUNT_MISMATCH", 0], [body(success), "SURVEY_COUNT_MISMATCH", 2],
    [body({ ...success, surveyFormResults: [{ __typename: "FormRender", fields: "private survey data" }] }), "SURVEY_RESULT_FAILURE"],
    [body({ ...success, surveyFormResults: [{ __typename: "private foreign type" }] }), "SURVEY_RESULT_FAILURE"],
    [body(success), "ACCEPTED"],
  ];
  for (const [payload, classification, expectedCount = 1] of cases) {
    const diagnostics = inspectAshbySubmissionResponse("ApiSubmitMultipleFormsAction", Buffer.from(JSON.stringify(payload)), expectedCount);
    assert.equal(diagnostics.classification, classification);
    assert.equal(diagnostics.classification === "ACCEPTED", ashbySubmissionAccepted("ApiSubmitMultipleFormsAction", payload, expectedCount));
    assert.equal(JSON.stringify(diagnostics).includes("private"), false);
  }
  assert.equal(inspectAshbySubmissionResponse("ApiSubmitMultipleFormsAction", null, 1).classification, "BODY_UNAVAILABLE");
  assert.equal(inspectAshbySubmissionResponse("ApiSubmitMultipleFormsAction", Buffer.from("not JSON: private"), 1).classification, "JSON_INVALID");
  assert.equal(inspectAshbySubmissionResponse("ApiSubmitMultipleFormsAction", Buffer.alloc(2_000_001), 1).classification, "BODY_TOO_LARGE");
  const single = { data: { submitApplicationFormAction: success } };
  assert.equal(inspectAshbySubmissionResponse("ApiSubmitSingleApplicationFormAction", Buffer.from(JSON.stringify(single))).classification, "ACCEPTED");
  assert.equal(ashbySubmissionAccepted("ApiSubmitSingleApplicationFormAction", single), true);
});

test("submission diagnostics emit only fixed categories and capped counts, never private nested strings", () => {
  const secret = "synthetic-private-answer-token@example.invalid";
  const payload = { data: { submitMultipleFormsAction: {
    applicationFormResult: { __typename: secret, errorMessages: [secret], formErrors: [{ message: secret, fieldEntryId: secret }], sections: [secret] },
    surveyFormResults: [{ __typename: "FormSubmitSuccess", value: secret }, { __typename: "FormRender", sections: [secret] }, ...Array(1_001).fill({ __typename: secret })],
    messages: { blockMessageForCandidateHtml: secret, __typename: secret }, __typename: secret,
  } }, errors: Array(1_001).fill({ message: secret, path: [secret], extensions: { code: secret } }), extensions: { secret } };
  const diagnostics = inspectAshbySubmissionResponse("ApiSubmitMultipleFormsAction", Buffer.from(JSON.stringify(payload)), 100_000);
  assert.deepEqual(diagnostics, { classification: "GRAPHQL_ERRORS", mainResult: "OTHER", surveyResults: "ARRAY", expectedSurveyCount: 1_000,
    surveyResultCount: 1_000, surveySuccessCount: 1, surveyFormRenderCount: 1, surveyOtherCount: 1_000,
    graphqlErrors: "ARRAY", graphqlErrorCount: 1_000, verificationRejection: "ABSENT", blockMessage: "PRESENT" });
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  assert.equal(ashbySubmissionAccepted("ApiSubmitMultipleFormsAction", payload, 100_000), false);
});

test("submission diagnostics preserve the exact reviewed low-score category without response text", () => {
  for (const [type, expected] of [["RECAPTCHA_SCORE_BELOW_THRESHOLD", "SCORE_BELOW_THRESHOLD"],
    ["recaptcha_score_below_threshold", "ABSENT"], ["private-error@example.invalid", "ABSENT"]] as const) {
    const payload = { errors: [{ message: "private candidate response", extensions: { ashbyErrorType: type,
      ashbyErrorId: "private-vendor-id", message: "private vendor response" } }], data: null };
    const diagnostic = inspectAshbySubmissionResponse("ApiSubmitSingleApplicationFormAction", Buffer.from(JSON.stringify(payload)));
    assert.equal(diagnostic.classification, "GRAPHQL_ERRORS");
    assert.equal(diagnostic.verificationRejection, expected);
    assert.equal(JSON.stringify(diagnostic).includes("private"), false);
    assert.equal(ashbySubmissionAccepted("ApiSubmitSingleApplicationFormAction", payload), false);
  }
});

test("protocol drift reports a static stage without exposing an answer", () => {
  for (const [response, reason] of [
    [{ ...form(2, { _systemfield_name: "Alex Candidate" }), sourceFormDefinitionId: null }, "DELIVERY_ASHBY_FORM_DEFINITION_ID_DRIFT"],
    [{ ...form(2, { _systemfield_name: "Alex Candidate" }), id: id(99) }, "DELIVERY_ASHBY_FORM_RENDER_ID_DRIFT"],
    [form(2, { _systemfield_name: "Private unexpected response" }), "DELIVERY_ASHBY_FIELD_VALUE_ECHO_DRIFT"],
    [form(2, { _systemfield_name: "Alex Candidate", eligible: true }), "DELIVERY_ASHBY_OTHER_FIELD_VALUE_DRIFT"],
  ] as const) {
    const protocol = initialized(); protocol.beginField(field("_systemfield_name"), "Alex Candidate");
    const request = save("_systemfield_name", "Alex Candidate"); protocol.authorize(request);
    assert.throws(() => protocol.observe(request, { data: { setFormValue: response } }), { message: reason });
    assert.equal(protocol.ready(), false);
  }
});

test("autosave schema diagnostics distinguish each field property without accepting drift", () => {
  const cases: readonly [string, (value: ReturnType<typeof form>) => unknown][] = [
    ["FORM_SCHEMA_SET_DRIFT", value => { value.sections[0].fieldEntries.pop(); return value; }],
    ["FORM_SCHEMA_ORDER_DRIFT", value => { value.sections[0].fieldEntries.reverse(); return value; }],
    ["FORM_SCHEMA_TYPE_DRIFT", value => { value.sections[0].fieldEntries[0].field.type = "Email"; return value; }],
    ["FORM_SCHEMA_MULTI_DRIFT", value => { value.sections[0].fieldEntries[0].field.isMany = true; return value; }],
    ["FORM_SCHEMA_OPTIONS_DRIFT", value => { Object.assign(value.sections[0].fieldEntries[0].field, { selectableValues: [{ label: "Synthetic", value: "synthetic" }] }); return value; }],
    ["FORM_SCHEMA_REQUIRED_DRIFT", value => { value.sections[0].fieldEntries[0].isRequired = false; return value; }],
    ["FORM_SCHEMA_HIDDEN_DRIFT", value => { value.sections[0].fieldEntries[0].isHidden = true; return value; }],
  ];
  for (const [reason, mutate] of cases) {
    const protocol = initialized();
    protocol.beginField(field("_systemfield_name"), "Alex Candidate");
    const request = save("_systemfield_name", "Alex Candidate");
    protocol.authorize(request);
    assert.throws(() => protocol.observe(request, { data: { setFormValue: mutate(form(2, { _systemfield_name: "Alex Candidate" })) } }),
      { message: "DELIVERY_ASHBY_" + reason });
    assert.equal(protocol.ready(), false);
    assert.equal(protocol.authorize(submission(), undefined, true), null);
  }
});

test("a fully validated autosave rotates the reviewed action and rejects a stale final action", () => {
  for (const survey of [false, true]) {
    const protocol = initialized(survey);
    protocol.beginField(field("_systemfield_name"), "Alex Candidate");
    const request = save("_systemfield_name", "Alex Candidate");
    assert.equal(protocol.authorize(request), "FIELD");
    const response = form(2, { _systemfield_name: "Alex Candidate" });
    response.formControls[0].identifier = id(99);
    protocol.observe(request, { data: { setFormValue: response } });
    assert.equal(protocol.fieldAcknowledged(), true);
    protocol.endField();
    assert.equal(protocol.review()[0].actionId, id(99));
    const updated = submission(survey, survey ? { applicationFormActionIdentifier: id(99) } : { actionIdentifier: id(99) });
    assert.equal(protocol.authorize(updated), null, "rotation does not grant submission authority");
    assert.equal(protocol.authorize(submission(survey), undefined, true), null, "the old action stays blocked");
    assert.equal(protocol.authorize(updated, undefined, true), "SUBMIT");
  }
});

test("action rotation cannot hide changed metadata, an unapproved echo or a changed other answer", () => {
  const cases: readonly [string, (value: ReturnType<typeof form>) => void][] = [
    ["FORM_SCHEMA_ACTION_REQUIRED_DRIFT", value => { value.sections[0].fieldEntries[0].isRequired = false; }],
    ["FIELD_VALUE_ECHO_DRIFT", value => { value.sections[0].fieldEntries[0].fieldValue = { __typename: "JSONBox", value: "Unapproved Person" }; }],
    ["OTHER_FIELD_VALUE_DRIFT", value => { value.sections[0].fieldEntries[1].fieldValue = { __typename: "JSONBox", value: true }; }],
  ];
  for (const [reason, mutate] of cases) {
    const protocol = initialized();
    protocol.beginField(field("_systemfield_name"), "Alex Candidate");
    const request = save("_systemfield_name", "Alex Candidate"); protocol.authorize(request);
    const response = form(2, { _systemfield_name: "Alex Candidate" });
    response.formControls[0].identifier = id(99);
    mutate(response);
    assert.throws(() => protocol.observe(request, { data: { setFormValue: response } }), { message: "DELIVERY_ASHBY_" + reason });
    assert.equal(protocol.fieldAcknowledged(), false);
    protocol.endField();
    assert.equal(protocol.ready(), false);
    assert.equal(protocol.authorize(submission(false, { actionIdentifier: id(99) }), undefined, true), null);
    assert.throws(() => protocol.review(), /FORM_NOT_READY/u);
  }
});

test("one bounded static diagnostic reports simultaneous schema changes", () => {
  const protocol = initialized();
  protocol.beginField(field("_systemfield_name"), "Alex Candidate");
  const request = save("_systemfield_name", "Alex Candidate"); protocol.authorize(request);
  const response = form(2, { _systemfield_name: "Alex Candidate" });
  response.formControls[0].identifier = id(99);
  response.sections[0].fieldEntries[0].isRequired = false;
  response.sections[0].fieldEntries[0].isHidden = true;
  response.sections[0].fieldEntries.reverse();
  assert.throws(() => protocol.observe(request, { data: { setFormValue: response } }),
    { message: "DELIVERY_ASHBY_FORM_SCHEMA_ACTION_ORDER_REQUIRED_HIDDEN_DRIFT" });
  assert.equal(protocol.ready(), false);
});

test("envelope diagnostics distinguish format, reviewed operation and query failures without payload text", () => {
  const operation = "ApiCreateFileUploadHandle";
  const url = origin + "/api/non-user-graphql?op=" + operation;
  const valid = { operationName: operation, variables: {}, query: queries[operation] };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const cases: [string, string, Buffer | null, string][] = [
    ["invalid-url", "POST", bytes(valid), "ENVELOPE_URL_INVALID"],
    [url, "GET", bytes(valid), "ENVELOPE_METHOD"],
    [url + "&unreviewed=private", "POST", bytes(valid), "ENVELOPE_QUERY_PARAMETERS"],
    [origin + "/api/non-user-graphql?op=PrivateUnreviewedOperation", "POST", bytes(valid), "ENVELOPE_OPERATION_UNKNOWN"],
    [url, "POST", null, "HANDLE_ENVELOPE_BODY_SIZE"],
    [url, "POST", Buffer.from("private invalid JSON"), "HANDLE_ENVELOPE_JSON_INVALID"],
    [url, "POST", bytes({ ...valid, extra: "private value" }), "HANDLE_ENVELOPE_KEYS"],
    [url, "POST", bytes({ ...valid, operationName: "private value" }), "HANDLE_ENVELOPE_OPERATION_MISMATCH"],
    [url, "POST", bytes({ ...valid, variables: "private value" }), "HANDLE_ENVELOPE_VARIABLES_TYPE"],
    [url, "POST", bytes({ ...valid, query: "private query text" }), "HANDLE_ENVELOPE_QUERY_DOCUMENT"],
  ];
  for (const [target, method, body, reason] of cases) {
    const result = inspectAshbyEnvelope(target, method, body, origin);
    assert.equal(result.envelope, null);
    assert.equal(result.rejection, "DELIVERY_ASHBY_REQUEST_" + reason);
    assert.match(result.rejection!, /^[A-Z_]{1,119}$/u);
    assert.doesNotMatch(result.rejection!, /private/iu);
  }
});

test("request diagnostics cover read, search, field, upload and final authority independently", () => {
  const protocol = initialized();
  const denied = (request: AshbyEnvelope, reason: string, search?: string, submitting = false) => {
    assert.equal(protocol.authorize(request, search, submitting), null);
    assert.equal(protocol.authorizationFailure(), "DELIVERY_ASHBY_REQUEST_" + reason);
  };
  denied(postingRequest, "POSTING_ALREADY_LOADED");
  denied(envelope("ApiOrganizationFromHostedJobsPageName", { organizationHostedJobsPageName: board, searchContext: "private" }), "ORGANIZATION_CONTEXT");
  denied(envelope("ApiAutocompleteGeoLocation", { text: "private", locationTypes: ["City"] }), "SEARCH_NO_FIELD_ACTION");
  denied(save("_systemfield_name", "Alex Candidate"), "FIELD_NO_ACTION");
  protocol.beginField(field("_systemfield_name"), "Alex Candidate");
  for (const [overrides, reason] of [
    [{ extra: "private" }, "VARIABLE_KEYS"], [{ organizationHostedJobsPageName: "private" }, "BOARD"],
    [{ formRenderIdentifier: id(90) }, "FORM"], [{ formDefinitionIdentifier: id(90) }, "DEFINITION"],
    [{ path: "private" }, "PATH"], [{ value: "private" }, "VALUE"],
  ] as const) denied(save("_systemfield_name", "Alex Candidate", overrides), "FIELD_" + reason);
  const request = save("_systemfield_name", "Alex Candidate");
  assert.equal(protocol.authorize(request), "FIELD");
  assert.equal(protocol.authorizationFailure(), null);
  denied(request, "FIELD_DUPLICATE_PENDING");
  protocol.observe(request, { data: { setFormValue: form(2, { _systemfield_name: "Alex Candidate" }) } });
  denied(request, "FIELD_DUPLICATE_ACKNOWLEDGED");
  protocol.endField();
  const bytes = Buffer.from("synthetic-file");
  const artifact = { artifactVersionId: id(50), variant: "RESUME_PDF" as const, filename: "resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  const handle = envelope("ApiCreateFileUploadHandle", { organizationHostedJobsPageName: board, fileUploadContext: "NonUserFormEngine", filename: artifact.filename, contentType: artifact.mediaType, contentLength: artifact.byteSize });
  denied(handle, "HANDLE_NO_ACTION");
  protocol.beginUpload(field("_systemfield_resume", "FILE"), artifact);
  for (const [override, reason] of [
    [{ extra: "private" }, "VARIABLE_KEYS"], [{ organizationHostedJobsPageName: "private" }, "BOARD"],
    [{ fileUploadContext: "private" }, "CONTEXT"], [{ filename: "private" }, "FILENAME"],
    [{ contentType: "private" }, "MEDIA_TYPE"], [{ contentLength: 0 }, "BYTE_LENGTH"],
  ] as const) denied({ ...handle, variables: { ...handle.variables, ...override } }, "HANDLE_" + reason);
  const attach = envelope("ApiSetFormValueToFile", { organizationHostedJobsPageName: board, formRenderIdentifier: id(2), formDefinitionIdentifier: id(3), path: "_systemfield_resume", fileHandle: "synthetic-handle" });
  denied(attach, "ATTACH_BYTES_NOT_ACKNOWLEDGED");
  assert.equal(protocol.authorize(handle), "HANDLE");
  denied(handle, "HANDLE_DUPLICATE");
  protocol.observe(handle, { data: { fileUploadHandle: { handle: "synthetic-handle", url: "https://fixture.s3.amazonaws.com/", fields: { key: "synthetic-file" } } } });
  protocol.acknowledgeBytes();
  denied({ ...attach, variables: { ...attach.variables, fileHandle: "private" } }, "ATTACH_HANDLE");
  denied({ ...attach, variables: { ...attach.variables, path: "private" } }, "ATTACH_PATH");
  assert.equal(protocol.authorize(attach), "ATTACH");
  denied(attach, "ATTACH_DUPLICATE_PENDING");
  protocol.endUpload();
  denied(attach, "ATTACH_NO_ACTION");
  denied(submission(), "SUBMIT_SINGLE_NO_SUBMIT_ACTION");
  for (const [override, reason] of [
    [{ extra: "private" }, "VARIABLE_KEYS"], [{ organizationHostedJobsPageName: "private" }, "BOARD"],
    [{ jobPostingId: id(90) }, "JOB"], [{ formRenderIdentifier: id(90) }, "FORM"],
    [{ formDefinitionIdentifier: id(90) }, "DEFINITION"], [{ actionIdentifier: id(90) }, "ACTION"],
    [{ sourceAttributionCode: "private" }, "SOURCE_ATTRIBUTION"], [{ viewedAutomatedProcessingLegalNoticeRuleId: "private" }, "LEGAL_NOTICE"],
    [{ applicationRequestId: "private" }, "APPLICATION_REQUEST"], [{ recaptchaToken: "private spaces" }, "RECAPTCHA_TOKEN"],
    [{ deviceFingerprint: "private" }, "DEVICE_FINGERPRINT"],
  ] as const) denied(submission(false, override), "SUBMIT_SINGLE_" + reason, undefined, true);
  assert.equal(protocol.authorize(submission(), undefined, true), "SUBMIT");
  assert.equal(protocol.authorizationFailure(), null);
});

test("public organization refetch may omit optional context but cannot carry another value or key", () => {
  const protocol = initialized();
  for (const variables of [{ organizationHostedJobsPageName: board }, { organizationHostedJobsPageName: board, searchContext: null }, { organizationHostedJobsPageName: board, searchContext: "JobPosting" }]) {
    assert.equal(protocol.authorize(envelope("ApiOrganizationFromHostedJobsPageName", variables)), "READ");
  }
  for (const variables of [{ organizationHostedJobsPageName: "other" }, { organizationHostedJobsPageName: board, searchContext: "private" }, { organizationHostedJobsPageName: board, unreviewed: "private" }]) {
    assert.equal(protocol.authorize(envelope("ApiOrganizationFromHostedJobsPageName", variables)), null);
  }
});

test("constant empty City lookup is harmless outside a field and its response never authorizes a choice", () => {
  const protocol = initialized();
  const empty = envelope("ApiAutocompleteGeoLocation", { text: "", locationTypes: ["City"] });
  assert.equal(protocol.authorize(empty), "READ");
  for (const variables of [{ text: "private", locationTypes: ["City"] }, { text: "", locationTypes: ["Country"] }, { text: "", locationTypes: ["City"], extra: "private" }]) {
    assert.equal(protocol.authorize(envelope("ApiAutocompleteGeoLocation", variables)), null);
  }
  protocol.beginField(field("_systemfield_location", "SINGLE_SELECT"), "Springfield", { semantic: "CITY", source: "FACT", hints: { region: "IL", country: "US" } });
  assert.equal(protocol.authorize(empty), "READ");
  protocol.observe(empty, { data: { result: { suggestions: [{ name: "Springfield, Illinois, United States", geoLocationPath: [{ type: "City", providerLocationId: "unexpected-city" }] }] } } });
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Illinois, United States", providerLocationId: "unexpected-city" })), null);
  assert.equal(protocol.authorizationFailure(), "DELIVERY_ASHBY_REQUEST_FIELD_LOCATION_NO_CONFIRMED_RESULT");
  const search = envelope("ApiAutocompleteGeoLocation", { text: "Springfield", locationTypes: ["City"] });
  assert.equal(protocol.authorize(search, "Springfield"), "SEARCH");
  protocol.observe(search, { data: { result: { suggestions: [{ name: "Springfield, Illinois, United States", geoLocationPath: [{ type: "City", providerLocationId: "approved-city" }] }] } } });
  protocol.observe(empty, { data: { result: { suggestions: [{ name: "Springfield, Illinois, United States", geoLocationPath: [{ type: "City", providerLocationId: "unexpected-city" }] }] } } });
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Illinois, United States", providerLocationId: "unexpected-city" })), null);
  assert.equal(protocol.authorize(save("_systemfield_location", { text: "Springfield, Illinois, United States", providerLocationId: "approved-city" })), "FIELD");
});

test("passive AI notices bind exact rule IDs and content into the sealed review", () => {
  const protocol = createAshbyProtocol(board, job);
  protocol.observe(postingRequest, { data: { jobPosting: { id: job, applicationForm: form(), surveyForms: [],
    automatedProcessingLegalNotice: { automatedProcessingLegalNoticeRuleId: id(70), automatedProcessingLegalNoticeHtml: null } } } });
  assert.equal(protocol.authorize(submission(false, { viewedAutomatedProcessingLegalNoticeRuleId: id(70) }), undefined, true), "SUBMIT");
  assert.equal(protocol.authorize(submission(), undefined, true), null);
  assert.equal(protocol.authorize(submission(false, { viewedAutomatedProcessingLegalNoticeRuleId: id(71) }), undefined, true), null);
  assert.equal(protocol.review()[0].informationalNoticeRuleId, id(70));
  assert.match(protocol.review()[0].informationalNoticeHash ?? "", /^[a-f0-9]{64}$/u);
  const custom = createAshbyProtocol(board, job);
  custom.observe(postingRequest, { data: { jobPosting: { id: job, applicationForm: form(), surveyForms: [],
    automatedProcessingLegalNotice: { automatedProcessingLegalNoticeRuleId: id(70), automatedProcessingLegalNoticeHtml: '<p>Employer processing notice</p>' } } } });
  assert.equal(custom.authorize(submission(false, { viewedAutomatedProcessingLegalNoticeRuleId: id(70) }), undefined, true), "SUBMIT");
  assert.notEqual(custom.review()[0].informationalNoticeHash, protocol.review()[0].informationalNoticeHash);
  for (const notice of [
    { automatedProcessingLegalNoticeRuleId: id(70), automatedProcessingLegalNoticeHtml: {} },
    { automatedProcessingLegalNoticeRuleId: id(70), automatedProcessingLegalNoticeHtml: 'x'.repeat(32_001) },
    { automatedProcessingLegalNoticeRuleId: 'untrusted rule', automatedProcessingLegalNoticeHtml: null },
    { automatedProcessingLegalNoticeRuleId: id(70) },
  ]) {
    const guarded = createAshbyProtocol(board, job);
    assert.throws(() => guarded.observe(postingRequest, { data: { jobPosting: { id: job, applicationForm: form(), surveyForms: [], automatedProcessingLegalNotice: notice } } }));
    assert.equal(guarded.ready(), false);
  }
});
