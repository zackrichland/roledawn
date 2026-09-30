import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { DeliverySitePolicy } from "../server/workers/application-delivery-browser.ts";

const queries = JSON.parse(readFileSync(new URL("../server/workers/fixtures/ashby-operations.json", import.meta.url), "utf8"));
export const ASHBY_FIXTURE_JOB = "11111111-1111-4111-8111-111111111111";
const formId = "22222222-2222-4222-8222-222222222222";
const definition = "33333333-3333-4333-8333-333333333333";
const actionId = "44444444-4444-4444-8444-444444444444";
export const ASHBY_FIXTURE_FINAL_ACTION = "88888888-8888-4888-8888-888888888888";
const surveyId = "55555555-5555-4555-8555-555555555555";
const field = (path: string, type: string) => ({ id: formId + "_" + path, field: { path, type, isMany: false, selectableValues: null }, fieldValue: null as unknown, isRequired: true, isHidden: false });
export type AshbyFixtureMode = "normal" | "multiple" | "bad-submit" | "wrong-value" | "fake-receipt" | "survey-missing" | "upload-corrupt" | "rotating-action" | "stale-action" | "wrong-handle-length" | "late-field-save" | "public-refetches" | "submit-disabled" | "submit-disabled-value" | "submit-disabled-label" | "submit-disabled-removed" | "submit-disabled-foreign";
export async function startSyntheticAshby(mode: AshbyFixtureMode = "normal") {
  const application = { id: formId, sourceFormDefinitionId: definition, formControls: [{ identifier: actionId, title: "Submit" }], sections: [{ isHidden: false, fieldEntries: [field("_systemfield_name", "String"), field("_systemfield_resume", "File")] }] };
  const survey = { id: surveyId, sourceFormDefinitionId: definition, formControls: [{ identifier: actionId, title: "Submit" }], sections: [] };
  const multiple = ["multiple", "survey-missing", "rotating-action", "stale-action", "public-refetches"].includes(mode);
  const rotating = ["rotating-action", "stale-action"].includes(mode);
  const requests: { operations: string[]; mutations: unknown[]; submits: number; submittedActions: unknown[]; uploadBytes: Buffer[] } = { operations: [], mutations: [], submits: 0, submittedActions: [], uploadBytes: [] };
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      const html = readFileSync(new URL("./synthetic-ashby-delivery.html", import.meta.url), "utf8");
      res.setHeader("content-type", "text/html");
      res.end(html.replace("__FIXTURE__", JSON.stringify({ queries, formId, definition, actionId, surveyId, jobId: ASHBY_FIXTURE_JOB, mode, multiple })));
      return;
    }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { operationName: string; variables: Record<string, unknown> };
    const op = envelope.operationName, v = envelope.variables;
    requests.operations.push(op);
    res.setHeader("content-type", "application/json");
    let data: unknown;
    if (op === "ApiJobPosting") data = { jobPosting: { id: ASHBY_FIXTURE_JOB, applicationForm: application, surveyForms: multiple ? [survey] : [], automatedProcessingLegalNotice: null } };
    else if (op === "ApiOrganizationFromHostedJobsPageName") data = { organization: { name: "Synthetic Employer" } };
    else if (op === "ApiAutocompleteGeoLocation") data = { result: { suggestions: [] } };
    else if (op === "ApiSetFormValue") { requests.mutations.push(v); application.sections[0].fieldEntries[0].fieldValue = { __typename: "JSONBox", value: v.value }; if (rotating) application.formControls[0].identifier = "77777777-7777-4777-8777-777777777777"; data = { setFormValue: application }; }
    else if (op === "ApiCreateFileUploadHandle") data = { fileUploadHandle: { handle: "synthetic-handle", url: "https://fixture-bucket.s3.amazonaws.com/", fields: { key: "fixture/upload", policy: "synthetic-policy", "x-amz-signature": "synthetic-signature" } } };
    else if (op === "ApiSetFormValueToFile") { requests.mutations.push(v); application.sections[0].fieldEntries[1].fieldValue = { __typename: "File", id: "66666666-6666-4666-8666-666666666666", filename: "Fixture-Resume.pdf" }; if (rotating) application.formControls[0].identifier = ASHBY_FIXTURE_FINAL_ACTION; data = { setFormValueToFile: application }; }
    else if (op.startsWith("ApiSubmit")) { requests.submits += 1; requests.submittedActions.push(v.applicationFormActionIdentifier ?? v.actionIdentifier); data = { [multiple ? "submitMultipleFormsAction" : "submitApplicationFormAction"]: { applicationFormResult: { __typename: mode === "fake-receipt" ? "FormSubmitFailure" : "FormSubmitSuccess" }, ...(multiple ? { surveyFormResults: mode === "survey-missing" ? [] : [{ __typename: "FormSubmitSuccess" }] } : {}), messages: null } }; }
    else { res.statusCode = 400; data = null; }
    res.end(JSON.stringify({ data }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("FIXTURE_SERVER_UNAVAILABLE");
  const origin = "http://127.0.0.1:" + address.port, startUrl = origin + "/fixture/" + ASHBY_FIXTURE_JOB + "/application";
  const policy: DeliverySitePolicy = { release: "ashby-fixture/1", startUrl, ashby: { board: "fixture", jobId: ASHBY_FIXTURE_JOB }, steps: [{ id: "application", url: startUrl, readySelector: ".ashby-application-form-submit-button", submit: { selector: ".ashby-application-form-submit-button", request: { method: "POST", url: origin + "/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction" } } }], receipt: { url: startUrl, selector: ".ashby-application-form-success-container", textPattern: "Success" } };
  return { policy, requests, async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}
