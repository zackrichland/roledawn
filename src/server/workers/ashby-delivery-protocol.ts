import { createHash } from "node:crypto";
import { chooseSearchResult, resolveOptionValue, type OptionMatch } from "./agents-option-match.ts";
import type { AgentBrowserField, AgentFieldValue } from "./agents-browser-tools.ts";
import type { MaterializedApplicationArtifact } from "./application-fill-materializer.ts";

/** Reviewed public non-user client contract, 2026-09-30. Query hashes include
 * Apollo's __typename selections. Changing operationName cannot disguise a
 * different mutation; a changed vendor contract fails closed for review. */
export const ASHBY_QUERY_HASHES = Object.freeze({
  ApiJobPosting: "0258a140e1ca4a91106faf50a72e49b52e7350337e44b3ea00ad9ed017f17670",
  ApiOrganizationFromHostedJobsPageName: "a403e8364841f7a2888b51bce34e89fad5bb58c54c43bc21add03bba866e9800",
  ApiSetFormValue: "d95c134620f444098e152ff861a39d272ad2b35d3469b24bb591c3fe6932ca91",
  ApiSetFormValueToFile: "08310f2dcfe5f02571071fbd92c94dc6da5ee1e012463ab8bcda6c08480f0bf3",
  ApiCreateFileUploadHandle: "be1843e4ed45a0e49869888deb833756f5ae27d72fa72ecf7f051c59de7b69c7",
  ApiSubmitMultipleFormsAction: "1379480b7ee730be01ada027f0312c1046fa9d4e09a00b395628d3a96a9d8169",
  ApiSubmitSingleApplicationFormAction: "e2bd84c8ddb4855d38b8b51c617954fbeed175d1ad9e6518171537b016bd5dd3",
  ApiAutocompleteGeoLocation: "4721b72be45f26fd11c5b1f466200027620879bf7223b875feb7746a2cfb7741",
});
export type AshbyOperation = keyof typeof ASHBY_QUERY_HASHES;
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): string => JSON.stringify(value, (_key, val: unknown) => object(val) ? Object.fromEntries(Object.entries(val as Obj).sort(([a], [b]) => a.localeCompare(b))) : val);
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const keys = (value: Obj, required: string[], optional: string[] = []) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const fail = (reason = "CONTRACT_DRIFT"): never => { throw new Error(`DELIVERY_ASHBY_${reason}`); };
export type AshbyEnvelope = Readonly<{ operation: AshbyOperation; variables: Obj }>;
export type AshbyEnvelopeInspection = Readonly<{ envelope: AshbyEnvelope | null; rejection: string | null }>;
const OPERATION_STAGE: Record<AshbyOperation, string> = {
  ApiJobPosting: "POSTING", ApiOrganizationFromHostedJobsPageName: "ORGANIZATION",
  ApiAutocompleteGeoLocation: "SEARCH", ApiSetFormValue: "FIELD",
  ApiCreateFileUploadHandle: "HANDLE", ApiSetFormValueToFile: "ATTACH",
  ApiSubmitSingleApplicationFormAction: "SUBMIT_SINGLE", ApiSubmitMultipleFormsAction: "SUBMIT_MULTIPLE",
};
/** Diagnostics contain only internal literals, never request text or variables. */
export function inspectAshbyEnvelope(url: string, method: string, body: Buffer | null, origin: string): AshbyEnvelopeInspection {
  let stage = "ENVELOPE";
  const reject = (reason: string): AshbyEnvelopeInspection => ({ envelope: null, rejection: "DELIVERY_ASHBY_REQUEST_" + stage + "_" + reason });
  let parsed: URL;
  try { parsed = new URL(url); } catch { return reject("URL_INVALID"); }
  if (method !== "POST") return reject("METHOD");
  if (parsed.origin !== origin || parsed.pathname !== "/api/non-user-graphql" || parsed.username || parsed.password || parsed.hash) return reject("DESTINATION");
  if ([...parsed.searchParams.keys()].length !== 1) return reject("QUERY_PARAMETERS");
  const operation = parsed.searchParams.get("op") as AshbyOperation;
  if (!Object.hasOwn(ASHBY_QUERY_HASHES, operation)) return reject("OPERATION_UNKNOWN");
  stage = OPERATION_STAGE[operation] + "_ENVELOPE";
  if (!body || body.length > 100_000) return reject("BODY_SIZE");
  let data: Obj | null;
  try { data = object(JSON.parse(body.toString("utf8"))); } catch { return reject("JSON_INVALID"); }
  if (!data || !keys(data, ["operationName", "variables", "query"])) return reject("KEYS");
  if (data.operationName !== operation) return reject("OPERATION_MISMATCH");
  if (typeof data.query !== "string") return reject("QUERY_TYPE");
  if (!object(data.variables)) return reject("VARIABLES_TYPE");
  if (digest(data.query.replace(/[\s,]+/gu, "")) !== ASHBY_QUERY_HASHES[operation]) return reject("QUERY_DOCUMENT");
  return { envelope: { operation, variables: data.variables as Obj }, rejection: null };
}
export function parseAshbyEnvelope(url: string, method: string, body: Buffer | null, origin: string): AshbyEnvelope | null {
  return inspectAshbyEnvelope(url, method, body, origin).envelope;
}

const CITY_LOOKUP = ["City"];
const MIXED_LOCATION_LOOKUP = ["Country", "Region", "City"];
// Employers order the same three location types differently. Retain the exact
// server array in the field/search binding; recognize only this reviewed set.
const reviewedLocationTypes = (value: unknown) => equal(value, CITY_LOOKUP) || Array.isArray(value) &&
  value.length === MIXED_LOCATION_LOOKUP.length && new Set(value).size === value.length &&
  value.every(type => MIXED_LOCATION_LOOKUP.includes(type));
type Field = { path: string; type: string; many: boolean; options: { label: string; value: unknown }[]; value: unknown; required: boolean; hidden: boolean; locationTypes: unknown };
type Form = { id: string; definition: string; action: string; fields: Map<string, Field> };
function definitionId(value: unknown, compositeJobId?: string): value is string {
  if (uuid(value)) return true;
  // Verified public client: application forms use an opaque JSON identifier;
  // surveys still use UUIDs. Preserve the exact string for every save and seal.
  if (!compositeJobId || typeof value !== "string" || value.length > 512) return false;
  let composite: Obj | null;
  try { composite = object(JSON.parse(value)); } catch { return false; }
  return !!composite && keys(composite, ["kind", "formDefinitionId", "jobPostingId", "jobBoardSuperType"])
    && composite.kind === "CompositeFormDefinitionId-JobPostingApplicationFormV2"
    && uuid(composite.formDefinitionId) && composite.jobPostingId === compositeJobId
    && composite.jobBoardSuperType === "External";
}
function readForm(value: unknown, compositeJobId?: string): Form {
  const form = object(value);
  if (!form || !uuid(form.id)) return fail("FORM_RENDER_ID_DRIFT");
  if (!definitionId(form.sourceFormDefinitionId, compositeJobId)) return fail("FORM_DEFINITION_ID_DRIFT");
  if (!Array.isArray(form.formControls) || form.formControls.length !== 1 || !uuid(object(form.formControls[0])?.identifier)) return fail("FORM_ACTION_SCHEMA_DRIFT");
  if (!Array.isArray(form.sections)) return fail("FORM_SECTION_SCHEMA_DRIFT");
  const fields = new Map<string, Field>();
  for (const section of form.sections) {
    const s = object(section);
    if (!s || !Array.isArray(s.fieldEntries)) return fail("FORM_FIELD_LIST_DRIFT");
    for (const entry of s.fieldEntries) {
      const e = object(entry), f = object(e?.field);
      if (!e || !f || typeof f.path !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(f.path) || typeof f.type !== "string" || fields.has(f.path)) return fail("FIELD_SCHEMA_DRIFT");
      const options = Array.isArray(f.selectableValues) ? f.selectableValues.map((item) => {
        const option = object(item);
        if (!option || typeof option.label !== "string" || !Object.hasOwn(option, "value")) return fail("FIELD_OPTIONS_SCHEMA_DRIFT");
        return { label: option.label, value: option.value };
      }) : [];
      const raw = object(e.fieldValue);
      const stored = raw?.__typename === "JSONBox" ? raw.value : raw?.__typename === "File" ? { fileId: raw.id, filename: raw.filename } : e.fieldValue == null ? null : fail("FIELD_VALUE_SCHEMA_DRIFT");
      const locationTypes = f.type === "Location" ? f.locationTypes ?? CITY_LOOKUP : null;
      if (f.type === "Location" && !reviewedLocationTypes(locationTypes)) return fail("LOCATION_TYPES_SCHEMA_DRIFT");
      fields.set(f.path, { path: f.path, type: f.type, many: f.isMany === true, options, value: stored, required: e.isRequired === true, hidden: s.isHidden === true || e.isHidden === true, locationTypes });
    }
  }
  return { id: form.id, definition: form.sourceFormDefinitionId, action: String(object(form.formControls[0])!.identifier), fields };
}
type FieldAction = { form: Form; field: Field; expected: unknown; admitted: boolean; acknowledged: boolean; approved: AgentFieldValue; match?: OptionMatch };
type UploadAction = { form: Form; field: Field; artifact: MaterializedApplicationArtifact; handleRequested: boolean; handle?: string; url?: string; fields?: Record<string, string>; bytesAcknowledged: boolean; attachRequested: boolean; acknowledged: boolean };

export function createAshbyProtocol(board: string, jobId: string) {
  let forms: Form[] = [];
  let fieldAction: FieldAction | null = null;
  let uploadAction: UploadAction | null = null;
  const locations = new Map<string, unknown>();
  let broken = false;
  let authorizationFailure: string | null = null;
  let informationalNoticeRuleId: string | null = null;
  let informationalNoticeHash: string | null = null;
  const endpoint = (operation: AshbyOperation, origin: string) => `${origin}/api/non-user-graphql?op=${operation}`;
  const assertReady = () => { if (broken || !forms.length) fail("FORM_NOT_READY"); };
  const matchField = (field: AgentBrowserField): { form: Form; field: Field } => {
    assertReady();
    const matches = forms.flatMap((form) => [...form.fields.values()].filter((item) => item.path === (field.domId || field.name) && (!field.formKey || field.formKey === form.id)).map((item) => ({ form, field: item })));
    if (matches.length !== 1 || matches[0].field.hidden) return fail("FIELD_BINDING_DRIFT");
    return matches[0];
  };
  const bindingFailure = (v: Obj, form: Form, field: Field) =>
    v.organizationHostedJobsPageName !== board ? "BOARD" : v.formRenderIdentifier !== form.id ? "FORM" :
    v.formDefinitionIdentifier !== form.definition ? "DEFINITION" : v.path !== field.path ? "PATH" : null;
  function updateForm(raw: unknown, expected: FieldAction | UploadAction, file: boolean) {
    const next = readForm(raw, uuid(expected.form.definition) ? undefined : jobId);
    if (next.id !== expected.form.id) return fail("FORM_RENDER_ID_DRIFT");
    if (next.definition !== expected.form.definition) return fail("FORM_DEFINITION_ID_DRIFT");
    const dimensions = new Set<string>();
    if (next.action !== expected.form.action) dimensions.add("ACTION");
    const previousPaths = [...expected.form.fields.keys()], nextPaths = [...next.fields.keys()];
    if (previousPaths.length !== nextPaths.length || previousPaths.some(path => !next.fields.has(path))) dimensions.add("SET");
    else if (!equal(previousPaths, nextPaths)) dimensions.add("ORDER");
    for (const [path, prior] of expected.form.fields) {
      const actual = next.fields.get(path);
      if (!actual) continue;
      if (actual.type !== prior.type) dimensions.add("TYPE");
      if (actual.many !== prior.many) dimensions.add("MULTI");
      if (!equal(actual.options, prior.options)) dimensions.add("OPTIONS");
      if (actual.required !== prior.required) dimensions.add("REQUIRED");
      if (actual.hidden !== prior.hidden) dimensions.add("HIDDEN");
      if (!equal(actual.locationTypes, prior.locationTypes)) dimensions.add("LOCATION_TYPES");
    }
    // Bounded static dimensions reveal simultaneous schema changes without
    // logging field paths, labels, answers, identifiers or response content.
    if ([...dimensions].some(key => key !== "ACTION")) return fail("FORM_SCHEMA_" + ["ACTION", "SET", "ORDER", "TYPE", "MULTI", "OPTIONS", "REQUIRED", "HIDDEN", "LOCATION_TYPES"].filter(key => dimensions.has(key)).join("_") + "_DRIFT");
    for (const [path, prior] of expected.form.fields) {
      const actual = next.fields.get(path)!.value;
      if (path === expected.field.path) {
        if (file) {
          const saved = object(actual);
          if (!saved || !uuid(saved.fileId) || saved.filename !== (expected as UploadAction).artifact.filename) return fail("UPLOAD_ECHO_DRIFT");
        } else if (!equal(actual, (expected as FieldAction).expected)) return fail("FIELD_VALUE_ECHO_DRIFT");
      } else if (!equal(actual, prior.value)) return fail("OTHER_FIELD_VALUE_DRIFT");
    }
    // Verified 2026-09-30: an acknowledged autosave rotates this server-issued
    // action ID. Accept it only after every metadata and value check succeeds;
    // review() seals the latest ID and authorize() rejects every older one.
    expected.form.action = next.action;
    for (const [path, actual] of next.fields) expected.form.fields.get(path)!.value = actual.value;
    expected.acknowledged = true;
  }
  return {
    endpoint,
    ready: () => !broken && forms.length > 0,
    submitOperation: (): AshbyOperation => forms.length > 1 ? "ApiSubmitMultipleFormsAction" : "ApiSubmitSingleApplicationFormAction",
    fileFields() { assertReady(); return forms.flatMap((form) => [...form.fields.values()].filter((field) => field.type === "File" && !field.many && !field.hidden).map((field) => ({ formId: form.id, path: field.path }))); },
    beginField(field: AgentBrowserField, approved: AgentFieldValue, match?: OptionMatch) {
      if (fieldAction || uploadAction) return fail("ACTION_ALREADY_ACTIVE");
      const target = matchField(field);
      const { type, many, options } = target.field;
      let expected: unknown = approved;
      if (type === "Boolean") {
        if (typeof approved === "boolean") expected = approved;
        else if (typeof approved === "string" && /^(?:yes|no|true|false)$/iu.test(approved.trim())) expected = /^(?:yes|true)$/iu.test(approved.trim());
        else return fail("BOOLEAN_VALUE_TYPE_INVALID");
      } else if (type === "ValueSelect") {
        const resolve = (value: string) => {
          const found = resolveOptionValue(options.map((option) => ({ label: option.label, value: String(option.value) })), value, match);
          return found ?? fail();
        };
        expected = many && Array.isArray(approved) ? approved.map(resolve) : typeof approved === "string" && !many ? resolve(approved) : fail();
      } else if (type === "Location") {
        if (typeof approved !== "string" || many) return fail("LOCATION_VALUE_TYPE_INVALID");
        expected = undefined; locations.clear();
      } else if (!["String", "LongText", "Email", "Phone", "Url", "Number"].includes(type) || many || typeof approved !== "string") return fail("FIELD_VALUE_TYPE_UNSUPPORTED");
      fieldAction = { ...target, expected, admitted: false, acknowledged: false, approved, match };
    },
    fieldAcknowledged: () => fieldAction?.acknowledged === true,
    endField() { fieldAction = null; locations.clear(); },
    beginUpload(field: AgentBrowserField, artifact: MaterializedApplicationArtifact) {
      if (fieldAction || uploadAction) return fail("ACTION_ALREADY_ACTIVE");
      const target = matchField(field);
      if (target.field.type !== "File" || target.field.many || target.field.value !== null) return fail("UPLOAD_FIELD_STATE_DRIFT");
      uploadAction = { ...target, artifact, handleRequested: false, bytesAcknowledged: false, attachRequested: false, acknowledged: false };
    },
    upload: () => uploadAction,
    endUpload() { uploadAction = null; },
    acknowledgeBytes() { if (!uploadAction?.url) return fail(); uploadAction.bytesAcknowledged = true; },
    authorizationFailure: () => authorizationFailure,
    /** Called before dispatch, so duplicate mutations cannot race the response. */
    authorize(envelope: AshbyEnvelope, search?: string, submitting = false): "READ" | "SEARCH" | "FIELD" | "HANDLE" | "ATTACH" | "SUBMIT" | null {
      authorizationFailure = null;
      const { operation: op, variables: v } = envelope;
      const reject = (reason: string): null => { authorizationFailure = "DELIVERY_ASHBY_REQUEST_" + OPERATION_STAGE[op] + "_" + reason; return null; };
      if (broken) return reject("PROTOCOL_BROKEN");
      if (op === "ApiJobPosting") {
        if (forms.length) return reject("ALREADY_LOADED");
        if (!keys(v, ["organizationHostedJobsPageName", "jobPostingId"])) return reject("VARIABLE_KEYS");
        if (v.organizationHostedJobsPageName !== board) return reject("BOARD");
        if (v.jobPostingId !== jobId) return reject("JOB");
        return "READ";
      }
      if (op === "ApiOrganizationFromHostedJobsPageName") {
        if (!keys(v, ["organizationHostedJobsPageName"], ["searchContext"])) return reject("VARIABLE_KEYS");
        if (v.organizationHostedJobsPageName !== board) return reject("BOARD");
        if (Object.hasOwn(v, "searchContext") && ![null, "JobPosting"].includes(v.searchContext as null | string)) return reject("CONTEXT");
        return "READ";
      }
      if (op === "ApiAutocompleteGeoLocation") {
        // The public widget reads this constant query on mount and after saves.
        // It carries no candidate text, and its response cannot seed a choice.
        if (keys(v, ["text", "locationTypes"]) && v.text === "" && reviewedLocationTypes(v.locationTypes)) return "READ";
        if (!fieldAction) return reject("NO_FIELD_ACTION");
        if (fieldAction.field.type !== "Location") return reject("FIELD_TYPE");
        if (!search) return reject("NO_SEARCH_ACTION");
        if (!keys(v, ["text", "locationTypes"])) return reject("VARIABLE_KEYS");
        if (typeof v.text !== "string" || !v.text.length || !search.startsWith(v.text)) return reject("TEXT");
        if (!equal(v.locationTypes, fieldAction.field.locationTypes)) return reject("LOCATION_TYPES");
        return "SEARCH";
      }
      if (op === "ApiSetFormValue") {
        const a = fieldAction;
        if (!a) return reject("NO_ACTION");
        if (a.admitted) return reject(a.acknowledged ? "DUPLICATE_ACKNOWLEDGED" : "DUPLICATE_PENDING");
        if (!keys(v, ["organizationHostedJobsPageName", "formRenderIdentifier", "formDefinitionIdentifier", "path", "value"])) return reject("VARIABLE_KEYS");
        const mismatch = bindingFailure(v, a.form, a.field); if (mismatch) return reject(mismatch);
        if (a.field.type === "Location") {
          const chosen = chooseSearchResult([...locations.values()].map((value) => String(object(value)!.text)), String(a.approved), a.match);
          if (!chosen) return reject("LOCATION_NO_CONFIRMED_RESULT");
          if (!locations.has(stable(v.value))) return reject("LOCATION_UNKNOWN_RESULT");
          if (object(v.value)?.text !== chosen) return reject("LOCATION_WRONG_RESULT");
          a.expected = v.value;
        }
        if (!equal(v.value, a.expected)) return reject("VALUE");
        a.admitted = true; return "FIELD";
      }
      if (op === "ApiCreateFileUploadHandle") {
        const a = uploadAction;
        if (!a) return reject("NO_ACTION");
        if (a.handleRequested) return reject("DUPLICATE");
        if (!keys(v, ["organizationHostedJobsPageName", "fileUploadContext", "filename", "contentType", "contentLength"])) return reject("VARIABLE_KEYS");
        if (v.organizationHostedJobsPageName !== board) return reject("BOARD");
        if (v.fileUploadContext !== "NonUserFormEngine") return reject("CONTEXT");
        if (v.filename !== a.artifact.filename) return reject("FILENAME");
        if (v.contentType !== a.artifact.mediaType) return reject("MEDIA_TYPE");
        if (v.contentLength !== a.artifact.byteSize) return reject("BYTE_LENGTH");
        a.handleRequested = true; return "HANDLE";
      }
      if (op === "ApiSetFormValueToFile") {
        const a = uploadAction;
        if (!a) return reject("NO_ACTION");
        if (!a.bytesAcknowledged) return reject("BYTES_NOT_ACKNOWLEDGED");
        if (a.attachRequested) return reject(a.acknowledged ? "DUPLICATE_ACKNOWLEDGED" : "DUPLICATE_PENDING");
        if (!keys(v, ["organizationHostedJobsPageName", "formRenderIdentifier", "formDefinitionIdentifier", "path", "fileHandle"])) return reject("VARIABLE_KEYS");
        const mismatch = bindingFailure(v, a.form, a.field); if (mismatch) return reject(mismatch);
        if (v.fileHandle !== a.handle) return reject("HANDLE");
        a.attachRequested = true; return "ATTACH";
      }
      if (!submitting) return reject("NO_SUBMIT_ACTION");
      if (fieldAction) return reject("FIELD_ACTION_ACTIVE");
      if (uploadAction) return reject("UPLOAD_ACTION_ACTIVE");
      if (!forms.length) return reject("FORM_NOT_READY");
      const app = forms[0];
      const common = { organizationHostedJobsPageName: board, jobPostingId: jobId };
      const binding = forms.length > 1 ? { ...common, applicationFormRenderIdentifier: app.id, applicationFormActionIdentifier: app.action, applicationFormDefinitionIdentifier: app.definition, surveyIdentifiers: forms.slice(1).map((form) => ({ formRenderId: form.id, actionIdentifier: form.action, sourceFormDefinitionId: form.definition })) }
        : { ...common, formRenderIdentifier: app.id, actionIdentifier: app.action, formDefinitionIdentifier: app.definition };
      if (op !== (forms.length > 1 ? "ApiSubmitMultipleFormsAction" : "ApiSubmitSingleApplicationFormAction")) return reject("FORM_COUNT");
      if (!keys(v, Object.keys(binding), ["recaptchaToken", "deviceFingerprint", "sourceAttributionCode", "viewedAutomatedProcessingLegalNoticeRuleId", "applicationRequestId"])) return reject("VARIABLE_KEYS");
      const bindingNames: Record<string, string> = { organizationHostedJobsPageName: "BOARD", jobPostingId: "JOB", applicationFormRenderIdentifier: "FORM", formRenderIdentifier: "FORM", applicationFormActionIdentifier: "ACTION", actionIdentifier: "ACTION", applicationFormDefinitionIdentifier: "DEFINITION", formDefinitionIdentifier: "DEFINITION", surveyIdentifiers: "SURVEYS" };
      for (const [key, value] of Object.entries(binding)) if (!equal(v[key], value)) return reject(bindingNames[key]);
      if (v.sourceAttributionCode != null) return reject("SOURCE_ATTRIBUTION");
      if ((v.viewedAutomatedProcessingLegalNoticeRuleId ?? null) !== informationalNoticeRuleId) return reject("LEGAL_NOTICE");
      if (v.applicationRequestId != null) return reject("APPLICATION_REQUEST");
      // Reviewed public client prefixes Enterprise tokens before dispatch.
      // Keep the opaque suffix and total size bounded; never accept an empty,
      // invented or unreviewed envelope. The provider validates the token.
      if (typeof v.recaptchaToken !== "string" || v.recaptchaToken.length > 12_000 ||
          !/^(?:ENT===|UNIVERSAL_ENT===)?[A-Za-z0-9_:.\/-]+$/u.test(v.recaptchaToken)) return reject("RECAPTCHA_TOKEN");
      if (v.deviceFingerprint != null && (typeof v.deviceFingerprint !== "string" || v.deviceFingerprint.length > 32_000 || !/^W;6\.10\.0;[A-Za-z0-9+/]+={0,2};[A-Za-z0-9+/]+={0,2}$/u.test(v.deviceFingerprint))) return reject("DEVICE_FINGERPRINT");
      return "SUBMIT";
    },
    observe(envelope: AshbyEnvelope, payload: unknown) {
      try {
        const body = object(payload), data = object(body?.data);
        if (!data || body?.errors != null) return fail("RESPONSE_DATA_INVALID");
        const op = envelope.operation;
        if (op === "ApiJobPosting") {
          const posting = object(data.jobPosting);
          if (!posting || posting.id !== jobId || forms.length || !Array.isArray(posting.surveyForms)) return fail("POSTING_SCHEMA_DRIFT");
          if (posting.automatedProcessingLegalNotice != null) {
            const notice = object(posting.automatedProcessingLegalNotice);
            // The reviewed client displays a passive "may use AI / Learn more" notice and echoes its rule ID.
            // Passive notice content is bound into review; interactive consent fields use saved delegation.
            if (!notice || !uuid(notice.automatedProcessingLegalNoticeRuleId)
              || !Object.hasOwn(notice, "automatedProcessingLegalNoticeHtml")) return fail("LEGAL_NOTICE_SCHEMA_DRIFT");
            const html = notice.automatedProcessingLegalNoticeHtml;
            if (html !== null && (typeof html !== "string" || html.length > 32_000)) return fail("LEGAL_NOTICE_SCHEMA_DRIFT");
            informationalNoticeHash = createHash("sha256").update(JSON.stringify(html)).digest("hex");
            informationalNoticeRuleId = notice.automatedProcessingLegalNoticeRuleId;
          }
          forms = [readForm(posting.applicationForm, jobId), ...posting.surveyForms.map(value => readForm(value))];
          if (new Set(forms.map((form) => form.id)).size !== forms.length || forms.some((form) => [...form.fields.values()].some((field) => field.value !== null))) return fail("INITIAL_FORM_STATE_UNSUPPORTED");
        } else if (op === "ApiAutocompleteGeoLocation" && envelope.variables.text !== "" && fieldAction?.field.type === "Location") {
          const results = object(data.result)?.suggestions;
          if (!Array.isArray(results)) return fail("LOCATION_RESPONSE_DRIFT");
          for (const item of results) {
            const result = object(item), path = result?.geoLocationPath;
            const last = Array.isArray(path) ? object(path.at(-1)) : null;
            if (typeof result?.name !== "string" || typeof last?.providerLocationId !== "string" || last.type !== "City") continue;
            const value = { text: result.name, providerLocationId: last.providerLocationId };
            locations.set(stable(value), value);
          }
        } else if (op === "ApiSetFormValue") { if (!fieldAction?.admitted) return fail("FIELD_ACK_OUTSIDE_ACTION"); updateForm(data.setFormValue, fieldAction, false); }
        else if (op === "ApiCreateFileUploadHandle") {
          const a = uploadAction, handle = object(data.fileUploadHandle), fields = object(handle?.fields);
          if (!a?.handleRequested || a.handle || typeof handle?.handle !== "string" || !handle.handle || handle.handle.length > 500 || typeof handle.url !== "string" || !fields) return fail("UPLOAD_HANDLE_SCHEMA_DRIFT");
          const url = new URL(handle.url);
          if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !/^[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/u.test(url.hostname) || Object.keys(fields).length > 20 || Object.entries(fields).some(([key, value]) => !/^[A-Za-z0-9_-]{1,100}$/u.test(key) || typeof value !== "string" || value.length > 12_000)) return fail("UPLOAD_HANDLE_DESTINATION_DRIFT");
          a.handle = handle.handle; a.url = url.href; a.fields = { "Content-Type": a.artifact.mediaType, ...fields as Record<string, string> };
          if (a.fields["Content-Type"] !== a.artifact.mediaType || Object.hasOwn(a.fields, "success_action_redirect") || Object.hasOwn(a.fields, "redirect")) return fail("UPLOAD_HANDLE_FIELDS_DRIFT");
        } else if (op === "ApiSetFormValueToFile") { if (!uploadAction?.attachRequested) return fail("UPLOAD_ACK_OUTSIDE_ACTION"); updateForm(data.setFormValueToFile, uploadAction, true); }
      } catch (error) { broken = true; throw error; }
    },
    surveyCount: () => Math.max(0, forms.length - 1),
    review() { assertReady(); if (fieldAction || uploadAction) return fail("ACTION_ALREADY_ACTIVE"); return forms.map((form) => ({ formId: form.id, definitionId: form.definition, actionId: form.action,
      ...(informationalNoticeRuleId ? { informationalNoticeRuleId, informationalNoticeHash } : {}),
      fields: [...form.fields.values()].map((field) => ({ path: field.path, valueHash: digest(stable(field.value)) })) })); },
  };
}

export function ashbySubmissionAccepted(operation: AshbyOperation, payload: unknown, surveyCount = 0): boolean {
  const body = object(payload), data = object(body?.data);
  if (!body || !data || body.errors != null) return false;
  const multiple = operation === "ApiSubmitMultipleFormsAction";
  if (!multiple && operation !== "ApiSubmitSingleApplicationFormAction") return false;
  const result = object(data[multiple ? "submitMultipleFormsAction" : "submitApplicationFormAction"]);
  if (!result || object(result.applicationFormResult)?.__typename !== "FormSubmitSuccess" || object(result.messages)?.blockMessageForCandidateHtml) return false;
  return !multiple || surveyCount > 0 && Array.isArray(result.surveyFormResults) && result.surveyFormResults.length === surveyCount && result.surveyFormResults.every((value) => object(value)?.__typename === "FormSubmitSuccess");
}

export type AshbySubmissionDiagnostics = Readonly<{
  classification: "BODY_UNAVAILABLE" | "BODY_TOO_LARGE" | "JSON_INVALID" | "ENVELOPE_INVALID" | "GRAPHQL_ERRORS" |
    "MAIN_FORM_RENDER" | "MAIN_RESULT_INVALID" | "BLOCK_MESSAGE" | "SURVEY_RESULTS_INVALID" |
    "SURVEY_COUNT_MISMATCH" | "SURVEY_RESULT_FAILURE" | "ACCEPTED";
  mainResult: "SUCCESS" | "FORM_RENDER" | "OTHER" | "MISSING";
  surveyResults: "ARRAY" | "OTHER" | "MISSING";
  expectedSurveyCount: number;
  surveyResultCount: number;
  surveySuccessCount: number;
  surveyFormRenderCount: number;
  surveyOtherCount: number;
  graphqlErrors: "ABSENT" | "ARRAY" | "OTHER";
  graphqlErrorCount: number;
  blockMessage: "ABSENT" | "PRESENT";
}>;

/** Static categories and capped counts only. This is diagnostic evidence, not
 * submission authority or a substitute for the unchanged acceptance predicate.
 * Never retain raw types, GraphQL messages, form fields or candidate content. */
export function inspectAshbySubmissionResponse(operation: AshbyOperation, bytes: Buffer | null, surveyCount = 0): AshbySubmissionDiagnostics {
  const count = (value: number) => Number.isFinite(value) ? Math.min(1_000, Math.max(0, Math.floor(value))) : 0;
  const diagnostic: AshbySubmissionDiagnostics = {
    classification: "BODY_UNAVAILABLE", mainResult: "MISSING", surveyResults: "MISSING", expectedSurveyCount: count(surveyCount),
    surveyResultCount: 0, surveySuccessCount: 0, surveyFormRenderCount: 0, surveyOtherCount: 0,
    graphqlErrors: "ABSENT", graphqlErrorCount: 0, blockMessage: "ABSENT",
  };
  const result = (classification: AshbySubmissionDiagnostics["classification"], dimensions: Partial<AshbySubmissionDiagnostics> = {}): AshbySubmissionDiagnostics =>
    ({ ...diagnostic, ...dimensions, classification });
  if (!bytes) return diagnostic;
  if (bytes.length > 2_000_000) return result("BODY_TOO_LARGE");
  let payload: unknown;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch { return result("JSON_INVALID"); }
  const body = object(payload), data = object(body?.data);
  const multiple = operation === "ApiSubmitMultipleFormsAction";
  if (!body || !multiple && operation !== "ApiSubmitSingleApplicationFormAction") return result("ENVELOPE_INVALID");
  const response = object(data?.[multiple ? "submitMultipleFormsAction" : "submitApplicationFormAction"]);
  const main = response?.applicationFormResult;
  const category = (value: unknown): AshbySubmissionDiagnostics["mainResult"] => value == null ? "MISSING"
    : object(value)?.__typename === "FormSubmitSuccess" ? "SUCCESS" : object(value)?.__typename === "FormRender" ? "FORM_RENDER" : "OTHER";
  const surveys = response?.surveyFormResults;
  const dimensions: Partial<AshbySubmissionDiagnostics> = {
    mainResult: category(main),
    surveyResults: Array.isArray(surveys) ? "ARRAY" : surveys == null ? "MISSING" : "OTHER",
    surveyResultCount: Array.isArray(surveys) ? count(surveys.length) : 0,
    surveySuccessCount: Array.isArray(surveys) ? count(surveys.filter(value => category(value) === "SUCCESS").length) : 0,
    surveyFormRenderCount: Array.isArray(surveys) ? count(surveys.filter(value => category(value) === "FORM_RENDER").length) : 0,
    surveyOtherCount: Array.isArray(surveys) ? count(surveys.filter(value => !["SUCCESS", "FORM_RENDER"].includes(category(value))).length) : 0,
    graphqlErrors: body.errors == null ? "ABSENT" : Array.isArray(body.errors) ? "ARRAY" : "OTHER",
    graphqlErrorCount: Array.isArray(body.errors) ? count(body.errors.length) : 0,
    blockMessage: object(response?.messages)?.blockMessageForCandidateHtml ? "PRESENT" : "ABSENT",
  };
  if (body.errors != null) return result("GRAPHQL_ERRORS", dimensions);
  if (!data || !response) return result("ENVELOPE_INVALID", dimensions);
  if (dimensions.mainResult !== "SUCCESS") return result(dimensions.mainResult === "FORM_RENDER" ? "MAIN_FORM_RENDER" : "MAIN_RESULT_INVALID", dimensions);
  if (dimensions.blockMessage === "PRESENT") return result("BLOCK_MESSAGE", dimensions);
  if (multiple && !Array.isArray(surveys)) return result("SURVEY_RESULTS_INVALID", dimensions);
  if (multiple && (surveyCount <= 0 || (surveys as unknown[]).length !== surveyCount)) return result("SURVEY_COUNT_MISMATCH", dimensions);
  if (multiple && (surveys as unknown[]).some(value => category(value) !== "SUCCESS")) return result("SURVEY_RESULT_FAILURE", dimensions);
  return result("ACCEPTED", dimensions);
}
