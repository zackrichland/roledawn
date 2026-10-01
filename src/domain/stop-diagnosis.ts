/**
 * Operator diagnosis for a stopped application (D-149). The candidate-facing
 * copy lives in `application-stop-guidance.ts` and never names engineering
 * causes; this module is for the founder and coding agents reading
 * `npm run ops:why`. It names the pipeline stage, the most likely cause given
 * the stop code and the recorded stop diagnostics, and the next step.
 *
 * Inference is labeled: a cause marked `confirmed` follows directly from the
 * code; `likely` reads the diagnostics and can be wrong.
 */
import { deliveryStopGroup, intakeFailureKind, writingFailureKind } from "./application-stop-guidance.ts";

export type PipelineStage = "INTAKE" | "PREPARATION" | "WRITING" | "SEND_QUEUE" | "BROWSER_START" | "FORM" | "SUBMIT" | "CONFIRMATION" | "DONE" | "UNKNOWN";
export type StopDiagnosisInput = Readonly<{
  applicationStatus: string | null;
  intakeStatus?: string | null; intakeFailure?: string | null;
  /** The latest preparation run (it also carries document writing). */
  runStatus?: string | null; runError?: string | null;
  sendIntentClosedReason?: string | null; sendIntentOpen?: boolean;
  /** The latest recorded reason the open send request could not start (migration 20261001040000). */
  sendIntentError?: string | null;
  sendStatus?: string | null; sendFailure?: string | null;
  /** Latest `stop-diagnosis` worker event detail, if any. */
  diagnosis?: Readonly<Record<string, unknown>> | null;
}>;
export type StopDiagnosis = Readonly<{
  stage: PipelineStage;
  code: string | null;
  certainty: "confirmed" | "likely";
  cause: string;
  next: string;
  /** A fix that changes a delivery guard waits for the founder's decision (see docs/execution/reliability-review-2026-10-01.md). */
  proposal?: string;
}>;

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const keys = (value: unknown) => Object.keys(record(value));

/** Delivery stop codes whose cause is fixed and known. */
const KNOWN: Readonly<Record<string, Omit<StopDiagnosis, "stage" | "code" | "certainty">>> = {
  BROWSERBASE_PROJECT_SCOPE_INVALID: {
    cause: "The Browserbase API key can see more than one project (or none), so the worker refused to pick one.",
    next: "Set BROWSERBASE_PROJECT_ID in Netlify to the delivery project, redeploy, then Try again.",
  },
  BROWSERBASE_RUNTIME_DISABLED: { cause: "ROLEDAWN_BROWSERBASE_ENABLED is not \"true\" for the hosted workers.", next: "Set it in Netlify, redeploy, then Try again." },
  DELIVERY_BROWSER_QUOTA_EXHAUSTED: { cause: "Browserbase answered 402: the plan is out of browser minutes.", next: "Add Browserbase capacity, then Try again." },
  DELIVERY_BROWSER_CONCURRENCY_LIMIT: { cause: "Browserbase answered 429: too many browsers open or created too fast.", next: "RoleDawn retries this by itself; check for leaked sessions in Browserbase if it repeats." },
  MODEL_CREDITS_EXHAUSTED: { cause: "OpenAI reported the account is out of credits.", next: "Fund the OpenAI account, then Try again." },
  APPLICATION_AUTOPILOT_AUTHORITY_STALE: { cause: "The candidate profile changed after these documents were written, so the old send lost its authority.", next: "Rewrite documents on the application page, then send again." },
  DELIVERY_SERVICE_WORKER_UNSUPPORTED: {
    cause: "A service worker was present in the isolated delivery context. With Browserbase's CAPTCHA solver on, this may be the provider's own extension worker.",
    next: "Open the Browserbase replay. If the worker URL is chrome-extension://, approve proposal P2.", proposal: "P2",
  },
  APPLICATION_FILL_CAPTCHA_TAKEOVER: {
    cause: "A visible CAPTCHA was still unsolved after the solver wait, and the in-app check was not completed in time.",
    next: "Use Verify here on Home. If solverStarted is 0, the Browserbase solver never engaged in the isolated context (proposal P4).", proposal: "P4",
  },
  DELIVERY_BROWSER_VERIFICATION_TIMEOUT: { cause: "The in-app verification window (five minutes) expired before the check was completed.", next: "Try again and complete Verify here while the send is running." },
  DELIVERY_EMAIL_VERIFICATION_TIMEOUT: { cause: "The employer emailed a code that neither Gmail nor the candidate supplied within eight minutes.", next: "Reconnect Gmail in Profile → Preferences if it expired, then Try again." },
  APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER: { cause: "The form asked to sign in to an account.", next: "Account-based boards are not supported yet." },
  DELIVERY_SITE_UNSUPPORTED: { cause: "The apply URL is not a Greenhouse, Lever or Ashby hosted form RoleDawn can deliver to.", next: "Use the prepared files on the employer's site, or add an adapter for that board." },
  APPLICATION_AUTOPILOT_DESTINATION_UNSUPPORTED: { cause: "The job's apply URL is not a supported hosted form (custom career site, EU host or another ATS).", next: "Use the prepared files, or add support for that host." },
  DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM: { cause: "A saved answer matched no option the form accepted.", next: "Answer the question again on Home with the exact option text." },
};

function deliveryDiagnosis(code: string | null, diagnosis: Readonly<Record<string, unknown>>): Omit<StopDiagnosis, "stage" | "code"> {
  const frames = keys(diagnosis.frames);
  const blocked = keys(diagnosis.blocked);
  const phase = typeof diagnosis.phase === "string" ? diagnosis.phase : null;
  const solverStarted = Number(diagnosis.solverStarted ?? 0);
  if (code && KNOWN[code]) {
    const known = KNOWN[code];
    if (code === "APPLICATION_FILL_CAPTCHA_TAKEOVER" && solverStarted > 0) {
      return { certainty: "likely", cause: "A visible CAPTCHA appeared; the Browserbase solver started but did not finish in time, and the in-app check was not completed.", next: "Use Verify here on Home; consider Browserbase proxies for this board." };
    }
    return { certainty: "confirmed", ...known };
  }
  if (code === "AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER") {
    if (frames.some((frame) => frame.startsWith("chrome-error:"))) return {
      certainty: "likely", proposal: "P1",
      cause: "A third-party frame on the page (video, social widget, analytics) was refused by the delivery guard. Chrome replaced it with its own error page, and the form reader stopped on that error page.",
      next: "Approve proposal P1 (skip Chrome's error page and provider-extension frames), or add the frame's host to this board's reviewed policy.",
    };
    return { certainty: "likely", cause: `A frame from another origin loaded on the form page (${frames.filter((frame) => !frame.startsWith("http://127") && frame !== String(diagnosis.page)).slice(0, 3).join(", ") || "see frames"}).`, next: "Review the frame in the Browserbase replay; add it to the board policy only if it is benign." };
  }
  if (code === "DELIVERY_STEP_UNSUPPORTED" || code === "DELIVERY_RESTORE_DESTINATION_INVALID") {
    const assets = blocked.filter((key) => / (?:script|stylesheet|font|xhr|fetch) /u.test(key));
    if (assets.length) return {
      certainty: "likely", proposal: "P3",
      cause: `The form never appeared. The guard refused page resources it has not reviewed (${assets.slice(0, 3).join("; ")}), so the page likely could not render.`,
      next: "Add those exact asset prefixes to the board's reviewed policy (application-delivery-browser.ts), or approve proposal P3.",
    };
    return { certainty: "likely", cause: "The form did not appear in time on the employer's page (slow load, a changed page layout, or a posting that moved).", next: "This build waits longer and retries once with a fresh browser; if it repeats, open the Browserbase replay." };
  }
  if (code?.startsWith("DELIVERY_ASHBY_REQUEST_") && /QUERY_DOCUMENT|OPERATION_UNKNOWN/u.test(code)) return {
    certainty: "confirmed", proposal: "P5",
    cause: "Ashby changed its public client: a GraphQL request no longer matches the reviewed query text or operation list, so the guard stopped the send.",
    next: "Re-review the changed Ashby operation and update ASHBY_QUERY_HASHES (ashby-delivery-protocol.ts), or approve proposal P5.",
  };
  if (code?.startsWith("DELIVERY_ASHBY_")) return { certainty: "confirmed", cause: "Ashby's form or responses differed from the reviewed contract (D-123–D-145).", next: "Read docs/boards/ashby.md and the Browserbase replay; repair the specific contract named by the code." };
  if (code === "DELIVERY_FORM_CONTRACT_DRIFT") return { certainty: "confirmed", cause: "Lever's application form no longer matches the reviewed method, encoding or action URL.", next: "Re-review Lever's form contract (docs/boards/lever.md)." };
  if (code === "DELIVERY_FORM_VALIDATION_OR_CAPTCHA") return { certainty: "likely", cause: "After the final click the page neither sent the application nor showed a receipt: a form validation message or a hidden challenge held it.", next: "Open the Browserbase replay at the end of the session to read the message." };
  const group = deliveryStopGroup(code);
  if (group === "TEMPORARY") return { certainty: "likely", cause: `A temporary model or browser-provider problem (${code ?? "no code"}) at the ${phase ?? "unknown"} phase.`, next: "This build retries once with a fresh browser within the same run; Try again if it still stopped." };
  if (group === "UNSUPPORTED_FIELD") return { certainty: "likely", cause: `The form has a control or step RoleDawn cannot complete yet (${code}).`, next: "Open the Browserbase replay at the stop to see the control; add it to the board template." };
  return { certainty: "likely", cause: `Stopped with ${code ?? "no recorded code"} at the ${phase ?? "unknown"} phase.`, next: "Read the timeline (npm run ops:status -- --app <id>) and the Browserbase replay." };
}

/** One application's stop, explained for an operator. */
export function diagnoseStop(input: StopDiagnosisInput): StopDiagnosis {
  const diagnosis = record(input.diagnosis);
  if (input.applicationStatus === "CONFIRMED") return { stage: "DONE", code: null, certainty: "confirmed", cause: "The employer confirmed the application.", next: "Nothing." };
  if (input.intakeFailure || input.intakeStatus === "FAILED") {
    const kind = intakeFailureKind(input.intakeFailure);
    return { stage: "INTAKE", code: input.intakeFailure ?? null, certainty: "confirmed",
      cause: kind === "UNSUPPORTED_BOARD" ? "The link is not a Greenhouse, Lever or Ashby posting." : kind === "POSTING_CLOSED" ? "The posting was not found; it is probably closed." : `The posting could not be read (${input.intakeFailure ?? "unknown"}).`,
      next: kind === "TEMPORARY" ? "Paste it again in a few minutes." : "Check the link." };
  }
  if (input.applicationStatus === "NEEDS_USER") return { stage: "PREPARATION", code: input.runError ?? null, certainty: "confirmed",
    cause: "The profile is missing something the documents need (résumé, reviewed evidence or career profile).", next: "Finish Profile, then the application continues." };
  if (input.applicationStatus === "FAILED_SAFE" && !input.sendStatus && input.runError?.startsWith("PREPARATION_")) return { stage: "PREPARATION", code: input.runError, certainty: "confirmed",
    cause: `Preparing the candidate's frozen inputs failed (${input.runError}).`, next: "Try again from the application page; if it repeats, read the preparation lane events." };
  if (input.applicationStatus === "FAILED_SAFE" && !input.sendStatus && (input.runStatus === "FAILED" || input.runError)) {
    const kind = writingFailureKind(input.runError);
    return { stage: "WRITING", code: input.runError ?? null, certainty: "confirmed",
      cause: kind === "SERVICE_CREDITS" ? "OpenAI is out of credits." : kind === "SERVICE_BUSY" ? "The writing models failed repeatedly (timeouts or provider errors)." : kind === "LETTER_UNVERIFIED" ? "The cover letter had a claim the verifier could not support from the profile." : `Writing stopped (${input.runError ?? "unknown"}).`,
      next: kind === "SERVICE_CREDITS" ? "Fund OpenAI, then Try again." : "Try again from the application page; if it repeats, read the writing-check events." };
  }
  if (input.sendIntentClosedReason === "NOT_DELIVERABLE") return { stage: "SEND_QUEUE", code: "NOT_DELIVERABLE", certainty: "confirmed",
    cause: "The documents were written, but the job's apply URL is not a hosted form RoleDawn can send to (custom career site, EU host or another ATS).", next: "Use the prepared files on the employer's site." };
  if (input.sendIntentOpen && !input.sendStatus && input.applicationStatus === "READY") {
    const code = input.sendIntentError ?? null;
    if (code === "APPLICATION_AUTOPILOT_REVISION_INVALID" || code === "APPLICATION_AUTOPILOT_AUTHORITY_STALE") return { stage: "SEND_QUEUE", code, certainty: "confirmed",
      cause: "The send request is waiting on documents written before the latest profile change, so it cannot start.", next: "Rewrite documents on the application page; the send then starts by itself." };
    if (code === "APPLICATION_AUTOPILOT_REVIEW_STALE") return { stage: "SEND_QUEUE", code, certainty: "confirmed",
      cause: "This application already has a submission attempt or changed after review, so a new send cannot be delegated.", next: "Check the earlier attempt's outcome before sending again." };
    if (code) return { stage: "SEND_QUEUE", code, certainty: "confirmed", cause: `The send request could not start: ${code}.`, next: "Read the cleanup lane events; the sweep retries every few minutes." };
    return { stage: "SEND_QUEUE", code: null, certainty: "likely",
      cause: "The send request is open but no send was created, and no reason was recorded (the recording migration 20261001040000 may not be applied yet). Most often a profile edit after the documents, or an earlier attempt on this application.",
      next: "Apply the migration, or rewrite documents if the profile changed." };
  }
  if (input.sendStatus === "FAILED_SAFE" || input.sendStatus === "UNCERTAIN") {
    const code = input.sendFailure ?? null;
    const stageName = String(diagnosis.stage ?? "");
    const stage: PipelineStage = input.sendStatus === "UNCERTAIN" ? "CONFIRMATION" : ["lease", "materialize", "browser-start"].includes(stageName) ? "BROWSER_START"
      : diagnosis.phase === "submit" || diagnosis.phase === "emailed-code" ? "SUBMIT" : "FORM";
    if (input.sendStatus === "UNCERTAIN") return { stage, code, certainty: "confirmed", cause: "A submission was attempted and the employer's response did not prove acceptance.", next: "Nothing is resent until the outcome is reconciled; check the candidate's email for the employer's confirmation." };
    return { stage, code, ...deliveryDiagnosis(code, diagnosis) };
  }
  if (input.sendStatus === "WAITING_ANSWERS") return { stage: "FORM", code: null, certainty: "confirmed", cause: "The form asked questions RoleDawn has no saved answer for.", next: "Answer them on Home; the send continues by itself." };
  if (["QUEUED", "RUNNING", "SUBMITTING", "RECONCILING"].includes(input.sendStatus ?? "")) return { stage: "FORM", code: null, certainty: "confirmed", cause: "The send is still running or queued.", next: "Wait, or watch it with npm run ops:status -- --watch." };
  if (input.applicationStatus === "DRAFTING") return { stage: input.intakeStatus === "RESOLVED" ? "WRITING" : "INTAKE", code: null, certainty: "likely",
    cause: "The job is still being read or the documents are still being written.", next: "Wait. If it stays here for more than 30 minutes, check the outbox in npm run ops:status (a dead-lettered message leaves this state stuck)." };
  return { stage: "UNKNOWN", code: input.sendFailure ?? input.runError ?? null, certainty: "likely", cause: `The application is ${input.applicationStatus ?? "in an unknown state"}.`, next: "Read the timeline with npm run ops:status -- --app <id>." };
}
