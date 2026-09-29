/**
 * One place to choose models per task. Every value can be overridden by an
 * environment variable so a model change never needs a code change.
 */
export type AiTask = "INTERVIEW" | "PROFILE_EXTRACTION" | "RESEARCH" | "DRAFTING" | "VERIFICATION" | "RANKING";

const DEFAULTS: Readonly<Record<AiTask, Readonly<{ variable: string; model: string }>>> = Object.freeze({
  INTERVIEW: { variable: "ROLEDAWN_INTERVIEW_MODEL", model: "gpt-5.6-terra" },
  PROFILE_EXTRACTION: { variable: "ROLEDAWN_PROFILE_MODEL", model: "gpt-5.6-terra" },
  RESEARCH: { variable: "ROLEDAWN_RESEARCH_MODEL", model: "gpt-6-sol" },
  DRAFTING: { variable: "ROLEDAWN_DRAFTING_MODEL", model: "gpt-6-astra" },
  VERIFICATION: { variable: "ROLEDAWN_VERIFICATION_MODEL", model: "gpt-5.6-terra" },
  RANKING: { variable: "ROLEDAWN_RANKING_MODEL", model: "gpt-5.6-luna" },
});

export function modelFor(task: AiTask, environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment[DEFAULTS[task].variable]?.trim();
  return configured && /^[A-Za-z0-9._:-]{2,80}$/u.test(configured) ? configured : DEFAULTS[task].model;
}
