"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { controlApplicationAutopilotAction, delegateApplicationAutopilotAction, provideApplicationAutopilotVerificationCodeAction, saveApplicationAutopilotAnswersAction } from "@/app/(candidate)/applications/[applicationId]/autopilot-actions";
import { AGENT_QUESTION_LIMITS, displayQuestionLabel, validateAgentQuestionAnswer, type AgentQuestionValue } from "@/domain/application-agent-questions";
import type { ApplicationAutopilotView } from "@/domain/application-autopilot";
import styles from "./ApplicationAutopilot.module.css";

type Props = Readonly<{ applicationId: string; aggregateVersion: number; revisionId: string; packetHash: string; view: ApplicationAutopilotView | null; canStart: boolean; startBlockedReason?: string }>;
const STATUS_COPY = {
  QUEUED: "Your application is queued.", RUNNING: "RoleDawn is filling your application.", WAITING_ANSWERS: "Answer below, and RoleDawn will continue.",
  PAUSED: "This application is paused.", SUBMITTING: "The application is being sent. We’re checking for confirmation.",
  UNCERTAIN: "Submission is not confirmed. RoleDawn will check its status before any further action.", RECONCILING: "RoleDawn is checking whether the application was received.",
  CONFIRMED: "Your application was received.", CANCELED: "This application was canceled.", FAILED_SAFE: "The application stopped before submission.",
} as const;
/** An unconfirmed send whose cause is known: the employer never accepted it. */
const UNCONFIRMED_COPY: Readonly<Record<string, string>> = {
  DELIVERY_EMAIL_VERIFICATION_TIMEOUT: "The employer asked for the code it emailed you, and it wasn’t entered in time, so the employer didn’t accept this application. Finish it on the employer’s site with your files.",
  DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED: "The employer didn’t accept the codes entered, so it didn’t accept this application. Finish it on the employer’s site with your files.",
};
/** The employer refused the send twice (RoleDawn already retried once); nothing is pending. */
const NOT_ACCEPTED_COPY: Readonly<Record<string, string>> = {
  DELIVERY_EMAIL_VERIFICATION_TIMEOUT: "The employer’s emailed verification code didn’t arrive in time, twice, so it hasn’t accepted this application. Nothing is pending. Press Try again to send it again.",
  DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED: "The employer refused the verification codes, so it hasn’t accepted this application. Nothing is pending. Press Try again to send it again.",
};
const FAILURE_COPY: Readonly<Record<string, string>> = {
  DELIVERY_BROWSER_QUOTA_EXHAUSTED: "RoleDawn’s cloud browser is out of minutes, so nothing was sent. Try again once browser time is available.",
  DELIVERY_BROWSER_CONCURRENCY_LIMIT: "Too many applications were sending at once, so nothing was sent. Try again in a minute.",
  DELIVERY_SITE_UNSUPPORTED: "This job board is not supported yet. Use your files to apply on the employer’s site.",
  DELIVERY_REQUIRED_CONTROL_UNSUPPORTED: "A required field needs your help on the employer’s site.",
  DELIVERY_FORM_VALIDATION_OR_CAPTCHA: "The employer’s form needs a correction or a verification step. Continue on the employer’s site.",
  DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM: "The employer’s form did not accept an answer. Review it on the employer’s site.",
};

export function ApplicationAutopilot(props: Props) {
  const view = props.canStart && props.view?.revisionId !== props.revisionId &&
    (props.view?.status === "FAILED_SAFE" || props.view?.status === "CANCELED") ? null : props.view;
  // A new question batch must not inherit the preceding batch’s saved state.
  return <AutopilotForm key={`${view?.id ?? props.applicationId}:${view?.version ?? props.aggregateVersion}`} {...props} view={view} />;
}
function AutopilotForm({ applicationId, aggregateVersion, revisionId, packetHash, view, canStart, startBlockedReason }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const request = useRef<{ signature: string; commandId: string } | null>(null);
  function commandId(payload: unknown): string {
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, commandId: crypto.randomUUID() };
    return request.current.commandId;
  }
  function run(action: () => Promise<Readonly<{ ok: boolean; message?: string }>>) {
    if (pending || saved) return;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) { setMessage(result.message ?? "The request could not be confirmed."); return; }
        setSaved(true); router.refresh();
      } catch { setMessage("The connection was interrupted. Retry to check the same request."); }
    });
  }
  function delegate() {
    if (!canStart || startBlockedReason) return;
    const payload = { applicationId, expectedAggregateVersion: aggregateVersion, revisionId, packetHash };
    const id = commandId(payload);
    run(() => delegateApplicationAutopilotAction({ ...payload, commandId: id }));
  }
  function control(action: "PAUSE" | "RESUME" | "CANCEL") {
    if (!view) return;
    const payload = { id: view.id, expectedVersion: view.version, action };
    const id = commandId(payload);
    run(() => controlApplicationAutopilotAction({ ...payload, commandId: id }));
  }
  function answer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!view || pending || saved || view.status !== "WAITING_ANSWERS") return;
    const form = new FormData(event.currentTarget); const invalidIds = new Set<string>();
    const answers = view.questions.map(question => {
      const raw = form.get(question.id);
      const value: AgentQuestionValue = question.kind === "MULTI_SELECT" ? form.getAll(question.id).map(String)
        : question.kind === "BOOLEAN" && (raw === "true" || raw === "false") ? raw === "true" : typeof raw === "string" ? raw : "";
      try { validateAgentQuestionAnswer(question, value); } catch { invalidIds.add(question.id); }
      return { questionId: question.id, fingerprint: question.fingerprint, value };
    });
    setInvalid(invalidIds);
    if (invalidIds.size) { setMessage("Check the highlighted answers before continuing."); return; }
    const payload = { id: view.id, expectedVersion: view.version, answers }; const id = commandId(payload);
    run(() => saveApplicationAutopilotAnswersAction({ ...payload, commandId: id }));
  }
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pendingRequest = view?.verification;
    if (!view || !pendingRequest || pending || saved) return;
    const value = code.replace(/\s+/gu, "");
    if (!/^[A-Za-z0-9]{8}$/u.test(value)) { setMessage("Enter the 8-character code from the email."); return; }
    const payload = { id: view.id, verificationId: pendingRequest.id, code: value };
    const id = commandId(payload);
    run(() => provideApplicationAutopilotVerificationCodeAction({ ...payload, commandId: id }));
  }
  const controllable = view && ["QUEUED","RUNNING","WAITING_ANSWERS","PAUSED","FAILED_SAFE"].includes(view.status);
  return <section className={styles.card} aria-labelledby="application-autopilot-heading">
    <h2 id="application-autopilot-heading">{view?.status === "WAITING_ANSWERS" ? "A few details are missing" : view?.verification ? "Check your email" : "Apply for me"}</h2>
    {view ? (view.verification ? null : <p role="status">{view.status === "UNCERTAIN" && view.failureCode && UNCONFIRMED_COPY[view.failureCode] ? UNCONFIRMED_COPY[view.failureCode] : STATUS_COPY[view.status]}</p>) : <>
      {startBlockedReason ? <p id="application-autopilot-unavailable">{startBlockedReason}</p> : <>
        <p>RoleDawn will apply to this job using these files and your approved details. If an answer is missing, we’ll ask you here.</p>
        <p className={styles.hint}>This authorizes one application to this employer. You can pause or cancel before submission begins.</p>
      </>}
      <button type="button" disabled={!canStart || Boolean(startBlockedReason) || pending || saved} aria-describedby={startBlockedReason ? "application-autopilot-unavailable" : undefined} onClick={delegate}>{pending ? "Starting…" : "Apply for me"}</button>
    </>}
    {view?.status === "FAILED_SAFE" && view.failureCode && (NOT_ACCEPTED_COPY[view.failureCode] ?? FAILURE_COPY[view.failureCode])
      ? <p>{NOT_ACCEPTED_COPY[view.failureCode] ?? FAILURE_COPY[view.failureCode]}</p> : null}
    {view?.verification ? <form onSubmit={verify}>
      <p role="status">{view.verification.retry
        ? "That code didn’t work, so the employer sent a new one. Enter the newest code from your inbox."
        : `The employer’s application system emailed a verification code to ${view.verification.recipient}. Enter it and RoleDawn finishes sending this application.`}</p>
      <div className={styles.field}>
        <label htmlFor="autopilot-verification-code">Verification code</label>
        <input id="autopilot-verification-code" name="code" value={code} onChange={(event) => setCode(event.target.value)} required
          autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={12} disabled={pending || saved}
          aria-describedby="autopilot-verification-hint" />
      </div>
      <p id="autopilot-verification-hint" className={styles.hint}>It’s 8 characters, and it expires about 10 minutes after the email arrives. Check spam if you don’t see it.</p>
      <button type="submit" disabled={pending || saved}>{pending ? "Sending…" : "Finish application"}</button>
    </form> : null}
    {view?.status === "WAITING_ANSWERS" && view.questions.length > 0 ? <form onSubmit={answer}>
      <fieldset className={styles.fields} disabled={pending || saved}>
        <legend className={styles.srOnly}>Missing application details</legend>
        {view.questions.map(question => {
          const id = `autopilot-question-${question.id}`; const errorId = `${id}-error`; const isInvalid = invalid.has(question.id);
          return <div key={question.id} className={styles.field}>
            {question.kind === "MULTI_SELECT" ? <fieldset className={styles.choices} aria-invalid={isInvalid} aria-describedby={isInvalid ? errorId : undefined}>
              <legend>{displayQuestionLabel(question.label)}{question.required ? " (required)" : ""}</legend>
              {question.options.map((option,index) => <label key={option.value} htmlFor={`${id}-${index}`} className={styles.choice}>
                <input id={`${id}-${index}`} name={question.id} value={option.value} type="checkbox" /><span>{option.label}</span>
              </label>)}
            </fieldset> : <>
              <label htmlFor={id}>{displayQuestionLabel(question.label)}{question.required ? " (required)" : ""}</label>
              {question.kind === "LONG_TEXT" ? <textarea id={id} name={question.id} rows={4} required={question.required} maxLength={AGENT_QUESTION_LIMITS.answerCharacters} aria-invalid={isInvalid} aria-describedby={isInvalid ? errorId : undefined} />
                : question.kind === "BOOLEAN" || question.kind === "SINGLE_SELECT" ? <select id={id} name={question.id} required defaultValue="" aria-invalid={isInvalid} aria-describedby={isInvalid ? errorId : undefined}>
                  <option value="" disabled>Choose an answer</option>
                  {question.kind === "BOOLEAN" ? <><option value="true">Yes</option><option value="false">No</option></> : question.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select> : <input id={id} name={question.id} type="text" required={question.required} maxLength={AGENT_QUESTION_LIMITS.answerCharacters} aria-invalid={isInvalid} aria-describedby={isInvalid ? errorId : undefined} />}
            </>}
            {isInvalid ? <span id={errorId} className={styles.error}>Enter an answer using the choices shown.</span> : null}
          </div>;
        })}
      </fieldset>
      <p className={styles.hint}>These answers apply only to this application. Saving lets RoleDawn continue and submit it when complete.</p>
      <button type="submit" disabled={pending || saved}>{pending ? "Saving…" : "Save and continue"}</button>
    </form> : null}
    {controllable ? <div className={styles.controls}>
      <button type="button" disabled={pending || saved} onClick={() => control(view.status === "PAUSED" || view.status === "FAILED_SAFE" ? "RESUME" : "PAUSE")}>{view.status === "FAILED_SAFE" ? "Try again" : view.status === "PAUSED" ? "Resume" : "Pause"}</button>
      {view.status !== "FAILED_SAFE" ? <button type="button" disabled={pending || saved} onClick={() => control("CANCEL")}>Cancel application</button> : null}
    </div> : null}
    {saved ? <p role="status">Saved. Updating this application…</p> : null}
    {message ? <p className={styles.error} role="alert">{message}</p> : null}
  </section>;
}
