import { presentApplication, type ApplicationPresentation, type ApplicationPresentationInput } from "./application-presentation.ts";

/** What a stalled application needs from the candidate, resolved in place on Home. */
export type HomeNeed = Readonly<{ kind: "CODE"; recipient: string; expiresAt: string }> | Readonly<{ kind: "ANSWERS"; count: number }>;

/** A Home row's status: the application's own state, made specific when it needs the candidate. */
export function presentHomeApplication(input: ApplicationPresentationInput & Readonly<{ need: HomeNeed | null }>): ApplicationPresentation {
  const base = presentApplication(input);
  const need = input.need;
  if (need?.kind === "CODE") return { ...base, label: "Enter code", detail: `The employer emailed a verification code to ${need.recipient}.`, tone: "attention", needsYou: true };
  if (need?.kind === "ANSWERS") return { ...base, label: `Answer ${need.count} question${need.count === 1 ? "" : "s"}`, detail: "The employer's form asked something only you can answer.", tone: "attention", needsYou: true };
  return base;
}
