import { presentApplication, presentGuidance, type ApplicationPresentation, type ApplicationPresentationInput } from "./application-presentation.ts";
import { guideSend } from "./application-stop-guidance.ts";

/** What a stalled application needs from the candidate, resolved in place on Home. */
export type HomeNeed = Readonly<{ kind: "CODE"; recipient: string; expiresAt: string }> | Readonly<{ kind: "ANSWERS"; count: number }> | Readonly<{ kind: "BROWSER"; expiresAt: string }>;

/** A Home row's status: the application's own state, made specific when it needs the candidate. */
export function presentHomeApplication(input: ApplicationPresentationInput & Readonly<{ need: HomeNeed | null }>): ApplicationPresentation {
  const need = input.need;
  if (need?.kind === "BROWSER") return presentGuidance(guideSend({ status: "RUNNING", browserVerification: true }));
  if (need?.kind === "CODE") return presentGuidance(guideSend({ status: "SUBMITTING", verificationRecipient: need.recipient }));
  if (need?.kind === "ANSWERS") return presentGuidance(guideSend({ status: "WAITING_ANSWERS", questionCount: need.count }));
  return presentApplication(input);
}
