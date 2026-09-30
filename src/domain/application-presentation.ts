import type { ApplicationPreparationStage } from "./application-input-snapshot.ts";
import type { ApplicationStatus, AutopilotSummary, JobIntakeStatus } from "./dashboard-queue.ts";
import type { ApplicationSendIntentState } from "./application-send-intent.ts";
import type { ApplicationAutopilotStatus } from "./application-autopilot.ts";
import {
  guideIntakeFailure, guideProfileInput, guideSend, guideSendNotDeliverable, guideWritingFailure, homeActionLabel,
  type GuidanceTone, type StopGuidance, type SendGuidanceInput,
} from "./application-stop-guidance.ts";

/** Five beads on the status rail. */
export const APPLICATION_STEPS = ["Prepare", "Write", "Ready", "Apply", "Done"] as const;

export type PresentationTone = GuidanceTone;

export type ApplicationPresentation = Readonly<{
  label: string;
  detail: string;
  tone: PresentationTone;
  /** Index into APPLICATION_STEPS of the current bead. */
  step: number;
  needsYou: boolean;
  closed: boolean;
  /** What to do about it, when the state has a stop or a need behind it. */
  guidance?: StopGuidance;
  /** Short button text for the Home row, from the primary action. */
  actionLabel?: string;
}>;

export type ApplicationPresentationInput = Readonly<{
  status: ApplicationStatus;
  intakeStatus: JobIntakeStatus | null;
  preparationStage: ApplicationPreparationStage | null;
  hasReceipt: boolean;
  sendIntent?: ApplicationSendIntentState;
  autoApplySelected?: boolean;
  /** The send request for the current documents, if any. */
  autopilot?: AutopilotSummary | null;
  /** Why the job could not be read (the intake's failure code). */
  failureCode?: string | null;
  /** Why writing stopped (the latest preparation run's error code). */
  preparationFailureCode?: string | null;
  /** Documents exist, so a stop happened after writing. Unknown counts as no. */
  hasDocuments?: boolean;
  profileChanged?: boolean;
  provider?: SendGuidanceInput["provider"];
}>;

function present(label: string, detail: string, tone: PresentationTone, step: number, extra: Partial<Pick<ApplicationPresentation, "needsYou" | "closed">> = {}): ApplicationPresentation {
  return Object.freeze({ label, detail, tone, step, needsYou: extra.needsYou ?? false, closed: extra.closed ?? false });
}

/** A guided state as a presentation: the same words on Home, in the side panel and on the application page. */
export function presentGuidance(guidance: StopGuidance): ApplicationPresentation {
  const actionLabel = homeActionLabel(guidance.primary);
  return Object.freeze({
    label: guidance.label, detail: guidance.happened, tone: guidance.tone, step: guidance.step,
    needsYou: guidance.needsYou, closed: guidance.closed, guidance,
    ...(actionLabel ? { actionLabel } : {}),
  });
}

/** The autopilot states that speak for an application while its send is live or stopped. */
const SEND_SPEAKS: ReadonlySet<ApplicationAutopilotStatus> = new Set(["QUEUED", "RUNNING", "WAITING_ANSWERS", "PAUSED", "SUBMITTING", "UNCERTAIN", "RECONCILING", "FAILED_SAFE"]);

export function presentApplication(input: ApplicationPresentationInput): ApplicationPresentation {
  if (input.intakeStatus === "FAILED") return presentGuidance(guideIntakeFailure(input.failureCode));
  if (input.intakeStatus === "PENDING" || input.intakeStatus === "RESOLVING") {
    return present("Reading the job", "Importing the official posting.", "working", 0);
  }
  // While a send is live or stopped, its own state outranks the application record's.
  const send = input.autopilot;
  if (send && SEND_SPEAKS.has(send.status)) {
    return presentGuidance(guideSend({
      status: send.status, failureCode: send.failureCode, transientRetries: send.transientRetries, reconcileCount: send.reconcileCount,
      expired: send.expired, profileChanged: input.profileChanged, provider: input.provider,
    }));
  }
  switch (input.status) {
    case "DRAFTING": {
      const stage = input.preparationStage;
      if (stage === "RESEARCHING") return present("Researching", "Reading the company and the role.", "working", 1);
      if (stage === "DRAFTING" || stage === "VALIDATING") return present("Writing", "Writing and fact-checking your résumé and cover letter.", "working", 1);
      if (stage === "RENDERING") return present("Finishing", "Laying out your documents.", "working", 1);
      if (stage === "INPUTS_READY") return present("Writing", "Your profile is ready; writing starts next.", "working", 1);
      return present("Preparing", "Gathering the job and your profile.", "working", 0);
    }
    case "NEEDS_USER":
      return presentGuidance(guideProfileInput());
    case "READY":
      if (input.sendIntent === "UNAVAILABLE") {
        return present("Status unavailable", "Reload to check your send request before starting another one.", "attention", 2, { needsYou: true });
      }
      if (input.sendIntent === "NOT_DELIVERABLE") return presentGuidance(guideSendNotDeliverable());
      if (input.sendIntent === "DELEGATED") {
        return present("Applying", "Your send request was accepted. Loading its latest progress.", "working", 3);
      }
      if (input.sendIntent === "OPEN" || input.autoApplySelected) {
        return present("Queued to apply", "Your documents are ready. RoleDawn will start the employer's form next.", "working", 3);
      }
      return present("Ready to send", "Your documents are ready. Review them and apply.", "ready", 2);
    case "AUTHORIZED":
    case "EXECUTING":
      return present("Applying", "Filling out the employer's form.", "working", 3);
    case "TAKEOVER":
      return present("Needs you", "The employer's form asked something only you can answer.", "attention", 3, { needsYou: true });
    case "PRE_SUBMIT_REVIEW":
      return present("Review the form", "The form is filled and waiting for you.", "attention", 3, { needsYou: true });
    case "RECONCILING":
      return present("Confirming", "Checking that the employer received it.", "working", 3);
    case "CONFIRMED":
      return input.hasReceipt
        ? present("Applied", "The employer confirmed your application.", "done", 4, { closed: true })
        : present("Check needed", "The employer’s own confirmation isn’t recorded for this application, so it isn’t counted as applied.", "attention", 4, { needsYou: true });
    case "FAILED_SAFE":
      // Without documents the stop was in writing. With documents, and no send request
      // read here, the reason lives on the application page; never guess a writing retry.
      return input.hasDocuments === false
        ? presentGuidance(guideWritingFailure({ code: input.preparationFailureCode, profileChanged: input.profileChanged }))
        : present("Stopped", "The application stopped. Open it for the reason and next step.", "error", 3, { needsYou: true });
    case "SKIPPED":
      return present("Skipped", "Not applying to this one.", "neutral", 0, { closed: true });
    case "CANCELED":
      return present("Canceled", "This application was canceled.", "neutral", 0, { closed: true });
  }
}
