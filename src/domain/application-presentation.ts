import type { ApplicationPreparationStage } from "./application-input-snapshot.ts";
import type { ApplicationStatus, JobIntakeStatus } from "./dashboard-queue.ts";

/** Five beads on the status rail. */
export const APPLICATION_STEPS = ["Prepare", "Write", "Ready", "Apply", "Done"] as const;

export type PresentationTone = "working" | "attention" | "ready" | "done" | "neutral" | "error";

export type ApplicationPresentation = Readonly<{
  label: string;
  detail: string;
  tone: PresentationTone;
  /** Index into APPLICATION_STEPS of the current bead. */
  step: number;
  needsYou: boolean;
  closed: boolean;
}>;

export type ApplicationPresentationInput = Readonly<{
  status: ApplicationStatus;
  intakeStatus: JobIntakeStatus | null;
  preparationStage: ApplicationPreparationStage | null;
  hasReceipt: boolean;
  sendIntentOpen?: boolean;
  autoApplySelected?: boolean;
}>;

function present(label: string, detail: string, tone: PresentationTone, step: number, extra: Partial<Pick<ApplicationPresentation, "needsYou" | "closed">> = {}): ApplicationPresentation {
  return Object.freeze({ label, detail, tone, step, needsYou: extra.needsYou ?? false, closed: extra.closed ?? false });
}

export function presentApplication(input: ApplicationPresentationInput): ApplicationPresentation {
  if (input.intakeStatus === "FAILED") {
    return present("Couldn't read job", "The posting couldn't be imported. It may have closed.", "error", 0, { needsYou: true });
  }
  if (input.intakeStatus === "PENDING" || input.intakeStatus === "RESOLVING") {
    return present("Reading the job", "Importing the official posting.", "working", 0);
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
      return present("Needs you", "Something in your profile needs a quick fix before writing.", "attention", 0, { needsYou: true });
    case "READY":
      if (input.sendIntentOpen || input.autoApplySelected) {
        return present("Sending soon", "Files are ready. RoleDawn will apply in a moment.", "ready", 2);
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
        : present("Check needed", "Sent, but the confirmation wasn't captured.", "attention", 4, { needsYou: true });
    case "FAILED_SAFE":
      return present("Stopped", "RoleDawn stopped safely without sending. Open it for details.", "error", 3, { needsYou: true });
    case "SKIPPED":
      return present("Skipped", "Not applying to this one.", "neutral", 0, { closed: true });
    case "CANCELED":
      return present("Canceled", "This application was canceled.", "neutral", 0, { closed: true });
  }
}

/** Plain-language explanation of a delivery or preparation failure code. */
export function explainFailure(code: string | null | undefined): string | null {
  if (!code) return null;
  const known: Readonly<Record<string, string>> = {
    ATS_UNSUPPORTED: "This job board isn't supported yet. RoleDawn applies on Greenhouse, Lever, and Ashby.",
    JOB_NOT_FOUND: "The employer took this posting down.",
    APPLICATION_FILL_CAPTCHA_TAKEOVER: "The employer's form showed a human-verification check. Finish it yourself from the posting.",
    DRAFTING_CAREER_PROFILE_MISSING: "Your work history wasn't organized yet. Check Profile → Experience, then try again.",
    LETTER_CLAIM_UNVERIFIED: "RoleDawn couldn't write a cover letter it could fully verify from your profile. Adding interview stories usually fixes this.",
    APPLICATION_KIT_NAME_REQUIRED: "Add your legal name in Profile → Answers.",
  };
  if (known[code]) return known[code];
  if (code.startsWith("APPLICATION_WRITING") || code.startsWith("APPLICATION_DRAFTING")) {
    return "RoleDawn couldn't finish documents that passed every check. Try again, or add stories to your profile.";
  }
  if (code.startsWith("OPENAI") || code.startsWith("MODEL_")) return "The writing service was busy. Try again in a few minutes.";
  return null;
}
