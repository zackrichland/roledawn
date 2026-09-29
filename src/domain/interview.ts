import { parseStoryDraft, type StoryDraft } from "./candidate-stories.ts";

export const INTERVIEWER_RELEASE = "roledawn-interviewer/1";

export const INTERVIEW_STAGES = ["ROLE", "GAP", "VOICE", "WRAPUP"] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

export type InterviewState = Readonly<{
  focusPositionKey: string | null;
  stage: InterviewStage;
  coveredPositionKeys: readonly string[];
  /** The interviewer's private scratchpad; never shown to employers. */
  notes: string;
}>;

export type InterviewTurn = Readonly<{
  sequenceNumber: number;
  speaker: "INTERVIEWER" | "CANDIDATE";
  content: string;
  createdAt: string;
}>;

export type InterviewVoiceDraft = Readonly<{
  selfDescription: string | null;
  toneNotes: string | null;
  preferredPhrases: readonly string[];
  avoidPhrases: readonly string[];
  signOff: string | null;
}>;

export type InterviewerOutput = Readonly<{
  reply: string;
  state: InterviewState;
  storyDraft: StoryDraft | null;
  voiceDraft: InterviewVoiceDraft | null;
  complete: boolean;
}>;

export type InterviewPositionContext = Readonly<{
  positionKey: string;
  title: string;
  organization: string;
  dates: string | null;
  summary: string | null;
  highlights: readonly string[];
}>;

export type InterviewContext = Readonly<{
  candidateFirstName: string | null;
  positions: readonly InterviewPositionContext[];
  gaps: readonly string[];
  existingStories: readonly Readonly<{ title: string; positionKey: string | null; approved: boolean }>[];
  hasVoiceProfile: boolean;
  targetRoles: readonly string[];
}>;

export const INITIAL_INTERVIEW_STATE: InterviewState = Object.freeze({
  focusPositionKey: null,
  stage: "ROLE",
  coveredPositionKeys: Object.freeze([]),
  notes: "",
});

export function parseInterviewState(value: unknown): InterviewState {
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const stage = typeof record.stage === "string" && (INTERVIEW_STAGES as readonly string[]).includes(record.stage)
    ? record.stage as InterviewStage : "ROLE";
  const covered = Array.isArray(record.coveredPositionKeys)
    ? record.coveredPositionKeys.filter((key): key is string => typeof key === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(key)).slice(0, 30)
    : [];
  return Object.freeze({
    focusPositionKey: typeof record.focusPositionKey === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(record.focusPositionKey)
      ? record.focusPositionKey : null,
    stage,
    coveredPositionKeys: Object.freeze([...new Set(covered)]),
    notes: typeof record.notes === "string" ? record.notes.slice(0, 1500) : "",
  });
}

/** Deterministic first message, so starting an interview never waits on a model. */
export function openingInterviewMessage(context: InterviewContext): Readonly<{ message: string; state: InterviewState }> {
  const greeting = context.candidateFirstName ? `Hi ${context.candidateFirstName}.` : "Hi.";
  const first = context.positions[0];
  const intro = `${greeting} I'll ask about your work one role at a time to find the stories and numbers that make an application worth reading. Short answers are fine; I'll follow up. You can stop whenever you want and pick up later.`;
  if (!first) {
    return {
      message: `${intro}\n\nLet's start with your most recent job. What was the role, and what were you brought in to fix or build?`,
      state: INITIAL_INTERVIEW_STATE,
    };
  }
  return {
    message: `${intro}\n\nLet's start with ${first.title} at ${first.organization}. What were you brought in to fix or build, and what did things look like when you started?`,
    state: Object.freeze({ ...INITIAL_INTERVIEW_STATE, focusPositionKey: first.positionKey }),
  };
}

export const INTERVIEWER_INSTRUCTIONS = `You are RoleDawn's career interviewer. You turn a person's work history into a bank of true, specific stories that will later become résumé bullets and cover-letter proof. Sound like a sharp, friendly recruiter who has done real work: brisk, curious, plain-spoken. Not a form, not a therapist, not a cheerleader.

Method, one story at a time:
- Situation: where and when, what was broken or at stake, and the number before they arrived (volume, revenue, cycle time, headcount, error rate — whatever fits their field).
- Task: what they personally owned versus what the team owned.
- Action: three to five concrete moves. Ask what they did that an average person in that seat would not have done. That answer is usually the best bullet.
- Result: the number after. Then the second-order effect: promotion, renewal, referral, budget, what it unlocked.
- Guardrail: ask what they would not want rounded up or overstated.
Mine metrics that fit their field: quota and attainment, deal size, pipeline, close rate, cycle time, revenue, cost or time saved, users, volume, error rates, team size, budget, satisfaction, grades, patients, students, tickets. When they do not know an exact number, ask for a range or an honest estimate and treat it as an estimate.

Coverage:
- Work one role at a time, most recent first, using the career profile in context. Say which role you are on when you switch.
- Two or three stories for strong recent roles, one for older or less relevant ones. Aim for five to eight stories in total. Prefer stories that fit the candidate's target roles.
- Get one failure, conflict, or hard-call story somewhere in the interview.
- If the context lists a gap of more than six months, ask about it once, lightly, as optional.
- Skip stories already in the bank (listed in context).
- Near the end, capture voice: how they would describe what they do to a friend, and the words they hate seeing in AI-written applications. Put their answers in voiceDraft in their own words.

Rules:
- Ask at most two questions per message. Keep each message under 90 words. Plain text: no markdown, lists, headings, or emoji.
- Never suggest a number, title, employer, outcome, or motive. Never put words in their mouth. If an answer is vague, ask for a concrete example.
- Never merge two stories. Never compute or round numbers yourself.
- Produce storyDraft only when a single story has a clear situation, action, and result from this conversation. Use only facts the candidate stated. Keep their wording where you can. Each metric value must be copied from something they said; mark it STATED if they gave it directly and ESTIMATED if they said about, around, roughly, or gave a range.
- When you produce a storyDraft, your reply reads it back in two short lines and asks them to press Save on the story card or tell you what to fix. Then continue.
- If they correct a story, produce a corrected storyDraft for the same story.
- Do not ask for protected personal information (age, health, religion, family status, ethnicity, immigration status).
- If they want to stop, thank them briefly, tell them their saved stories are already in use, and set complete to true.
- Update state: focusPositionKey is the role you are on (a positionKey from context or null), coveredPositionKeys lists roles you have finished, stage is ROLE, GAP, VOICE, or WRAPUP, and notes is a short private scratchpad of what you still want to learn.`;

const NULLABLE_STRING = { type: ["string", "null"] } as const;

export const INTERVIEWER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "state", "storyDraft", "voiceDraft", "complete"],
  properties: {
    reply: { type: "string", minLength: 1, maxLength: 1200 },
    state: {
      type: "object",
      additionalProperties: false,
      required: ["focusPositionKey", "stage", "coveredPositionKeys", "notes"],
      properties: {
        focusPositionKey: NULLABLE_STRING,
        stage: { type: "string", enum: [...INTERVIEW_STAGES] },
        coveredPositionKeys: { type: "array", items: { type: "string" }, maxItems: 30 },
        notes: { type: "string", maxLength: 1500 },
      },
    },
    storyDraft: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["title", "positionKey", "organization", "roleTitle", "periodLabel", "situation", "task", "action", "result", "metrics", "themes", "guardrails"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 140 },
            positionKey: NULLABLE_STRING,
            organization: NULLABLE_STRING,
            roleTitle: NULLABLE_STRING,
            periodLabel: NULLABLE_STRING,
            situation: { type: "string", minLength: 1, maxLength: 1500 },
            task: { type: "string", minLength: 1, maxLength: 1000 },
            action: { type: "string", minLength: 1, maxLength: 2500 },
            result: { type: "string", minLength: 1, maxLength: 1500 },
            metrics: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["value", "label", "confidence"],
                properties: {
                  value: { type: "string", minLength: 1, maxLength: 80 },
                  label: { type: "string", minLength: 1, maxLength: 120 },
                  confidence: { type: "string", enum: ["STATED", "ESTIMATED"] },
                },
              },
            },
            themes: { type: "array", maxItems: 6, items: { type: "string", maxLength: 40 } },
            guardrails: NULLABLE_STRING,
          },
        },
      ],
    },
    voiceDraft: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["selfDescription", "toneNotes", "preferredPhrases", "avoidPhrases", "signOff"],
          properties: {
            selfDescription: NULLABLE_STRING,
            toneNotes: NULLABLE_STRING,
            preferredPhrases: { type: "array", maxItems: 20, items: { type: "string", maxLength: 60 } },
            avoidPhrases: { type: "array", maxItems: 30, items: { type: "string", maxLength: 60 } },
            signOff: NULLABLE_STRING,
          },
        },
      ],
    },
    complete: { type: "boolean" },
  },
} as const;

function numberTokens(value: string): string[] {
  return (value.match(/\d+(?:[.,]\d+)*/gu) ?? []).map((token) => token.replace(/,/gu, ""));
}

/**
 * A story metric survives only when every number in it appears in the
 * candidate's own words. Word-only metrics ("half", "doubled") must appear
 * verbatim. The model never gets to introduce a figure.
 */
export function groundStoryDraft(draft: StoryDraft, candidateWords: string): StoryDraft {
  const said = candidateWords.toLocaleLowerCase("en-US");
  const saidNumbers = new Set(numberTokens(said));
  const metrics = draft.metrics.filter((metric) => {
    const numbers = numberTokens(metric.value);
    if (numbers.length > 0) return numbers.every((token) => saidNumbers.has(token));
    return said.includes(metric.value.toLocaleLowerCase("en-US"));
  });
  return Object.freeze({ ...draft, metrics: Object.freeze(metrics) });
}

export function parseInterviewerOutput(value: unknown, knownPositionKeys: ReadonlySet<string>): InterviewerOutput {
  if (!value || typeof value !== "object") throw new Error("INTERVIEWER_OUTPUT_INVALID");
  const record = value as Record<string, unknown>;
  const reply = typeof record.reply === "string" ? record.reply.replace(/\*\*|__|^#+\s*/gmu, "").trim() : "";
  if (!reply) throw new Error("INTERVIEWER_OUTPUT_INVALID");
  const state = parseInterviewState(record.state);
  const focus = state.focusPositionKey && knownPositionKeys.has(state.focusPositionKey) ? state.focusPositionKey : null;
  let storyDraft: StoryDraft | null = null;
  if (record.storyDraft && typeof record.storyDraft === "object") {
    try {
      const parsed = parseStoryDraft(record.storyDraft);
      storyDraft = Object.freeze({
        ...parsed,
        positionKey: parsed.positionKey && knownPositionKeys.has(parsed.positionKey) ? parsed.positionKey : null,
      });
    } catch {
      storyDraft = null;
    }
  }
  let voiceDraft: InterviewVoiceDraft | null = null;
  if (record.voiceDraft && typeof record.voiceDraft === "object") {
    const voice = record.voiceDraft as Record<string, unknown>;
    const list = (items: unknown) => (Array.isArray(items) ? items : [])
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim().slice(0, 60)).slice(0, 30);
    const textOrNull = (item: unknown, max: number) => typeof item === "string" && item.trim() ? item.trim().slice(0, max) : null;
    voiceDraft = Object.freeze({
      selfDescription: textOrNull(voice.selfDescription, 1200),
      toneNotes: textOrNull(voice.toneNotes, 600),
      preferredPhrases: Object.freeze(list(voice.preferredPhrases)),
      avoidPhrases: Object.freeze(list(voice.avoidPhrases)),
      signOff: textOrNull(voice.signOff, 40),
    });
  }
  return Object.freeze({
    reply: reply.slice(0, 1200),
    state: Object.freeze({
      ...state,
      focusPositionKey: focus,
      coveredPositionKeys: Object.freeze(state.coveredPositionKeys.filter((key) => knownPositionKeys.has(key))),
    }),
    storyDraft,
    voiceDraft,
    complete: record.complete === true,
  });
}

/** Compact, bounded context for one interviewer turn. */
export function interviewerInput(input: Readonly<{
  context: InterviewContext;
  state: InterviewState;
  turns: readonly InterviewTurn[];
  latestMessage: string;
}>): string {
  const recent = input.turns.slice(-16).map((turn) => `${turn.speaker === "CANDIDATE" ? "Candidate" : "You"}: ${turn.content}`);
  return JSON.stringify({
    candidateFirstName: input.context.candidateFirstName,
    targetRoles: input.context.targetRoles,
    careerProfile: input.context.positions.map((position) => ({
      positionKey: position.positionKey,
      role: `${position.title} at ${position.organization}`,
      dates: position.dates,
      scope: position.summary,
      resumeBullets: position.highlights.slice(0, 4),
    })),
    gaps: input.context.gaps,
    storiesAlreadyInBank: input.context.existingStories.map((story) => ({ title: story.title, positionKey: story.positionKey })),
    voiceAlreadyCaptured: input.context.hasVoiceProfile,
    state: input.state,
    recentTranscript: recent,
    candidateJustSaid: input.latestMessage,
  });
}
