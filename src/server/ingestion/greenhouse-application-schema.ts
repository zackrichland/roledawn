import { canonicalizeJson, sha256Text } from "./canonical.ts";
import type {
  ApplicationFieldControl,
  ApplicationQuestionSection,
  GreenhouseApplicationSchemaBinding,
  NormalizedApplicationCompliance,
  NormalizedApplicationQuestion,
  ResolvedApplicationSchema,
} from "./contracts.ts";
import { htmlToPlainText, isRecord, nullableNumber, publicHttpsUrl, stringValue } from "./normalize.ts";

export const GREENHOUSE_APPLICATION_SCHEMA_ADAPTER_RELEASE =
  "greenhouse-job-board-application-schema/1";

export class GreenhouseApplicationSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GreenhouseApplicationSchemaError";
  }
}

type ProviderOptionValue = string | number | boolean | null;

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function booleanValue(value: unknown, path: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new GreenhouseApplicationSchemaError(`${path} must be a boolean.`);
  }
  return value;
}

function arrayValue(
  source: Record<string, unknown>,
  key: string,
): readonly unknown[] {
  if (!own(source, key)) return [];
  const value = source[key];
  // Greenhouse sends null for sections a job doesn't use.
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new GreenhouseApplicationSchemaError(`Greenhouse ${key} must be an array.`);
  }
  return value;
}

function providerIdentifier(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new GreenhouseApplicationSchemaError(`${path} must be a stable identifier.`);
}

function providerOptionValue(value: unknown, path: string): ProviderOptionValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return value;
  throw new GreenhouseApplicationSchemaError(`${path} must be a JSON primitive.`);
}

function normalizedControl(rawType: string): ApplicationFieldControl {
  switch (rawType.trim().toLowerCase()) {
    case "input_text":
    case "text":
      return "SHORT_TEXT";
    case "textarea":
    case "input_textarea":
      return "LONG_TEXT";
    case "input_file":
    case "file":
      return "FILE";
    case "input_hidden":
    case "hidden":
      return "HIDDEN";
    case "multi_value_single_select":
    case "single_select":
      return "SINGLE_SELECT";
    case "multi_value_multi_select":
    case "multi_select":
      return "MULTI_SELECT";
    default:
      return "UNKNOWN";
  }
}

function requiredValue(value: unknown, path: string): boolean {
  return booleanValue(value, path) ?? false;
}

function normalizeStandardQuestions(
  values: readonly unknown[],
  section: Exclude<ApplicationQuestionSection, "DEMOGRAPHIC">,
): Readonly<{
  normalized: readonly NormalizedApplicationQuestion[];
  bindings: GreenhouseApplicationSchemaBinding["questions"];
}> {
  const normalized: NormalizedApplicationQuestion[] = [];
  const bindings: GreenhouseApplicationSchemaBinding["questions"][number][] = [];
  const sectionKey = section.toLowerCase();

  values.forEach((value, questionIndex) => {
    const path = `${sectionKey} question ${questionIndex}`;
    if (!isRecord(value)) {
      throw new GreenhouseApplicationSchemaError(`${path} must be an object.`);
    }
    const label = stringValue(value.label);
    if (!label) throw new GreenhouseApplicationSchemaError(`${path} must have a label.`);
    if (!Array.isArray(value.fields) || value.fields.length === 0) {
      throw new GreenhouseApplicationSchemaError(`${path} must contain at least one field.`);
    }

    const questionKey = `${sectionKey}:${questionIndex}`;
    const normalizedFields: NormalizedApplicationQuestion["fields"][number][] = [];
    const bindingFields: GreenhouseApplicationSchemaBinding["questions"][number]["fields"][number][] = [];

    value.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path} field ${fieldIndex}`;
      if (!isRecord(field)) {
        throw new GreenhouseApplicationSchemaError(`${fieldPath} must be an object.`);
      }
      const providerName = stringValue(field.name);
      const providerType = stringValue(field.type);
      if (!providerName || !providerType) {
        throw new GreenhouseApplicationSchemaError(`${fieldPath} must have a name and type.`);
      }
      const rawOptions = arrayValue(field, "values");
      const fieldKey = `${questionKey}:field:${fieldIndex}`;
      const normalizedOptions: NormalizedApplicationQuestion["fields"][number]["options"][number][] = [];
      const bindingOptions: GreenhouseApplicationSchemaBinding["questions"][number]["fields"][number]["options"][number][] = [];

      rawOptions.forEach((rawOption, optionIndex) => {
        const optionPath = `${fieldPath} option ${optionIndex}`;
        if (!isRecord(rawOption)) {
          throw new GreenhouseApplicationSchemaError(`${optionPath} must be an object.`);
        }
        if (!own(rawOption, "value") && !own(rawOption, "id")) {
          throw new GreenhouseApplicationSchemaError(`${optionPath} must have a provider value.`);
        }
        const rawProviderValue = own(rawOption, "value") ? rawOption.value : rawOption.id;
        const optionLabel = stringValue(rawOption.label)
          ?? (typeof rawProviderValue === "string" || typeof rawProviderValue === "number"
            ? String(rawProviderValue)
            : null);
        if (!optionLabel) {
          throw new GreenhouseApplicationSchemaError(`${optionPath} must have a label.`);
        }
        const optionKey = `${fieldKey}:option:${optionIndex}`;
        normalizedOptions.push({ key: optionKey, label: optionLabel, allowsFreeForm: false });
        bindingOptions.push({
          optionKey,
          providerValue: providerOptionValue(rawProviderValue, `${optionPath} value`),
        });
      });

      normalizedFields.push({
        key: fieldKey,
        control: normalizedControl(providerType),
        options: normalizedOptions,
      });
      bindingFields.push({
        fieldKey,
        providerName,
        providerType,
        options: bindingOptions,
      });
    });

    normalized.push({
      key: questionKey,
      section,
      label,
      descriptionText: htmlToPlainText(value.description),
      required: requiredValue(value.required, `${path} required`),
      fields: normalizedFields,
    });
    bindings.push({
      questionKey,
      providerQuestionId: null,
      fields: bindingFields,
    });
  });

  return { normalized, bindings };
}

/** "DisabilityStatus" -> "Disability Status"; ordinary labels are unchanged. */
function readableLabel(label: unknown): unknown {
  return typeof label === "string" && /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/u.test(label.trim())
    ? label.trim().replace(/(?<=[a-z])(?=[A-Z])/gu, " ")
    : label;
}

/**
 * Greenhouse returns compliance (EEOC/OFCCP) questions grouped in sections:
 * `[{ type: "eeoc", description, questions: [...] }]`. Older payloads list the
 * questions directly. Sections without questions carry only notice text.
 */
function flattenComplianceQuestions(values: readonly unknown[]): readonly unknown[] {
  return values.flatMap((value) => {
    if (!isRecord(value) || own(value, "label") || own(value, "fields") || !own(value, "questions")) return [value];
    if (!Array.isArray(value.questions)) {
      throw new GreenhouseApplicationSchemaError("Greenhouse compliance section questions must be an array.");
    }
    return value.questions.map((question) => isRecord(question)
      ? { ...question, label: readableLabel(question.label) }
      : question);
  });
}

function normalizeDemographicQuestions(
  values: readonly unknown[],
): Readonly<{
  normalized: readonly NormalizedApplicationQuestion[];
  bindings: GreenhouseApplicationSchemaBinding["questions"];
}> {
  const normalized: NormalizedApplicationQuestion[] = [];
  const bindings: GreenhouseApplicationSchemaBinding["questions"][number][] = [];

  values.forEach((value, questionIndex) => {
    const path = `demographic question ${questionIndex}`;
    if (!isRecord(value)) {
      throw new GreenhouseApplicationSchemaError(`${path} must be an object.`);
    }
    const providerQuestionId = providerIdentifier(value.id, `${path} id`);
    const label = stringValue(value.label);
    if (!label) throw new GreenhouseApplicationSchemaError(`${path} must have a label.`);
    const rawOptions = arrayValue(value, "answer_options");
    const providerType = stringValue(value.type) ?? "single_select";
    const questionKey = `demographic:${questionIndex}`;
    const fieldKey = `${questionKey}:field:0`;
    const normalizedOptions: NormalizedApplicationQuestion["fields"][number]["options"][number][] = [];
    const bindingOptions: GreenhouseApplicationSchemaBinding["questions"][number]["fields"][number]["options"][number][] = [];

    rawOptions.forEach((rawOption, optionIndex) => {
      const optionPath = `${path} option ${optionIndex}`;
      if (!isRecord(rawOption)) {
        throw new GreenhouseApplicationSchemaError(`${optionPath} must be an object.`);
      }
      const providerValue = providerIdentifier(rawOption.id, `${optionPath} id`);
      const optionLabel = stringValue(rawOption.label);
      if (!optionLabel) {
        throw new GreenhouseApplicationSchemaError(`${optionPath} must have a label.`);
      }
      const optionKey = `${fieldKey}:option:${optionIndex}`;
      normalizedOptions.push({
        key: optionKey,
        label: optionLabel,
        allowsFreeForm: booleanValue(rawOption.free_form, `${optionPath} free_form`) ?? false,
      });
      bindingOptions.push({ optionKey, providerValue });
    });

    normalized.push({
      key: questionKey,
      section: "DEMOGRAPHIC",
      label,
      descriptionText: htmlToPlainText(value.description),
      required: requiredValue(value.required, `${path} required`),
      fields: [{
        key: fieldKey,
        control: normalizedControl(providerType),
        options: normalizedOptions,
      }],
    });
    bindings.push({
      questionKey,
      providerQuestionId,
      fields: [{
        fieldKey,
        providerName: null,
        providerType,
        options: bindingOptions,
      }],
    });
  });

  return { normalized, bindings };
}

function demographicSurface(payload: Record<string, unknown>): Readonly<{
  questions: readonly unknown[];
  notice: Readonly<{ heading: string | null; text: string | null }> | null;
}> {
  if (!own(payload, "demographic_questions") || payload.demographic_questions === null) return { questions: [], notice: null };
  const value = payload.demographic_questions;
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    throw new GreenhouseApplicationSchemaError(
      "Greenhouse demographic_questions must be an object containing a questions array.",
    );
  }
  const heading = stringValue(value.header);
  const text = htmlToPlainText(value.description);
  return {
    questions: value.questions,
    notice: heading || text ? { heading, text } : null,
  };
}

function normalizeCompliance(
  values: readonly unknown[],
): Readonly<{
  normalized: readonly NormalizedApplicationCompliance[];
  bindings: GreenhouseApplicationSchemaBinding["compliance"];
}> {
  const normalized: NormalizedApplicationCompliance[] = [];
  const bindings: GreenhouseApplicationSchemaBinding["compliance"][number][] = [];

  values.forEach((value, index) => {
    const path = `data compliance entry ${index}`;
    if (!isRecord(value)) {
      throw new GreenhouseApplicationSchemaError(`${path} must be an object.`);
    }
    const providerType = stringValue(value.type);
    if (!providerType) {
      throw new GreenhouseApplicationSchemaError(`${path} must have a type.`);
    }
    const retentionPeriodDays = nullableNumber(value.retention_period);
    if (value.retention_period !== undefined && value.retention_period !== null && retentionPeriodDays === null) {
      throw new GreenhouseApplicationSchemaError(`${path} retention_period must be a finite number.`);
    }
    if (retentionPeriodDays !== null && (!Number.isInteger(retentionPeriodDays) || retentionPeriodDays < 0)) {
      throw new GreenhouseApplicationSchemaError(`${path} retention_period must be a non-negative integer.`);
    }
    const complianceKey = `data-processing:${index}`;
    normalized.push({
      key: complianceKey,
      kind: "DATA_PROCESSING",
      requiresConsent: booleanValue(value.requires_consent, `${path} requires_consent`),
      requiresProcessingConsent: booleanValue(
        value.requires_processing_consent,
        `${path} requires_processing_consent`,
      ),
      requiresRetentionConsent: booleanValue(
        value.requires_retention_consent,
        `${path} requires_retention_consent`,
      ),
      retentionPeriodDays,
      demographicDataConsentApplies: booleanValue(
        value.demographic_data_consent_applies,
        `${path} demographic_data_consent_applies`,
      ),
    });
    bindings.push({ complianceKey, providerType });
  });

  return { normalized, bindings };
}

export function normalizeGreenhouseApplicationSchema(
  payload: unknown,
): ResolvedApplicationSchema | null {
  if (!isRecord(payload)) return null;
  const schemaKeys = [
    "questions",
    "location_questions",
    "compliance",
    "demographic_questions",
    "data_compliance",
    "include_ai_disclaimer",
    "ai_disclaimer",
    "ai_opt_out_request_url",
  ] as const;
  if (!schemaKeys.some((key) => own(payload, key))) return null;

  const core = normalizeStandardQuestions(arrayValue(payload, "questions"), "CORE");
  const location = normalizeStandardQuestions(arrayValue(payload, "location_questions"), "LOCATION");
  const complianceQuestions = normalizeStandardQuestions(flattenComplianceQuestions(arrayValue(payload, "compliance")), "COMPLIANCE");
  const demographicGroup = demographicSurface(payload);
  const demographic = normalizeDemographicQuestions(demographicGroup.questions);
  const dataCompliance = normalizeCompliance(arrayValue(payload, "data_compliance"));

  // An opt-out link that isn't a public https URL (e.g. mailto:) is shown as text only.
  const rawOptOutUrl = stringValue(payload.ai_opt_out_request_url);
  const optOutUrl = rawOptOutUrl ? publicHttpsUrl(rawOptOutUrl) : null;
  const aiEnabled = booleanValue(payload.include_ai_disclaimer, "Greenhouse include_ai_disclaimer");
  const aiText = htmlToPlainText(payload.ai_disclaimer);
  const aiUseNotice = aiEnabled !== null || aiText !== null || optOutUrl !== null
    ? { enabled: aiEnabled, text: aiText, optOutUrl }
    : null;

  const normalizedSchema = {
    schemaVersion: 1,
    questions: [
      ...core.normalized,
      ...location.normalized,
      ...complianceQuestions.normalized,
      ...demographic.normalized,
    ],
    compliance: dataCompliance.normalized,
    demographicNotice: demographicGroup.notice,
    aiUseNotice,
  } as const;
  const providerBinding = {
    schemaVersion: 1,
    provider: "GREENHOUSE",
    questions: [
      ...core.bindings,
      ...location.bindings,
      ...complianceQuestions.bindings,
      ...demographic.bindings,
    ],
    compliance: dataCompliance.bindings,
  } as const satisfies GreenhouseApplicationSchemaBinding;
  const schemaHash = sha256Text(canonicalizeJson({
    adapterRelease: GREENHOUSE_APPLICATION_SCHEMA_ADAPTER_RELEASE,
    normalizedSchema,
    providerBinding,
  }));

  return {
    provider: "GREENHOUSE",
    adapterRelease: GREENHOUSE_APPLICATION_SCHEMA_ADAPTER_RELEASE,
    schemaHash,
    normalizedSchema,
    providerBinding,
  };
}
