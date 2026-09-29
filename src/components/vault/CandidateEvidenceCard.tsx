"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_CANDIDATE_EVIDENCE_REVIEW_ACTION_STATE,
  type CandidateEvidenceItemView,
  type CandidateEvidenceReviewFormAction,
} from "@/domain/candidate-evidence";

import ui from "@/components/app/ui.module.css";

import styles from "./CandidateEvidence.module.css";

type CandidateEvidenceCardProps = Readonly<{
  action: CandidateEvidenceReviewFormAction;
  commandId: string;
  item: CandidateEvidenceItemView;
}>;

function status(item: CandidateEvidenceItemView): Readonly<{ label: string; tone: string }> {
  if (item.reviewStatus === "NEEDS_REVIEW") return { label: "Waiting for you", tone: ui["tone-attention"] };
  if (item.reviewStatus === "REJECTED") return { label: "Hidden", tone: ui["tone-neutral"] };
  if (item.usagePolicy === "DO_NOT_USE") return { label: "Hidden", tone: ui["tone-neutral"] };
  if (item.usagePolicy === "COVER_LETTER_ONLY") return { label: "Letters only", tone: ui["tone-ready"] };
  return { label: "In use", tone: ui["tone-done"] };
}

export function CandidateEvidenceCard({
  action,
  commandId,
  item,
}: CandidateEvidenceCardProps) {
  const [state, formAction, pending] = useActionState(
    action,
    EMPTY_CANDIDATE_EVIDENCE_REVIEW_ACTION_STATE,
  );
  const [claimText, setClaimText] = useState(item.claimText);
  const commandInput = useRef<HTMLInputElement>(null);
  const currentStatus = status(item);
  const edited = useMemo(
    () => claimText.trim() !== item.sourceExcerpt,
    [claimText, item.sourceExcerpt],
  );

  useEffect(() => {
    if (state.outcome === "success" && commandInput.current) {
      commandInput.current.value = crypto.randomUUID();
    }
  }, [state.message, state.outcome]);

  return (
    <article className={styles.evidenceCard}>
      <form action={formAction}>
        <input name="commandId" ref={commandInput} type="hidden" value={commandId} />
        <input name="evidenceItemId" type="hidden" value={item.evidenceItemId} />
        <input name="expectedAggregateVersion" type="hidden" value={item.aggregateVersion} />

        <header className={styles.cardHeader}>
          <span className={styles.category}>{item.categoryLabel}</span>
          <span className={`${ui.chip} ${currentStatus.tone}`}>{currentStatus.label}</span>
        </header>

        <label className={ui.srOnly} htmlFor={`claim-${item.evidenceItemId}`}>
          Line RoleDawn may use
        </label>
        <textarea
          disabled={pending}
          id={`claim-${item.evidenceItemId}`}
          maxLength={4_000}
          name="claimText"
          onChange={(event) => setClaimText(event.target.value)}
          required
          rows={Math.min(8, Math.max(3, Math.ceil(claimText.length / 92)))}
          value={claimText}
        />

        <details className={styles.sourceDetails}>
          <summary>Show the original line</summary>
          <blockquote>{item.sourceExcerpt}</blockquote>
        </details>

        <div className={styles.reviewControls}>
          <label>
            <span className={ui.srOnly}>Where it can appear</span>
            <select className={ui.select} defaultValue={item.usagePolicy} disabled={pending} name="usagePolicy">
              <option value="RESUME_AND_COVER_LETTER">Résumé and cover letters</option>
              <option value="COVER_LETTER_ONLY">Cover letters only</option>
              <option value="DO_NOT_USE">Don&apos;t use</option>
            </select>
          </label>
          {edited ? (
            <label className={styles.attestation}>
              <input disabled={pending} name="candidateAttested" type="checkbox" value="yes" />
              <span>My edited wording is accurate.</span>
            </label>
          ) : null}
        </div>

        {state.message ? (
          <p
            className={state.outcome === "error" ? styles.actionError : styles.actionSuccess}
            role={state.outcome === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        ) : null}

        <footer className={styles.cardFooter}>
          <button className={`${ui.quiet} ${ui.small}`} disabled={pending} name="intent" type="submit" value="reject">
            Hide
          </button>
          <button className={`${ui.primary} ${ui.small}`} disabled={pending} name="intent" type="submit" value="save">
            {pending ? "Saving…" : item.reviewStatus === "NEEDS_REVIEW" ? "Use this line" : "Save"}
          </button>
        </footer>
      </form>
    </article>
  );
}
