import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ASHBY_QUERY_HASHES, createAshbyProtocol, parseAshbyEnvelope, ashbySubmissionAccepted, type AshbyEnvelope, type AshbyOperation } from "./ashby-delivery-protocol.ts";
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
function submission(survey = false, overrides: Record<string, unknown> = {}): AshbyEnvelope {
  return envelope(survey ? "ApiSubmitMultipleFormsAction" : "ApiSubmitSingleApplicationFormAction", {
    organizationHostedJobsPageName: board, jobPostingId: job, recaptchaToken: "fixture-passive-token",
    ...(survey ? { applicationFormRenderIdentifier: id(2), applicationFormDefinitionIdentifier: id(3), applicationFormActionIdentifier: id(4),
      surveyIdentifiers: [{ formRenderId: id(12), sourceFormDefinitionId: id(13), actionIdentifier: id(14) }] }
      : { formRenderIdentifier: id(2), formDefinitionIdentifier: id(3), actionIdentifier: id(4) }), ...overrides,
  });
}

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
