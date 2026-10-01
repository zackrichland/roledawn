"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  authorizeApplicationFillAction,
  resumeApplicationFillAction,
} from "@/app/(candidate)/applications/[applicationId]/actions";
import type { ApplicationStatus } from "@/domain/dashboard-queue";
import type {
  ApplicationArtifactDTO,
  ApplicationFillAttemptDTO,
  ApplicationFillResumeAttemptDTO,
  ApplicationRevisionDTO,
  ComputerSessionDTO,
} from "@/server/dashboard/queue";

import styles from "./ApplicationFillAuthorization.module.css";

const RELEASED_VARIANTS = new Set([
  "RESUME_PDF",
  "RESUME_DOCX",
  "COVER_LETTER_PDF",
  "COVER_LETTER_DOCX",
]);

function resumeChangeLabel(diff: ApplicationRevisionDTO["materialDiff"]): string {
  switch (diff.resumeMode) {
    case "AS_UPLOADED":
      return "Your reviewed résumé is unchanged.";
    case "REORDER_AND_TIGHTEN":
      return diff.resumeChanged === false
        ? "Your reviewed résumé is unchanged."
        : "Your résumé was reordered and tightened using your approved profile information.";
    case "REWRITE_FROM_VERIFIED_FACTS":
      return diff.resumeChanged === false
        ? "Your reviewed résumé is unchanged."
        : "Your résumé was rewritten using facts you approved.";
    default:
      return "Résumé change details are unavailable.";
  }
}

function fillStateCopy(
  status: ApplicationStatus,
  fillAttempt: ApplicationFillAttemptDTO | null,
  computerSession: ComputerSessionDTO | null,
  fillResumeAttempt: ApplicationFillResumeAttemptDTO | null,
): Readonly<{ label: string; detail: string; tone: "working" | "ready" | "attention" | "neutral" }> | null {
  if (fillResumeAttempt?.status === "QUEUED") {
    return {
      label: "Continuing secure browser",
      detail: "RoleDawn is checking the same form again and will still stop before Submit.",
      tone: "working",
    };
  }
  if (status === "AUTHORIZED") {
    return {
      label: "Fill queued",
      detail: "Your reviewed files are queued for form filling. Submit is locked.",
      tone: "working",
    };
  }
  if (status === "EXECUTING") {
    return {
      label: computerSession?.state === "PROVISIONING" ? "Starting secure browser" : "Filling form",
      detail: "RoleDawn is entering approved information and will stop before Submit.",
      tone: "working",
    };
  }
  if (status === "PRE_SUBMIT_REVIEW" || fillAttempt?.status === "FILLED_TO_REVIEW") {
    return {
      label: "Ready for your review",
      detail: "The employer form was filled, but it was not submitted.",
      tone: "ready",
    };
  }
  if (status === "TAKEOVER" || fillAttempt?.status === "TAKEOVER") {
    const browserOpen = computerSession?.state === "ACTIVE" || computerSession?.state === "PAUSED_FOR_REVIEW";
    return browserOpen
      ? {
          label: "Needs your help",
          detail: "The browser stopped at a protected or unknown step. Nothing was submitted.",
          tone: "attention",
        }
      : {
          label: "Form session closed",
          detail: "The earlier form session closed before submission. Your documents remain here; use the current send controls to continue.",
          tone: "attention",
        };
  }
  if (fillAttempt?.status === "FAILED_SAFE" || status === "FAILED_SAFE") {
    return {
      label: "Fill stopped safely",
      detail: "RoleDawn stopped without submitting the application.",
      tone: "attention",
    };
  }
  if (fillAttempt?.status === "CANCELED" || status === "CANCELED") {
    return {
      label: "Fill canceled",
      detail: "This fill is closed. Nothing was submitted.",
      tone: "neutral",
    };
  }
  return null;
}

export function ApplicationFillAuthorization({
  aggregateVersion,
  applicationId,
  artifacts,
  destinationHost,
  fillAttempt,
  fillResumeAttempt,
  computerSession,
  revision,
  status,
}: Readonly<{
  aggregateVersion: number;
  applicationId: string;
  artifacts: readonly ApplicationArtifactDTO[];
  destinationHost: string;
  fillAttempt: ApplicationFillAttemptDTO | null;
  fillResumeAttempt: ApplicationFillResumeAttemptDTO | null;
  computerSession: ComputerSessionDTO | null;
  revision: ApplicationRevisionDTO;
  status: ApplicationStatus;
}>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [candidateCompletedRequiredFields, setCandidateCompletedRequiredFields] = useState(false);
  const [isPending, startTransition] = useTransition();
  const releasedFiles = artifacts.filter((artifact) => RELEASED_VARIANTS.has(artifact.variant));
  const releasedVariants = new Set(releasedFiles.map((artifact) => artifact.variant));
  const hasExactFileSet = releasedFiles.length === RELEASED_VARIANTS.size &&
    RELEASED_VARIANTS.size === releasedVariants.size &&
    [...RELEASED_VARIANTS].every((variant) => releasedVariants.has(variant)) &&
    releasedFiles.every((artifact) => artifact.qaStatus === "PASSED");
  const hasReadableDiff = revision.materialDiff.resumeMode !== null &&
    revision.materialDiff.resumeChanged !== null &&
    revision.materialDiff.coverLetterCreated &&
    revision.materialDiff.coverLetterParagraphCount !== null;
  const canAuthorize = status === "READY" &&
    revision.validationStatus === "PASSED" &&
    hasExactFileSet &&
    hasReadableDiff;
  const stateCopy = fillStateCopy(
    status,
    fillAttempt,
    computerSession,
    fillResumeAttempt,
  );
  const liveBrowserAvailable = (
    computerSession?.state === "ACTIVE" ||
    computerSession?.state === "PAUSED_FOR_REVIEW"
  );
  const canResume = status === "TAKEOVER" &&
    fillAttempt?.status === "TAKEOVER" &&
    computerSession?.state === "PAUSED_FOR_REVIEW" &&
    fillResumeAttempt?.status !== "QUEUED";

  function authorizeFill() {
    setMessage("");
    startTransition(async () => {
      const result = await authorizeApplicationFillAction({
        commandId: crypto.randomUUID(),
        applicationId,
        expectedAggregateVersion: aggregateVersion,
        expectedRevisionId: revision.id,
        expectedPacketHash: revision.packetHash,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  function resumeFill() {
    if (!fillAttempt || !computerSession || !candidateCompletedRequiredFields) return;
    setMessage("");
    startTransition(async () => {
      const result = await resumeApplicationFillAction({
        commandId: crypto.randomUUID(),
        applicationId,
        expectedAggregateVersion: aggregateVersion,
        fillAttemptId: fillAttempt.id,
        computerSessionId: computerSession.id,
        candidateCompletedRequiredFields: true,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setCandidateCompletedRequiredFields(false);
      router.refresh();
    });
  }

  return (
    <section className={styles.card} aria-labelledby="fill-review-heading">
      <span className={styles.eyebrow}>Form fill</span>
      <h2 id="fill-review-heading">Fill this application for review</h2>
      <p className={styles.intro}>
        RoleDawn can open {destinationHost}, enter approved profile answers, and upload the exact files below.
        It will stop before Submit.
      </p>

      {status === "READY" ? (
        <div className={styles.actionRow}>
          <p>This one-time permission covers form filling only. It does not authorize submission.</p>
          <button disabled={!canAuthorize || isPending} onClick={authorizeFill} type="button">
            {isPending ? "Queuing fill…" : "Fill for my review"}
          </button>
        </div>
      ) : null}

      <div className={styles.changeList}>
        <div>
          <strong>Résumé</strong>
          <span>{resumeChangeLabel(revision.materialDiff)}</span>
        </div>
        <div>
          <strong>Cover letter</strong>
          <span>
            {revision.materialDiff.coverLetterCreated && revision.materialDiff.coverLetterParagraphCount !== null
              ? `Created from approved profile information · ${revision.materialDiff.coverLetterParagraphCount} ${revision.materialDiff.coverLetterParagraphCount === 1 ? "paragraph" : "paragraphs"}`
              : "Cover letter change details are unavailable."}
          </span>
        </div>
      </div>

      <div className={styles.files}>
        <strong>Files this fill may use</strong>
        <ul>
          {releasedFiles.map((artifact) => (
            <li key={artifact.id}>{artifact.displayName}</li>
          ))}
        </ul>
      </div>

      <div className={styles.boundary}>
        <div><strong>May do</strong><span>Fill standard fields and upload these reviewed files.</span></div>
        <div><strong>Must stop</strong><span>Unknown or sensitive questions, CAPTCHA, OTP, and Submit.</span></div>
      </div>

      {stateCopy ? (
        <div className={`${styles.state} ${styles[`state--${stateCopy.tone}`]}`} aria-live="polite">
          <i aria-hidden="true" />
          <span><strong>{stateCopy.label}</strong><small>{stateCopy.detail}</small></span>
        </div>
      ) : null}

      {liveBrowserAvailable ? (
        <div className={styles.liveBrowser}>
          <span>
            <strong>{computerSession.state === "ACTIVE" ? "Secure browser is live" : "Secure browser needs you"}</strong>
            <small>
              Open the current employer form to watch or help. Submit remains blocked; this permission is still fill-only.
            </small>
          </span>
          <a
            href={`/applications/${encodeURIComponent(applicationId)}/live-view`}
            rel="noreferrer"
            target="_blank"
          >
            Open live browser
          </a>
        </div>
      ) : null}

      {canResume ? (
        <div className={styles.resumeControl}>
          <label>
            <input
              checked={candidateCompletedRequiredFields}
              onChange={(event) => setCandidateCompletedRequiredFields(event.target.checked)}
              type="checkbox"
            />
            <span>I completed the required questions in the secure browser.</span>
          </label>
          <button
            disabled={!candidateCompletedRequiredFields || isPending}
            onClick={resumeFill}
            type="button"
          >
            {isPending ? "Continuing…" : "Continue filling"}
          </button>
          <small>RoleDawn will use the same browser and the same reviewed files. Submit stays blocked.</small>
        </div>
      ) : null}

      {status === "READY" && !canAuthorize ? (
        <p className={styles.error} role="alert">
          Review downloads are incomplete. RoleDawn will not release this application for filling.
        </p>
      ) : null}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
    </section>
  );
}
