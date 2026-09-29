import {
  CAREER_PROFILE_EXTRACTOR_RELEASE,
  CAREER_PROFILE_SCHEMA_VERSION,
  CareerProfileValidationError,
  EMPLOYMENT_KINDS,
  parseCareerProfileContent,
  ungroundedCareerProfileValues,
  withoutUngroundedSkills,
  type CareerProfileContent,
} from "../../domain/career-profile.ts";
import { modelFor } from "../ai/models.ts";
import { structuredResponse, StructuredResponseError } from "../ai/structured-response.ts";

export type CareerProfileExtractionInput = Readonly<{
  resumeText: string;
  evidence: readonly Readonly<{ key: string; category: string; text: string }>[];
  previousProfile: CareerProfileContent | null;
}>;

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const DATE = { type: ["string", "null"], pattern: "^(19|20)\\d{2}(-(0[1-9]|1[0-2]))?$" } as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "headline", "positions", "education", "certifications", "skills"],
  properties: {
    schemaVersion: { type: "integer", enum: [CAREER_PROFILE_SCHEMA_VERSION] },
    headline: NULLABLE_STRING,
    positions: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["positionKey", "title", "organization", "location", "startDate", "endDate", "current", "employmentKind", "summary", "evidenceKeys"],
        properties: {
          positionKey: NULLABLE_STRING,
          title: { type: "string", minLength: 1, maxLength: 160 },
          organization: { type: "string", minLength: 1, maxLength: 160 },
          location: NULLABLE_STRING,
          startDate: DATE,
          endDate: DATE,
          current: { type: "boolean" },
          employmentKind: { type: ["string", "null"], enum: [...EMPLOYMENT_KINDS, null] },
          summary: NULLABLE_STRING,
          evidenceKeys: { type: "array", maxItems: 40, items: { type: "string" } },
        },
      },
    },
    education: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["educationKey", "institution", "credential", "field", "location", "startDate", "endDate", "details"],
        properties: {
          educationKey: NULLABLE_STRING,
          institution: { type: "string", minLength: 1, maxLength: 160 },
          credential: { type: "string", minLength: 1, maxLength: 160 },
          field: NULLABLE_STRING,
          location: NULLABLE_STRING,
          startDate: DATE,
          endDate: DATE,
          details: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
        },
      },
    },
    certifications: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "issuer", "date"],
        properties: { name: { type: "string", minLength: 1, maxLength: 160 }, issuer: NULLABLE_STRING, date: DATE },
      },
    },
    skills: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "items"],
        properties: {
          label: NULLABLE_STRING,
          items: { type: "array", maxItems: 40, items: { type: "string", maxLength: 60 } },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `Extract one person's career history from their own reviewed résumé text into the JSON schema. You are a careful transcriber, not a writer.

- Copy job titles, organization names, institutions, credentials, certifications, and skills exactly as the résumé writes them. Fix only spacing or obvious PDF line-break artifacts. Never translate, expand, shorten, or improve them.
- Dates: use "YYYY" or "YYYY-MM" exactly as the résumé supports. "Present", "Current", or "Now" means current = true and endDate = null. Never infer a missing date. Never invent a month.
- One position per role. If the résumé shows two titles at one organization with separate dates, make two positions.
- evidenceKeys: assign each supplied evidence item to the single position it appears under in the résumé (use the key exactly). Leave summary, skills, and education passages unassigned. Include the role heading line's own key if it is supplied.
- summary: one short line of role scope only when the résumé states it (team size, company scale, territory, budget). Otherwise null.
- employmentKind: FOUNDER for founder/co-founder roles, INTERNSHIP for internships, CONTRACT for contract/freelance/consulting engagements when stated, otherwise FULL_TIME if unclear but clearly a job, or null.
- headline: the candidate's own positioning line from the top of the résumé if one exists, otherwise null.
- skills: keep the résumé's own grouping and labels. Only items literally written in the résumé.
- education: degree or program as credential, school as institution, field if separate.
- If previousProfile is supplied, reuse its positionKey and educationKey for the same roles and schools, and keep the candidate's corrections unless the résumé text now contradicts them. Use null positionKey for new roles.
- Do not add anything that is not in the résumé text.`;

export async function extractCareerProfile(
  input: CareerProfileExtractionInput,
  options: Readonly<{ apiKey?: string; environment?: NodeJS.ProcessEnv }> = {},
): Promise<Readonly<{ profile: CareerProfileContent; model: string; droppedValues: readonly string[] }>> {
  const environment = options.environment ?? process.env;
  const result = await structuredResponse({
    apiKey: options.apiKey ?? environment.OPENAI_API_KEY,
    model: modelFor("PROFILE_EXTRACTION", environment),
    instructions: INSTRUCTIONS,
    input: JSON.stringify({
      resumeText: input.resumeText.slice(0, 60_000),
      evidence: input.evidence.slice(0, 250).map((item) => ({ key: item.key, category: item.category, text: item.text.slice(0, 600) })),
      previousProfile: input.previousProfile,
    }),
    schemaName: "roledawn_career_profile",
    schema: SCHEMA as unknown as Record<string, unknown>,
    reasoningEffort: "low",
    maxOutputTokens: 8_000,
    timeoutMs: 120_000,
  });
  let parsed: CareerProfileContent;
  try {
    // Gaps are explained by the candidate in the interview, never extracted.
    parsed = parseCareerProfileContent({ ...(result.value as Record<string, unknown>), gaps: input.previousProfile?.gaps ?? [] });
  } catch (error) {
    if (error instanceof CareerProfileValidationError) throw new StructuredResponseError("CAREER_PROFILE_OUTPUT_INVALID", true);
    throw error;
  }
  const knownKeys = new Set(input.evidence.map((item) => item.key));
  const withKnownEvidence: CareerProfileContent = Object.freeze({
    ...parsed,
    positions: Object.freeze(parsed.positions.map((position) => Object.freeze({
      ...position,
      evidenceKeys: Object.freeze(position.evidenceKeys.filter((key) => knownKeys.has(key))),
    }))),
  });
  const skillsGrounded = withoutUngroundedSkills(withKnownEvidence, input.resumeText);
  const ungrounded = ungroundedCareerProfileValues(skillsGrounded, input.resumeText);
  // Drop any role, school, or certification whose identifying text is not in
  // the résumé. The candidate can add it back by hand.
  const bad = new Set(ungrounded);
  const grounded: CareerProfileContent = Object.freeze({
    ...skillsGrounded,
    positions: Object.freeze(skillsGrounded.positions.filter((position) =>
      !bad.has(`organization:${position.organization}`) && !bad.has(`title:${position.title}`))
      .map((position) => Object.freeze({
        ...position,
        startDate: position.startDate && bad.has(`date:${position.startDate}`) ? null : position.startDate,
        endDate: position.endDate && bad.has(`date:${position.endDate}`) ? null : position.endDate,
      }))),
    education: Object.freeze(skillsGrounded.education.filter((entry) =>
      !bad.has(`institution:${entry.institution}`) && !bad.has(`credential:${entry.credential}`))),
    certifications: Object.freeze(skillsGrounded.certifications.filter((entry) => !bad.has(`certification:${entry.name}`))),
  });
  return Object.freeze({ profile: grounded, model: result.model, droppedValues: ungrounded });
}

export const CAREER_PROFILE_PRODUCER_RELEASE = CAREER_PROFILE_EXTRACTOR_RELEASE;
