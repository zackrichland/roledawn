"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";

import { deleteResumeAction } from "@/app/vault/actions";
import { confirmResumeAction } from "@/app/(candidate)/vault/knowledge-actions";
import ui from "@/components/app/ui.module.css";
import { ResumeUploadForm } from "@/components/vault/ResumeUploadForm";
import { EMPTY_VAULT_ACTION_STATE, type CareerVaultViewModel } from "@/domain/career-vault";

import styles from "./Profile.module.css";
import resume from "./ResumePanel.module.css";

export type ResumeConfirmation = Readonly<{
  /** Lines from the current text review that RoleDawn may use. */
  approvedLines: number;
  linesAwaitingReview: number;
  careerProfile: "READY" | "ORGANIZING" | "FAILED" | "MISSING";
}>;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function RemoveResume({ documentId, aggregateVersion, label }: Readonly<{ documentId: string; aggregateVersion: number; label: string }>) {
  const [state, formAction, pending] = useActionState(deleteResumeAction, EMPTY_VAULT_ACTION_STATE);
  return (
    <details className={resume.remove}>
      <summary>{label}</summary>
      <form action={formAction}>
        <input name="documentId" type="hidden" value={documentId} />
        <input name="expectedAggregateVersion" type="hidden" value={aggregateVersion} />
        <p>This permanently deletes the file and its text from RoleDawn. Applications already prepared keep their own copies.</p>
        <label className={styles.check}>
          <input disabled={pending} name="confirmDelete" required type="checkbox" value="yes" />
          <span>Delete my résumé</span>
        </label>
        {state.message ? <p className={state.outcome === "error" ? ui.noticeError : ui.noticeSuccess} role="status">{state.message}</p> : null}
        <button className={`${ui.secondary} ${ui.small}`} disabled={pending} type="submit">{pending ? "Deleting…" : "Delete permanently"}</button>
      </form>
    </details>
  );
}

export function ResumePanel({ vault, confirmation, nextHref }: Readonly<{
  vault: CareerVaultViewModel;
  confirmation: ResumeConfirmation | null;
  /** Where "Continue" goes after confirming (onboarding passes its next step). */
  nextHref?: string;
}>) {
  const router = useRouter();
  const document = vault.document;
  const [text, setText] = useState(document?.extractedText ?? "");
  const [message, setMessage] = useState<Readonly<{ ok: boolean; text: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const commands = useRef<{ signature: string; approve: string; profile: string } | null>(null);

  const needsReview = vault.status === "needs-review";
  const edited = Boolean(document) && text !== document?.extractedText;
  const confirmed = vault.status === "ready" && !edited && confirmation !== null &&
    confirmation.linesAwaitingReview === 0 && confirmation.careerProfile !== "MISSING";
  const [showText, setShowText] = useState(!confirmed);

  function confirm() {
    if (!document || pending) return;
    const saveText = needsReview || edited;
    const signature = JSON.stringify({ id: document.documentVersionId, text: saveText ? text : null });
    if (commands.current?.signature !== signature) {
      commands.current = { signature, approve: crypto.randomUUID(), profile: crypto.randomUUID() };
    }
    const ids = commands.current;
    setMessage(null);
    startTransition(async () => {
      const result = await confirmResumeAction({
        documentId: document.documentId,
        extractionId: document.extractionId,
        expectedAggregateVersion: document.documentAggregateVersion,
        reviewedText: text,
        saveText,
        approveCommandId: ids.approve,
        profileCommandId: ids.profile,
      });
      setMessage({ ok: result.ok, text: result.ok ? result.message ?? "Done." : result.message });
      if (result.ok) {
        commands.current = null;
        setShowText(false);
        router.refresh();
      }
    });
  }

  if (vault.status === "empty") {
    return (
      <section className={styles.card} aria-labelledby="resume-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="resume-heading">Add your résumé</h2>
            <p>Your most recent one is best. RoleDawn reads it, you check the text, and every application starts from it.</p>
          </div>
        </div>
        <ResumeUploadForm />
        <p className={ui.hint}>Private to you. Uploading doesn&apos;t send anything anywhere.</p>
      </section>
    );
  }

  if (vault.status === "uploading") {
    return (
      <section className={styles.card} aria-live="polite">
        <div className={styles.cardHead}>
          <div>
            <h2><span className={styles.pulse} /> Reading your résumé…</h2>
            <p>If this has been stuck for more than a minute, finish the upload or remove it and try again.</p>
          </div>
        </div>
        {vault.pendingUploadVersionId ? <ResumeUploadForm pendingVersionId={vault.pendingUploadVersionId} /> : null}
        {vault.deletionTarget ? <RemoveResume aggregateVersion={vault.deletionTarget.documentAggregateVersion} documentId={vault.deletionTarget.documentId} label="Remove the unfinished upload" /> : null}
      </section>
    );
  }

  if (vault.status === "error" || !document) {
    return (
      <section className={styles.card} role="alert">
        <div className={styles.cardHead}>
          <div>
            <h2>That résumé couldn&apos;t be read.</h2>
            <p>{vault.errorMessage ?? "Try a different file. A PDF exported from Word or Google Docs works best."}</p>
          </div>
        </div>
        {vault.recoveryKind === "deletion" ? null : <ResumeUploadForm />}
        {vault.deletionTarget ? <RemoveResume aggregateVersion={vault.deletionTarget.documentAggregateVersion} documentId={vault.deletionTarget.documentId} label={vault.recoveryKind === "deletion" ? "Finish removing it" : "Remove it"} /> : null}
      </section>
    );
  }

  const status = needsReview
    ? { label: "Check the text", tone: "attention" }
    : confirmed
      ? { label: "In use", tone: "done" }
      : { label: "Almost ready", tone: "working" };
  const organizing = confirmation?.careerProfile === "ORGANIZING";

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="resume-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="resume-heading">{document.filename}</h2>
            <p>Uploaded {formatDate(document.uploadedAt)}{document.versionNumber > 1 ? ` · version ${document.versionNumber}` : ""}</p>
          </div>
          <span className={`${ui.chip} ${ui[`tone-${status.tone}`]}`}>{status.label}</span>
        </div>

        {confirmed && confirmation ? (
          <div className={resume.summary}>
            <p><strong>{confirmation.approvedLines}</strong> lines from your résumé are ready for RoleDawn to tailor.</p>
            <p>
              {organizing
                ? <><span className={styles.pulse} /> Organizing your roles, dates, and education…</>
                : confirmation.careerProfile === "FAILED"
                  ? <>Your experience couldn&apos;t be organized automatically. <Link href="/vault/experience">Add it yourself</Link>.</>
                  : <>Roles and dates are organized. <Link href="/vault/experience">Check them</Link>.</>}
            </p>
          </div>
        ) : needsReview ? (
          <p className={resume.lead}>
            Read it through once. Fix anything the file reader got wrong, like missing letters or run-together lines.
            RoleDawn writes only from this text, so what&apos;s here is what employers will see.
          </p>
        ) : (
          <p className={resume.lead}>Your text is saved. Confirm it so RoleDawn can start using it.</p>
        )}

        {showText ? (
          <label className={resume.textWrap}>
            <span className={ui.srOnly}>Résumé text</span>
            <textarea
              className={resume.text}
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
              spellCheck
              value={text}
            />
          </label>
        ) : (
          <button className={resume.reveal} onClick={() => setShowText(true)} type="button">View or edit the text</button>
        )}

        {message ? <p className={message.ok ? ui.noticeSuccess : ui.noticeError} role="status">{message.text}</p> : null}

        <div className={styles.actions}>
          {!confirmed || edited ? (
            <button className={ui.cta} disabled={pending || !text.trim()} onClick={confirm} type="button">
              {pending ? "Saving…" : edited && vault.status === "ready" ? "Save and use this version" : "Looks right — use this résumé"}
            </button>
          ) : null}
          {edited ? <button className={ui.quiet} disabled={pending} onClick={() => setText(document.extractedText)} type="button">Undo my edits</button> : null}
          {confirmed && nextHref ? <Link className={ui.cta} href={nextHref}>Continue</Link> : null}
        </div>
        {!confirmed && !needsReview && edited ? <p className={ui.hint}>Saving a new version re-organizes your roles and dates from the new text.</p> : null}
      </section>

      {confirmed && !nextHref ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2>Make your applications stand out</h2>
              <p>A résumé says what you did. Stories say how, and they&apos;re what a hiring manager remembers. Ten minutes with the interviewer is the best thing you can do for your cover letters.</p>
            </div>
          </div>
          <div className={styles.actions}>
            <Link className={ui.primary} href="/vault/interview">Start the interview</Link>
            <Link className={ui.quiet} href="/vault/experience">Check my experience</Link>
          </div>
        </section>
      ) : null}

      <section className={`${styles.card} ${resume.manage}`}>
        <details>
          <summary>Replace with a newer résumé</summary>
          <div className={resume.manageBody}>
            <p className={styles.muted}>RoleDawn keeps your stories and answers. Your roles and résumé lines update from the new file after you confirm it.</p>
            <ResumeUploadForm compact pendingVersionId={vault.pendingUploadVersionId} />
          </div>
        </details>
        <RemoveResume aggregateVersion={document.documentAggregateVersion} documentId={document.documentId} label="Delete my résumé" />
      </section>
    </div>
  );
}
