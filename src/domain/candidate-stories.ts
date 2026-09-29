/**
 * STAR stories captured from the candidate's own interview answers. A story is
 * narrative evidence: it may support résumé bullets and cover-letter prose once
 * the candidate approves the readback, never an exact form answer.
 */

export const STORY_THEMES = [
  "new business",
  "retention and expansion",
  "executive access",
  "process design",
  "zero to one",
  "automation and AI",
  "technical build",
  "team leadership",
  "cross-functional delivery",
  "customer discovery",
  "turnaround",
  "cost reduction",
  "revenue growth",
  "compliance and risk",
  "data and analytics",
  "operations at scale",
  "failure and recovery",
  "conflict and negotiation",
  "teaching and coaching",
  "craft and quality",
] as const;

export type StoryMetricConfidence = "STATED" | "ESTIMATED";

export type StoryMetric = Readonly<{
  /** Exactly as the candidate said it, e.g. "$3M to $10M+", "~5,000", "half". */
  value: string;
  /** What it measures, e.g. "annual revenue", "messages sent in one day". */
  label: string;
  confidence: StoryMetricConfidence;
}>;

export type StoryDraft = Readonly<{
  title: string;
  positionKey: string | null;
  organization: string | null;
  roleTitle: string | null;
  periodLabel: string | null;
  situation: string;
  task: string;
  action: string;
  result: string;
  metrics: readonly StoryMetric[];
  themes: readonly string[];
  /** What the candidate does not want rounded up or overstated. */
  guardrails: string | null;
}>;

export type StoryDisposition = "PROPOSED" | "APPROVED" | "REJECTED";
export type StoryUsagePolicy = "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY" | "DO_NOT_USE";

export type CandidateStoryView = Readonly<{
  storyId: string;
  storyVersionId: string;
  aggregateVersion: number;
  versionNumber: number;
  status: "ACTIVE" | "ARCHIVED";
  disposition: StoryDisposition;
  usagePolicy: StoryUsagePolicy;
  sourceKind: "INTERVIEW" | "CANDIDATE_ENTRY";
  draft: StoryDraft;
  storyText: string;
  storySha256: string;
  updatedAt: string;
}>;

export class StoryValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "StoryValidationError";
    this.field = field;
  }
}

function clean(value: unknown, field: string, max: number, required: boolean): string | null {
  if (typeof value !== "string" || !value.trim()) {
    if (required) throw new StoryValidationError(field, "This part of the story is required.");
    return null;
  }
  const normalized = value.replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
  if (normalized.length > max) throw new StoryValidationError(field, `Keep this under ${max} characters.`);
  return normalized;
}

export function parseStoryDraft(value: unknown): StoryDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoryValidationError("story", "Story is invalid.");
  const record = value as Record<string, unknown>;
  const metricsInput = Array.isArray(record.metrics) ? record.metrics.slice(0, 12) : [];
  const metrics: StoryMetric[] = [];
  for (const [index, entry] of metricsInput.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const metric = entry as Record<string, unknown>;
    const metricValue = clean(metric.value, `metrics[${index}].value`, 80, false);
    const label = clean(metric.label, `metrics[${index}].label`, 120, false);
    if (!metricValue || !label) continue;
    metrics.push(Object.freeze({
      value: metricValue,
      label,
      confidence: metric.confidence === "STATED" ? "STATED" : "ESTIMATED",
    }));
  }
  const themes = (Array.isArray(record.themes) ? record.themes : [])
    .filter((theme): theme is string => typeof theme === "string" && Boolean(theme.trim()))
    .map((theme) => theme.trim().toLocaleLowerCase("en-US").slice(0, 40))
    .filter((theme, index, all) => all.indexOf(theme) === index)
    .slice(0, 8);
  const positionKey = typeof record.positionKey === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(record.positionKey.trim())
    ? record.positionKey.trim() : null;
  return Object.freeze({
    title: clean(record.title, "title", 140, true)!,
    positionKey,
    organization: clean(record.organization, "organization", 160, false),
    roleTitle: clean(record.roleTitle, "roleTitle", 160, false),
    periodLabel: clean(record.periodLabel, "periodLabel", 60, false),
    situation: clean(record.situation, "situation", 1500, true)!,
    task: clean(record.task, "task", 1000, true)!,
    action: clean(record.action, "action", 2500, true)!,
    result: clean(record.result, "result", 1500, true)!,
    metrics: Object.freeze(metrics),
    themes: Object.freeze(themes),
    guardrails: clean(record.guardrails, "guardrails", 800, false),
  });
}

/**
 * The canonical evidence text for a story. Drafting cites this text and the
 * independent checker verifies generated prose against it, so every material
 * detail the documents may use must appear here in the candidate's terms.
 */
export function renderStoryText(draft: StoryDraft): string {
  const where = [draft.roleTitle, draft.organization].filter(Boolean).join(" at ");
  const lines = [
    `Story: ${draft.title}`,
    ...(where ? [`Role: ${where}${draft.periodLabel ? ` (${draft.periodLabel})` : ""}`] : []),
    `Situation: ${draft.situation}`,
    `Task: ${draft.task}`,
    `Action: ${draft.action}`,
    `Result: ${draft.result}`,
  ];
  if (draft.metrics.length > 0) {
    lines.push(`Metrics: ${draft.metrics.map((metric) => `${metric.value} ${metric.label} (${metric.confidence === "STATED" ? "stated by the candidate" : "the candidate's estimate; say about/roughly"})`).join("; ")}`);
  }
  if (draft.guardrails) lines.push(`Do not overstate: ${draft.guardrails}`);
  return lines.join("\n");
}

/** Two-line readback the candidate confirms before a story enters the bank. */
export function storyReadback(draft: StoryDraft): string {
  const where = [draft.roleTitle, draft.organization].filter(Boolean).join(", ");
  const firstSentence = (value: string) => (value.split(/(?<=[.!?])\s/u)[0] ?? value).replace(/\.$/u, "");
  const numbers = draft.metrics.slice(0, 3).map((metric) => metric.value).join(" · ");
  return [
    `${draft.title}${where ? ` (${where})` : ""}`,
    `${firstSentence(draft.result)}${numbers ? ` — ${numbers}` : ""}.`,
  ].join("\n");
}
