"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { controlApplicationAutopilotAction, delegateApplicationAutopilotAction, provideApplicationAutopilotVerificationCodeAction, saveApplicationAutopilotAnswersAction } from "@/app/(candidate)/applications/[applicationId]/autopilot-actions";
import { AGENT_QUESTION_LIMITS, displayQuestionLabel, validateAgentQuestionAnswer, type AgentQuestionValue } from "@/domain/application-agent-questions";
import type { ApplicationAutopilotView } from "@/domain/application-autopilot";
import { parseAutopilotDestination } from "@/domain/application-autopilot-eligibility";
import { guideSend, type StopAction } from "@/domain/application-stop-guidance";
import type { AutopilotSummary } from "@/domain/dashboard-queue";
import styles from "./ApplicationAutopilot.module.css";
import guidanceStyles from "./StopGuidance.module.css";

type Props = Readonly<{
  applicationId: string; aggregateVersion: number; revisionId: string; packetHash: string;
  view: ApplicationAutopilotView | null; canStart: boolean; startBlockedReason?: string;
  /** The employer's own page for this job: the fallback when RoleDawn can't finish the form. */
  employerUrl?: string | null;
  /** Retry and reconcile counters for this send request. */
  summary?: AutopilotSummary | null;
  /** The profile changed after these files were written. */
  profileChanged?: boolean;
  /** In the Home side panel, actions that live on the application page link there. */
  linkToApplication?: boolean;
  /** The application page already states what happened in its header; leave it out of the card there. */
  showHappened?: boolean;
}>;

export function ApplicationAutopilot(props: Props) {
  const view = props.canStart && props.view?.revisionId !== props.revisionId &&
    (props.view?.status === "FAILED_SAFE" || props.view?.status === "CANCELED") ? null : props.view;
  // A new question batch must not inherit the preceding batch’s saved state.
  return <AutopilotForm key={`${view?.id ?? props.applicationId}:${view?.version ?? props.aggregateVersion}`} {...props} view={view} />;
}
function AutopilotForm({ applicationId, aggregateVersion, revisionId, packetHash, view, canStart, startBlockedReason, employerUrl, summary, profileChanged, linkToApplication, showHappened = true }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState("");
  const [code, setCode] = useState("");
  const request = useRef<{ signature: string; commandId: string } | null>(null);
  function commandId(payload: unknown): string {
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, commandId: crypto.randomUUID() };
    return request.current.commandId;
  }
  function run(done: string, action: () => Promise<Readonly<{ ok: boolean; message?: string }>>) {
    if (pending || saved) return;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) { setMessage(result.message ?? "The request could not be confirmed."); return; }
        setSaved(done); router.refresh();
      } catch { setMessage("The connection was interrupted. Retry to check the same request."); }
    });
  }
  function delegate() {
    if (!canStart || startBlockedReason) return;
    const payload = { applicationId, expectedAggregateVersion: aggregateVersion, revisionId, packetHash };
    const id = commandId(payload);
    run("Started. This page updates by itself.", () => delegateApplicationAutopilotAction({ ...payload, commandId: id }));
  }
  function control(action: "PAUSE" | "RESUME" | "CANCEL", done: string) {
    if (!view) return;
    const payload = { id: view.id, expectedVersion: view.version, action };
    const id = commandId(payload);
    run(done, () => controlApplicationAutopilotAction({ ...payload, commandId: id }));
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
    run("Answers sent. RoleDawn is continuing the form.", () => saveApplicationAutopilotAnswersAction({ ...payload, commandId: id }));
  }
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pendingRequest = view?.verification;
    if (!view || !pendingRequest || pending || saved) return;
    const value = code.replace(/\s+/gu, "");
    if (!/^[A-Za-z0-9]{8}$/u.test(value)) { setMessage("Enter the 8-character code from the email."); return; }
    const payload = { id: view.id, verificationId: pendingRequest.id, code: value };
    const id = commandId(payload);
    run("Code sent. RoleDawn is finishing the application.", () => provideApplicationAutopilotVerificationCodeAction({ ...payload, commandId: id }));
  }
  const guidance = view ? guideSend({
    status: view.status, failureCode: view.failureCode, transientRetries: summary?.transientRetries, reconcileCount: summary?.reconcileCount,
    expired: summary?.expired, profileChanged, provider: parseAutopilotDestination(employerUrl)?.provider ?? null,
    questionCount: view.questions.length, verificationRecipient: view.verification?.recipient ?? null, verificationRetry: view.verification?.retry,
    browserVerification: Boolean(view.browserVerification),
  }) : null;
  const busy = pending || Boolean(saved);
  const applicationHref = `/applications/${applicationId}`;
  /** A button or link for a guided action that does not carry its own form. */
  function actionControl(item: StopAction, primary: boolean) {
    const classes = primary ? guidanceStyles.ctaLink : guidanceStyles.quietLink;
    switch (item.kind) {
      case "TRY_AGAIN":
      case "RESUME":
      case "PAUSE": {
        const done = item.kind === "PAUSE" ? "Paused." : item.kind === "RESUME" ? "Resumed. RoleDawn is starting the form again." : "Trying again. This page updates by itself.";
        return <button key={item.kind} type="button" disabled={busy} onClick={() => control(item.kind === "PAUSE" ? "PAUSE" : "RESUME", done)}>{item.label}</button>;
      }
      case "EMPLOYER_PAGE":
        return employerUrl ? <a key={item.kind} className={classes} href={employerUrl} rel="noreferrer" target="_blank">{item.label} ↗</a> : null;
      case "REFRESH_FILES":
      case "OPEN_APPLICATION":
      case "OPEN_PROFILE":
        return linkToApplication || item.href ? <Link key={item.kind} className={classes} href={item.href ?? applicationHref}>{item.label}</Link> : null;
      default: return null;
    }
  }
  const primary = guidance?.primary ?? null;
  const secondary = guidance?.secondary ?? null;
  // A primary action that is a plain button sits directly in the card so it takes the call-to-action style.
  const primaryControl = primary && ["TRY_AGAIN", "RESUME", "EMPLOYER_PAGE", "REFRESH_FILES", "OPEN_APPLICATION", "OPEN_PROFILE"].includes(primary.kind) ? actionControl(primary, true) : null;
  const secondaryControl = secondary ? actionControl(secondary, false) : null;
  const showControls = Boolean(secondaryControl || guidance?.canCancel);
  return <section className={styles.card} aria-labelledby="application-autopilot-heading">
    <h2 id="application-autopilot-heading">{guidance?.heading ?? "Apply for me"}</h2>
    {view && guidance ? <>
      {showHappened ? <p role="status">{guidance.happened}</p> : null}
      <p className={guidanceStyles.next} role={showHappened ? undefined : "status"}>{guidance.next}</p>
    </> : <>
      {startBlockedReason ? <p id="application-autopilot-unavailable">{startBlockedReason}</p> : <>
        <p>RoleDawn will apply to this job using these files and your approved details. If an answer is missing, we’ll ask you here.</p>
        <p className={styles.hint}>This authorizes one application to this employer. You can pause or cancel before submission begins.</p>
      </>}
      <button type="button" disabled={!canStart || Boolean(startBlockedReason) || busy} aria-describedby={startBlockedReason ? "application-autopilot-unavailable" : undefined} onClick={delegate}>{pending ? "Starting…" : "Apply for me"}</button>
    </>}
    {view?.browserVerification ? <div className={styles.verificationBrowser}>
      <iframe title="Complete employer verification in RoleDawn" src={`/applications/${applicationId}/verification-browser`}
        referrerPolicy="no-referrer" />
      <p className={styles.hint}>This form stays open for up to 5 minutes. Complete only the verification check; RoleDawn handles sending.</p>
    </div> : null}
    {view?.verification ? <form onSubmit={verify}>
      <div className={styles.field}>
        <label htmlFor="autopilot-verification-code">Verification code</label>
        <input id="autopilot-verification-code" name="code" value={code} onChange={(event) => setCode(event.target.value)} required
          autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={12} disabled={busy}
          aria-describedby="autopilot-verification-hint" />
      </div>
      <p id="autopilot-verification-hint" className={styles.hint}>It’s 8 characters, and it expires about 10 minutes after the email arrives. Check spam if you don’t see it.</p>
      <button type="submit" disabled={busy}>{pending ? "Sending…" : guidance?.primary.label ?? "Send code"}</button>
    </form> : null}
    {view?.status === "WAITING_ANSWERS" && view.questions.length > 0 ? <form onSubmit={answer}>
      <fieldset className={styles.fields} disabled={busy}>
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
            {question.reasonCode === "SENSITIVE_REQUIRES_CANDIDATE" ? <span className={styles.hint}>Only you can answer this one. RoleDawn never guesses it.</span> : null}
            {isInvalid ? <span id={errorId} className={styles.error}>Enter an answer using the choices shown.</span> : null}
          </div>;
        })}
      </fieldset>
      <p className={styles.hint}>Your answers go to RoleDawn for this application only. It types them into the form and continues.</p>
      <button type="submit" disabled={busy}>{pending ? "Sending…" : guidance?.primary.label ?? "Send answers"}</button>
    </form> : null}
    {primaryControl}
    {showControls ? <div className={styles.controls}>
      {secondaryControl}
      {guidance?.canCancel ? <button type="button" disabled={busy} onClick={() => control("CANCEL", "Canceled.")}>Cancel application</button> : null}
    </div> : null}
    {guidance?.code ? <details className={guidanceStyles.details}>
      <summary>Details</summary>
      <p>Reference: <code>{guidance.code}</code>{summary && summary.transientRetries > 0 ? ` · RoleDawn retried ${summary.transientRetries} time${summary.transientRetries === 1 ? "" : "s"} on its own` : ""}</p>
    </details> : null}
    {saved ? <p role="status">{saved}</p> : null}
    {message ? <p className={styles.error} role="alert">{message}</p> : null}
  </section>;
}
