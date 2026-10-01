import type { ApplicationAutopilotStatus } from "./application-autopilot.ts";

/**
 * One place that says, for every way an application can stop or need the
 * candidate: what happened in plain words, what happens next or what would
 * change the outcome, and the actions on offer. Internal codes never appear in
 * this copy; the UI shows them only inside an expandable "Details".
 *
 * Copy rules: no blame, no engineering or browser talk, and nothing is called
 * sent, applied or received unless the employer confirmed it. A stop that ends
 * as FAILED_SAFE never had a submit attempt (the database turns a failed run
 * with an attempt into UNCERTAIN), so "it wasn't submitted" is a true statement
 * there. An unknown outcome is reconciled before anything is sent again (D-111).
 */

export type GuidanceTone = "working" | "attention" | "ready" | "done" | "neutral" | "error";

/**
 * How a stop can be retried.
 * - NOT_STOPPED: nothing is wrong; the work is running or waiting on the candidate's input.
 * - AUTOMATIC: RoleDawn retries by itself, on a fixed schedule with a cap (D-114).
 * - MANUAL: pressing Try again can help, because the cause is temporary or the form may differ next time.
 * - AFTER_CHANGE: the same input gives the same result; something must change first.
 * - NEVER: the outcome is unknown; RoleDawn reconciles it and nothing is sent again until then.
 */
export type RetryClass = "NOT_STOPPED" | "AUTOMATIC" | "MANUAL" | "AFTER_CHANGE" | "NEVER";

export type StopActionKind =
  | "ANSWER" | "CODE" | "VERIFY_BROWSER" | "TRY_AGAIN" | "RESUME" | "PAUSE"
  | "EMPLOYER_PAGE" | "REFRESH_FILES" | "OPEN_PROFILE" | "OPEN_APPLICATION" | "NONE";
export type StopAction = Readonly<{
  kind: StopActionKind; label: string; href?: string;
  /** Button text for the Home row, when the default for this kind doesn't fit. */
  short?: string;
}>;

export type StopGuidance = Readonly<{
  /** Short state name for the Home row and the status line. */
  label: string;
  /** Heading of the card that carries the actions. */
  heading: string;
  /** What happened, in plain words. */
  happened: string;
  /** What happens next, or what would change the outcome. */
  next: string;
  tone: GuidanceTone;
  needsYou: boolean;
  closed: boolean;
  /** Index into the five-step status rail. */
  step: number;
  retry: RetryClass;
  /** Exactly one. NONE means there is nothing for the candidate to press. */
  primary: StopAction;
  /** At most one. */
  secondary: StopAction | null;
  /** The send can still be canceled from here; a quiet exit beside the actions, not one of them. */
  canCancel: boolean;
  /** The internal code, for the expandable details only. */
  code: string | null;
}>;

const NONE: StopAction = Object.freeze({ kind: "NONE", label: "" });
const action = (kind: StopActionKind, label: string, href?: string, short?: string): StopAction =>
  Object.freeze({ kind, label, ...(href ? { href } : {}), ...(short ? { short } : {}) });
const TRY_AGAIN = action("TRY_AGAIN", "Try again");
const EMPLOYER = action("OPEN_APPLICATION", "View application");
const EMPLOYER_APPLY = action("OPEN_APPLICATION", "View application");
const PAUSE = action("PAUSE", "Pause");

function guide(input: Omit<StopGuidance, "code" | "closed" | "secondary" | "needsYou" | "step" | "canCancel"> & Partial<Pick<StopGuidance, "code" | "closed" | "secondary" | "needsYou" | "step" | "canCancel">>): StopGuidance {
  return Object.freeze({ code: null, closed: false, secondary: null, needsYou: false, step: 3, canCancel: false, ...input });
}

// ---------------------------------------------------------------------------
// Delivery stops (the send)
// ---------------------------------------------------------------------------

/**
 * Stops that happen before any submission because a provider hiccup caused
 * them. The database runs the send again by itself, at most twice, 1 and then 5
 * minutes later (D-114). Keep this list identical to `finish_application_autopilot`;
 * a test compares the two.
 */
export const AUTOMATIC_RETRY_CODES: ReadonlySet<string> = new Set([
  "OPENAI_AGENTS_ABORTED", "OPENAI_AGENTS_NETWORK_ERROR", "OPENAI_AGENTS_HTTP_ERROR", "AGENTS_FILL_CANCELLED",
  "DELIVERY_BROWSER_CONCURRENCY_LIMIT", "APPLICATION_DELIVERY_FAILED",
]);
export const AUTOMATIC_RETRY_LIMIT = 2;
/** RoleDawn keeps reconciling an unknown outcome this many times, then waits (claim_application_autopilot). */
export const RECONCILE_LIMIT = 3;

export type DeliveryStopGroup =
  | "TEMPORARY" | "SERVICE_CREDITS" | "CAPACITY" | "UNSUPPORTED_SITE" | "HUMAN_CHECK" | "FORM_REJECTED" | "SIGN_IN" | "UNSUPPORTED_FIELD"
  | "ANSWER_REJECTED" | "CODE_NOT_ACCEPTED" | "FORM_CHECK" | "UNKNOWN";

const SITE_UNSUPPORTED = new Set(["DELIVERY_SITE_UNSUPPORTED", "APPLICATION_AUTOPILOT_DESTINATION_UNSUPPORTED"]);
const PROVIDER_FAMILY = /^(?:OPENAI_AGENTS_|BROWSERBASE_|DELIVERY_RUNTIME_|DELIVERY_BROWSER_|DELIVERY_AGENT_)/u;
const OUR_FAMILY = /^(?:DELIVERY_|AGENTS_|APPLICATION_FILL_)/u;

/** Which kind of stop a failure code is. Unknown codes are UNKNOWN, never a guess at a cause. */
export function deliveryStopGroup(code: string | null | undefined): DeliveryStopGroup {
  if (!code) return "UNKNOWN";
  if (AUTOMATIC_RETRY_CODES.has(code)) return "TEMPORARY";
  if (code === "MODEL_CREDITS_EXHAUSTED") return "SERVICE_CREDITS";
  if (code === "MODEL_RATE_LIMITED") return "TEMPORARY";
  if (code === "DELIVERY_BROWSER_QUOTA_EXHAUSTED") return "CAPACITY";
  if (SITE_UNSUPPORTED.has(code)) return "UNSUPPORTED_SITE";
  if (code === "APPLICATION_FILL_CAPTCHA_TAKEOVER" || code === "DELIVERY_BROWSER_VERIFICATION_TIMEOUT") return "HUMAN_CHECK";
  if (code === "DELIVERY_FORM_VALIDATION_OR_CAPTCHA") return "FORM_REJECTED";
  if (code === "APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER" || code === "APPLICATION_FILL_OTP_MFA_TAKEOVER") return "SIGN_IN";
  if (code === "DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM") return "ANSWER_REJECTED";
  if (code === "DELIVERY_EMAIL_VERIFICATION_TIMEOUT" || code === "DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED") return "CODE_NOT_ACCEPTED";
  // A model or browser-provider problem is temporary even when its name says "unsupported".
  if (PROVIDER_FAMILY.test(code)) return "TEMPORARY";
  if (/_TAKEOVER$/u.test(code) || /_UNSUPPORTED(?:_[A-Z]+)*$/u.test(code)
    || /^DELIVERY_(?:STEP_LIMIT|STEP_AMBIGUOUS|PRIOR_STEP_REVIEW_REQUIRED|SUBMIT_POLICY_REQUIRED|NAVIGATION_[A-Z_]+|POLICY_[A-Z_]+)$/u.test(code)) return "UNSUPPORTED_FIELD";
  if (OUR_FAMILY.test(code)) return "FORM_CHECK";
  return "UNKNOWN";
}

/** How a stop that ended the send (FAILED_SAFE) can be retried. */
export function deliveryStopRetryClass(code: string | null | undefined): RetryClass {
  switch (deliveryStopGroup(code)) {
    case "TEMPORARY": case "HUMAN_CHECK": case "CODE_NOT_ACCEPTED": case "FORM_CHECK": case "UNKNOWN": return "MANUAL";
    default: return "AFTER_CHANGE";
  }
}

type GroupCopy = Readonly<{
  label: string; heading: string; happened: string; next: string;
  tone: GuidanceTone; primary: StopAction; secondary: StopAction | null; retry: RetryClass;
}>;
const LATER = "It wasn’t submitted. Your documents and the stop details stay here while this form needs repair.";
const GROUP_COPY: Readonly<Record<DeliveryStopGroup, GroupCopy>> = {
  TEMPORARY: {
    label: "Stopped", heading: "Stopped after a temporary problem",
    happened: "A temporary problem on RoleDawn’s side interrupted the form, and it wasn’t submitted.",
    next: "Try again in a few minutes. Your application and documents stay here.",
    tone: "error", primary: TRY_AGAIN, secondary: EMPLOYER_APPLY, retry: "MANUAL",
  },
  SERVICE_CREDITS: {
    label: "Stopped", heading: "The application service needs credits",
    happened: "RoleDawn's AI account ran out of credits before this application was submitted.",
    next: "Add credits to the configured AI account, then try again.",
    tone: "error", primary: TRY_AGAIN, secondary: null, retry: "AFTER_CHANGE",
  },
  CAPACITY: {
    label: "Couldn’t start", heading: "Couldn’t start",
    happened: "RoleDawn has used up its form-filling time for now, so it couldn’t start. It wasn’t submitted.",
    next: "RoleDawn needs more form-filling capacity before it can continue. Your application stays here.",
    tone: "attention", primary: EMPLOYER_APPLY, secondary: TRY_AGAIN, retry: "AFTER_CHANGE",
  },
  UNSUPPORTED_SITE: {
    label: "Stopped", heading: "This form needs help",
    happened: "RoleDawn can’t fill in this employer’s application form yet.",
    next: "This site needs a delivery adapter before RoleDawn can complete the application here. Your documents are saved.",
    tone: "attention", primary: EMPLOYER, secondary: null, retry: "AFTER_CHANGE",
  },
  HUMAN_CHECK: {
    label: "Verification needed", heading: "Verify here",
    happened: "The employer asked for a human verification check before submission.",
    next: "Reopen verification. RoleDawn prepares the form again and shows the check here when it appears.",
    tone: "attention", primary: action("TRY_AGAIN", "Reopen verification", undefined, "Verify here"), secondary: null, retry: "MANUAL",
  },
  FORM_REJECTED: {
    label: "Stopped", heading: "This form needs help",
    happened: "The employer’s form asked for a correction or a human check before it would go on.",
    next: LATER, tone: "attention", primary: EMPLOYER, secondary: null, retry: "AFTER_CHANGE",
  },
  SIGN_IN: {
    label: "Stopped", heading: "This form needs help",
    happened: "This employer wants you to sign in or create an account before you apply, which RoleDawn can’t do for you yet.",
    next: LATER, tone: "attention", primary: EMPLOYER, secondary: null, retry: "AFTER_CHANGE",
  },
  UNSUPPORTED_FIELD: {
    label: "Stopped", heading: "This form needs help",
    happened: "This form has a step or field RoleDawn can’t fill in yet.",
    next: LATER, tone: "attention", primary: EMPLOYER, secondary: null, retry: "AFTER_CHANGE",
  },
  ANSWER_REJECTED: {
    label: "Stopped", heading: "This form needs help",
    happened: "The employer’s form wouldn’t accept one of the answers.",
    next: "It wasn’t submitted. The answer needs correction before RoleDawn can continue here.",
    tone: "attention", primary: EMPLOYER, secondary: null, retry: "AFTER_CHANGE",
  },
  CODE_NOT_ACCEPTED: {
    label: "Stopped", heading: "The employer hasn’t accepted it",
    happened: "The employer’s emailed verification step didn’t finish, so it hasn’t accepted this application.",
    next: "Nothing is pending. Try again and RoleDawn asks for a fresh code.",
    tone: "error", primary: TRY_AGAIN, secondary: EMPLOYER_APPLY, retry: "MANUAL",
  },
  FORM_CHECK: {
    label: "Stopped", heading: "Stopped before sending",
    happened: "RoleDawn couldn’t verify the employer’s form before final submission, so it stopped.",
    next: "Try again here. Your documents and answers are saved.",
    tone: "error", primary: TRY_AGAIN, secondary: EMPLOYER_APPLY, retry: "MANUAL",
  },
  UNKNOWN: {
    label: "Stopped", heading: "Stopped before sending",
    happened: "Something unexpected stopped RoleDawn before it could submit this application.",
    next: "Try again here. The stop details and your documents are saved.",
    tone: "error", primary: TRY_AGAIN, secondary: EMPLOYER_APPLY, retry: "MANUAL",
  },
};
const DRAFT_NOTE = " The employer’s form may keep a saved draft of what RoleDawn filled in.";

export type SendGuidanceInput = Readonly<{
  status: ApplicationAutopilotStatus;
  failureCode?: string | null;
  /** Automatic retries the database has already used (D-114). */
  transientRetries?: number;
  /** Times the unknown outcome has been reconciled. */
  reconcileCount?: number;
  /** The send request is past its 7-day life; the database refuses Try again. */
  expired?: boolean;
  /** The candidate's profile changed after these files were written; Try again is refused until they are rewritten. */
  profileChanged?: boolean;
  /** Ashby saves approved fields as a draft before submission (D-123). */
  provider?: "GREENHOUSE" | "LEVER" | "ASHBY" | null;
  questionCount?: number;
  /** Present when the employer emailed a code that RoleDawn hasn't received yet. */
  verificationRecipient?: string | null;
  verificationRetry?: boolean;
  browserVerification?: boolean;
}>;

function failedSend(input: SendGuidanceInput): StopGuidance {
  const code = input.failureCode ?? null;
  const group = deliveryStopGroup(code);
  const copy = GROUP_COPY[group];
  const draft = input.provider === "ASHBY" ? DRAFT_NOTE : "";
  const already = AUTOMATIC_RETRY_CODES.has(code ?? "") && (input.transientRetries ?? 0) >= AUTOMATIC_RETRY_LIMIT;
  const happened = `${copy.happened}${already ? " RoleDawn already tried again on its own." : ""}${draft}`;
  const offersTryAgain = copy.primary.kind === "TRY_AGAIN" || copy.secondary?.kind === "TRY_AGAIN";
  // The database refuses Try again for an expired send request or files older than the profile.
  const refused = offersTryAgain && (input.expired || input.profileChanged);
  if (refused && input.expired) {
    return guide({ label: copy.label, heading: copy.heading, happened, tone: copy.tone, needsYou: true, retry: "AFTER_CHANGE", code,
      next: "This send request expired after 7 days, so it can’t run again. Open the application to review its saved documents.", primary: EMPLOYER_APPLY });
  }
  if (refused) {
    return guide({ label: copy.label, heading: copy.heading, happened, tone: copy.tone, needsYou: true, retry: "AFTER_CHANGE", code,
      next: "Your profile changed after these files were written, so RoleDawn has to rewrite them before it can try again.",
      primary: action("REFRESH_FILES", "Rewrite documents"), secondary: EMPLOYER_APPLY });
  }
  return guide({ label: copy.label, heading: copy.heading, happened, next: copy.next, tone: copy.tone, needsYou: true, retry: copy.retry, primary: copy.primary, secondary: copy.secondary, code });
}

/** What the candidate sees for an application's send, in every state it can be in. */
export function guideSend(input: SendGuidanceInput): StopGuidance {
  if (input.status === "RUNNING" && input.browserVerification) return guide({
    label: "Verification needed", heading: "Verify here",
    happened: "The employer needs a human verification check before RoleDawn can finish.",
    next: "Complete the check below. RoleDawn continues in the same form and waits for the employer’s confirmation.",
    tone: "attention", needsYou: true, retry: "NOT_STOPPED", primary: action("VERIFY_BROWSER", "Open verification", undefined, "Verify here"), secondary: PAUSE, canCancel: true,
  });
  const code = input.failureCode ?? null;
  switch (input.status) {
    case "QUEUED":
    case "RUNNING": {
      const retries = input.transientRetries ?? 0;
      if (retries > 0) {
        return guide({
          label: "Trying again", heading: "Trying again",
          happened: `A temporary problem interrupted the last try, so RoleDawn is trying again by itself (try ${Math.min(retries + 1, AUTOMATIC_RETRY_LIMIT + 1)} of ${AUTOMATIC_RETRY_LIMIT + 1}). It wasn’t submitted.`,
          next: "Nothing to do. If it keeps failing, it stops and tells you exactly what to do.",
          tone: "working", retry: "AUTOMATIC", primary: NONE, secondary: PAUSE, canCancel: true,
        });
      }
      return input.status === "QUEUED"
        ? guide({ label: "Queued to apply", heading: "Queued to apply", happened: "RoleDawn will start the employer’s form in a moment.",
          next: "Nothing to do. You can pause or cancel before it starts sending.", tone: "working", retry: "NOT_STOPPED", primary: NONE, secondary: PAUSE, canCancel: true })
        : guide({ label: "Applying", heading: "Applying", happened: "RoleDawn is filling in the employer’s form with your documents and saved answers.",
          next: "Nothing to do. Anything it can’t answer from your profile is asked here.", tone: "working", retry: "NOT_STOPPED", primary: NONE, secondary: PAUSE, canCancel: true });
    }
    case "WAITING_ANSWERS": {
      const count = input.questionCount ?? 0;
      return guide({
        label: count ? `Answer ${count} question${count === 1 ? "" : "s"}` : "Answer questions", heading: "A few questions for you",
        happened: "The employer’s form asked something only you can answer.",
        next: "Type your answers and send them. RoleDawn continues right away.",
        tone: "attention", needsYou: true, retry: "NOT_STOPPED", primary: action("ANSWER", "Send answers"), canCancel: true,
      });
    }
    case "SUBMITTING": {
      if (input.verificationRecipient) {
        return guide({
          label: "Enter code", heading: "Enter the code from your email",
          happened: input.verificationRetry
            ? "That code didn’t work, so the employer sent a new one. Enter the newest code from your inbox."
            : `The employer emailed a verification code to ${input.verificationRecipient}.`,
          next: "Type it here and RoleDawn finishes sending. If your inbox is connected, RoleDawn may find it first.",
          tone: "attention", needsYou: true, retry: "NOT_STOPPED", primary: action("CODE", "Send code"),
        });
      }
      return guide({
        label: "Sending", heading: "Sending",
        happened: "RoleDawn is submitting the application and waiting for the employer’s own confirmation.",
        next: "Nothing to do. It counts as applied only once the employer confirms.",
        tone: "working", retry: "NOT_STOPPED", primary: NONE,
      });
    }
    case "PAUSED":
      return guide({
        label: "Paused", heading: "Paused", happened: "Nothing is being sent while this is paused.",
        next: "Resume when you’re ready and RoleDawn starts the form again.",
        tone: "attention", needsYou: true, retry: "NOT_STOPPED", primary: action("RESUME", "Resume"), canCancel: true,
      });
    case "UNCERTAIN":
    case "RECONCILING": {
      if (input.status === "UNCERTAIN" && (input.reconcileCount ?? 0) >= RECONCILE_LIMIT) {
        return guide({
          label: "Not confirmed yet", heading: "Not confirmed yet",
          happened: "RoleDawn tried to send this application, but the employer’s own confirmation hasn’t been found.",
          next: "RoleDawn won’t send it again by itself, so the employer doesn’t get two. Look for a confirmation email from the employer before applying again by hand.",
          tone: "attention", retry: "NEVER", primary: NONE, code,
        });
      }
      return guide({
        label: "Confirming", heading: "Checking the outcome",
        happened: "RoleDawn tried to send this application, but the employer’s response wasn’t clear, so it isn’t confirmed yet.",
        next: "RoleDawn is checking with the employer. Don’t apply again by hand meanwhile, or the employer could get two.",
        tone: "working", retry: "NEVER", primary: NONE, code,
      });
    }
    case "CONFIRMED":
      return guide({
        label: "Applied", heading: "Applied", happened: "The employer confirmed your application.", next: "Nothing more to do.",
        tone: "done", closed: true, step: 4, retry: "NOT_STOPPED", primary: NONE,
      });
    case "CANCELED":
      return guide({
        label: "Canceled", heading: "Application canceled", happened: "You canceled this application before it was submitted.",
        next: "Nothing more will happen.", tone: "neutral", closed: true, step: 0, retry: "NOT_STOPPED", primary: NONE,
      });
    case "FAILED_SAFE":
      return failedSend(input);
  }
}

// ---------------------------------------------------------------------------
// Reading the job
// ---------------------------------------------------------------------------

export type IntakeFailureKind = "UNSUPPORTED_BOARD" | "NOT_A_JOB_LINK" | "POSTING_CLOSED" | "TOO_LARGE" | "INCOMPLETE" | "DUPLICATE" | "TEMPORARY" | "UNKNOWN";
export function intakeFailureKind(code: string | null | undefined): IntakeFailureKind {
  switch (code) {
    case "DUPLICATE_APPLICATION": return "DUPLICATE";
    case "ATS_UNSUPPORTED": return "UNSUPPORTED_BOARD";
    case "JOB_URL_SHAPE_UNSUPPORTED": return "NOT_A_JOB_LINK";
    case "JOB_NOT_FOUND": return "POSTING_CLOSED";
    case "BODY_TOO_LARGE": return "TOO_LARGE";
    case "PAYLOAD_INVALID": return "INCOMPLETE";
    case "FETCH_FAILED": case "HTTP_ERROR": case "JSON_INVALID": return "TEMPORARY";
    default: return "UNKNOWN";
  }
}

/** Reading the job again only helps when the failure was a bad moment, never when the posting itself is the problem. */
export function intakeRetryClass(code: string | null | undefined): RetryClass {
  const kind = intakeFailureKind(code);
  return kind === "TEMPORARY" || kind === "UNKNOWN" ? "MANUAL" : "AFTER_CHANGE";
}

export function guideIntakeFailure(code: string | null | undefined): StopGuidance {
  const kind = intakeFailureKind(code);
  const shared = { step: 0, code: code ?? null } as const;
  switch (kind) {
    case "UNSUPPORTED_BOARD":
      return guide({ ...shared, label: "Not supported", heading: "This job board isn’t supported", happened: "This link is from a job board RoleDawn can’t apply on yet.",
        next: "RoleDawn supports Greenhouse, Lever and Ashby. This site needs an adapter before it can apply here; nothing was submitted.", tone: "neutral", closed: true,
        retry: "AFTER_CHANGE", primary: action("EMPLOYER_PAGE", "Open the posting", undefined, "Open posting") });
    case "DUPLICATE":
      return guide({ ...shared, label: "Already added", heading: "You already have this job", happened: "This posting is already in your applications under another link.",
        next: "Use that application on Home. Nothing new was started and nothing was submitted.", tone: "neutral", closed: true, retry: "AFTER_CHANGE", primary: NONE });
    case "NOT_A_JOB_LINK":
      return guide({ ...shared, label: "Not a job link", heading: "That isn’t one job posting", happened: "That link doesn’t point to a single public job posting.",
        next: "Paste the link to the job’s own page. Nothing was submitted.", tone: "neutral", closed: true, retry: "AFTER_CHANGE", primary: NONE });
    case "POSTING_CLOSED":
      return guide({ ...shared, label: "Posting closed", heading: "The posting is gone", happened: "The employer took this posting down.",
        next: "There’s nothing to send. If it reopens, paste the link again.", tone: "neutral", closed: true, retry: "AFTER_CHANGE", primary: NONE });
    case "TOO_LARGE":
      return guide({ ...shared, label: "Couldn’t read job", heading: "Couldn’t read this posting", happened: "The posting was too large for RoleDawn to read safely.",
        next: "Nothing was submitted. The posting needs repair before RoleDawn can read it.", tone: "neutral", needsYou: true, retry: "AFTER_CHANGE", primary: action("EMPLOYER_PAGE", "Open the posting", undefined, "Open posting") });
    case "INCOMPLETE":
      return guide({ ...shared, label: "Couldn’t read job", heading: "Couldn’t read this posting", happened: "The job board’s record for this posting was incomplete.",
        next: "That usually clears when the employer fixes the posting. Nothing was submitted.", tone: "neutral", needsYou: true,
        retry: "AFTER_CHANGE", primary: action("EMPLOYER_PAGE", "Open the posting", undefined, "Open posting") });
    case "TEMPORARY":
    case "UNKNOWN":
      return guide({ ...shared, label: "Couldn’t read job", heading: "Couldn’t read this posting",
        happened: kind === "TEMPORARY" ? "RoleDawn couldn’t get a clean copy of the posting from the job board just now." : "The posting couldn’t be imported.",
        next: "Nothing was submitted. Try again, or open the posting yourself.", tone: "error", needsYou: true, retry: "MANUAL",
        primary: TRY_AGAIN, secondary: action("EMPLOYER_PAGE", "Open the posting", undefined, "Open posting") });
  }
}

// ---------------------------------------------------------------------------
// Writing the documents
// ---------------------------------------------------------------------------

export type WritingFailureKind = "PROFILE_MISSING" | "LETTER_UNVERIFIED" | "NAME_REQUIRED" | "WRITING_CHECK" | "SERVICE_BUSY" | "SERVICE_CREDITS" | "UNKNOWN";
export function writingFailureKind(code: string | null | undefined): WritingFailureKind {
  if (!code) return "UNKNOWN";
  if (code === "DRAFTING_CAREER_PROFILE_MISSING") return "PROFILE_MISSING";
  if (code === "LETTER_CLAIM_UNVERIFIED") return "LETTER_UNVERIFIED";
  if (code === "APPLICATION_KIT_NAME_REQUIRED") return "NAME_REQUIRED";
  if (code.startsWith("APPLICATION_WRITING") || code.startsWith("APPLICATION_DRAFTING")) return "WRITING_CHECK";
  if (code === "MODEL_CREDITS_EXHAUSTED") return "SERVICE_CREDITS";
  if (code.startsWith("OPENAI") || code.startsWith("MODEL_")) return "SERVICE_BUSY";
  return "UNKNOWN";
}
export function writingRetryClass(code: string | null | undefined): RetryClass {
  const kind = writingFailureKind(code);
  return kind === "PROFILE_MISSING" || kind === "LETTER_UNVERIFIED" || kind === "NAME_REQUIRED" || kind === "SERVICE_CREDITS" ? "AFTER_CHANGE" : "MANUAL";
}

export function guideWritingFailure(input: Readonly<{ code: string | null | undefined; profileChanged?: boolean }>): StopGuidance {
  const kind = writingFailureKind(input.code);
  const shared = { step: 1, code: input.code ?? null, needsYou: true } as const;
  const rewrite = action("REFRESH_FILES", "Rewrite documents");
  const heading = "Writing stopped before your documents were ready";
  // A profile edit made after the stop is what these need; the rewrite picks it up.
  const fixed = (base: StopGuidance): StopGuidance => input.profileChanged ? guide({ ...base, next: "You’ve updated your profile since. Rewrite the documents so RoleDawn writes from it.", primary: rewrite, secondary: null }) : base;
  switch (kind) {
    case "PROFILE_MISSING":
      return fixed(guide({ ...shared, label: "Writing stopped", heading, happened: "Your work history hasn’t been organized yet, so RoleDawn had nothing to write from.",
        next: "Nothing was sent. Check your experience in Profile; a new try starts once you’ve changed something.", tone: "attention", retry: "AFTER_CHANGE",
        primary: action("OPEN_PROFILE", "Open Profile", "/vault/experience") }));
    case "LETTER_UNVERIFIED":
      return fixed(guide({ ...shared, label: "Writing stopped", heading, happened: "RoleDawn couldn’t write a cover letter it could fully back up from your profile.",
        next: "Nothing was sent. Adding an interview story usually fixes this, and a new try starts once you’ve added one.", tone: "attention", retry: "AFTER_CHANGE",
        primary: action("OPEN_PROFILE", "Add a story", "/vault/stories") }));
    case "NAME_REQUIRED":
      return fixed(guide({ ...shared, label: "Writing stopped", heading, happened: "RoleDawn needs your legal name to write these documents.",
        next: "Nothing was sent. Add it in Profile and a new try starts.", tone: "attention", retry: "AFTER_CHANGE",
        primary: action("OPEN_PROFILE", "Add your name", "/vault/answers") }));
    case "WRITING_CHECK":
      return guide({ ...shared, label: "Writing stopped", heading, happened: "RoleDawn couldn’t finish documents that passed every check.",
        next: "Nothing was sent. Try again; if it stops again, adding a story to your profile usually helps.", tone: "error", retry: "MANUAL",
        primary: TRY_AGAIN, secondary: action("OPEN_PROFILE", "Add a story", "/vault/stories") });
    case "SERVICE_CREDITS":
      return guide({ ...shared, label: "Writing stopped", heading, happened: "RoleDawn's AI account ran out of credits.",
        next: "Nothing was sent. Add credits to the configured AI account, then try again.", tone: "error", retry: "AFTER_CHANGE", primary: TRY_AGAIN });
    case "SERVICE_BUSY":
      return guide({ ...shared, label: "Writing stopped", heading, happened: "The writing service was busy.",
        next: "Nothing was sent. Try again in a few minutes.", tone: "error", retry: "MANUAL", primary: TRY_AGAIN });
    case "UNKNOWN":
      return guide({ ...shared, label: "Writing stopped", heading, happened: "Writing stopped unexpectedly.",
        next: "Nothing was sent. Try again.", tone: "error", retry: "MANUAL", primary: TRY_AGAIN });
  }
}

// ---------------------------------------------------------------------------
// Other places the candidate is asked to act
// ---------------------------------------------------------------------------

/** Documents are ready, but the earlier send request closed because the board wasn't supported. */
export function guideSendNotDeliverable(): StopGuidance {
  return guide({
    label: "Send stopped", heading: "Send stopped",
    happened: "RoleDawn couldn’t send this when you asked, because the job board wasn’t supported then. Your documents are ready.",
    next: "Open the application to continue sending here. Your documents are ready.",
    tone: "attention", needsYou: true, step: 2, retry: "AFTER_CHANGE", primary: action("OPEN_APPLICATION", "Open"),
  });
}

/** The profile is missing something the writing needs. The application page lists each item with its own link. */
export function guideProfileInput(): StopGuidance {
  return guide({
    label: "Needs you", heading: "Your profile needs one thing first",
    happened: "Something in your profile needs a quick fix before RoleDawn can write.",
    next: "RoleDawn doesn’t write from missing or unconfirmed facts. Fix the item and it picks up where it left off.",
    tone: "attention", needsYou: true, step: 0, retry: "AFTER_CHANGE", primary: action("OPEN_APPLICATION", "See what’s missing"),
  });
}

/** Button text for a Home row, from the primary action. */
export function homeActionLabel(primary: StopAction): string | null {
  if (primary.short) return primary.short;
  switch (primary.kind) {
    case "ANSWER": return "Answer";
    case "CODE": return "Enter code";
    case "VERIFY_BROWSER": return "Verify here";
    case "TRY_AGAIN": return "Try again";
    case "RESUME": return "Resume";
    case "EMPLOYER_PAGE": return "Open posting";
    case "REFRESH_FILES": return "Rewrite";
    case "OPEN_PROFILE": return "Open Profile";
    case "OPEN_APPLICATION": return primary.label || "Open";
    default: return null;
  }
}
