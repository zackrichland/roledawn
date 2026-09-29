import Link from "next/link";
import type { ReactNode } from "react";

import type {
  ApplicationInputBlocker as ApplicationPreparationBlocker,
  ApplicationPreparationReadiness,
  ApplicationPreparationStage,
} from "@/domain/application-input-snapshot";

import styles from "./ApplicationPreparationPanel.module.css";

export type ApplicationPreparationPanelProps = Readonly<{
  readiness: ApplicationPreparationReadiness | null;
  stage: ApplicationPreparationStage | null;
  blockers: readonly ApplicationPreparationBlocker[];
  retryControl?: ReactNode;
}>;

type PanelCopy = Readonly<{
  eyebrow: string;
  title: string;
  detail: string;
  tone: "working" | "ready" | "complete";
}>;

const STAGE_COPY: Readonly<Record<Exclude<ApplicationPreparationStage, "BLOCKED">, PanelCopy>> = {
  QUEUED: {
    eyebrow: "Preparing",
    title: "Waiting to start",
    detail: "RoleDawn starts on this in a moment. Nothing has been sent.",
    tone: "working",
  },
  FREEZING_INPUTS: {
    eyebrow: "Preparing",
    title: "Checking your profile",
    detail: "Picking the parts of your résumé and stories that fit this job. RoleDawn pauses rather than guess.",
    tone: "working",
  },
  INPUTS_READY: {
    eyebrow: "Preparing",
    title: "Profile locked in",
    detail: "RoleDawn saved exactly what it will use for this job. Writing starts next.",
    tone: "ready",
  },
  RESEARCHING: {
    eyebrow: "Preparing",
    title: "Researching the company",
    detail: "Reading the posting and the company's own pages to learn what this hire has to solve.",
    tone: "working",
  },
  DRAFTING: {
    eyebrow: "Preparing",
    title: "Writing",
    detail: "Writing your résumé, cover letter, and short answers from your profile.",
    tone: "working",
  },
  VALIDATING: {
    eyebrow: "Preparing",
    title: "Fact-checking",
    detail: "Checking every sentence against your profile and the research. Anything unsupported is rewritten or removed.",
    tone: "working",
  },
  RENDERING: {
    eyebrow: "Preparing",
    title: "Laying out your documents",
    detail: "Turning the checked drafts into PDF and Word files.",
    tone: "working",
  },
  COMPLETE: {
    eyebrow: "Preparing",
    title: "Documents ready",
    detail: "Review them below.",
    tone: "complete",
  },
};

const DEFAULT_COPY: PanelCopy = {
  eyebrow: "Preparing",
  title: "Getting started",
  detail: "RoleDawn checks the job and your profile first.",
  tone: "working",
};

function BlockedPreparation({
  blockers,
  retryControl,
}: Readonly<{
  blockers: readonly ApplicationPreparationBlocker[];
  retryControl?: ReactNode;
}>) {
  return (
    <section className={`${styles.panel} ${styles.panelAttention}`} aria-labelledby="application-preparation-heading">
      <header className={styles.header}>
        <span className={`${styles.statusDot} ${styles.statusDotAttention}`} aria-hidden="true" />
        <div>
          <span className={styles.eyebrow}>Paused</span>
          <h2 id="application-preparation-heading">Your profile needs one thing first</h2>
          <p>RoleDawn won&apos;t write from missing or unconfirmed information. Fix the item below and it picks up where it left off.</p>
        </div>
      </header>

      {blockers.length > 0 ? (
        <ul className={styles.blockerList}>
          {blockers.map((blocker) => (
            <li className={styles.blocker} key={blocker.code}>
              <div>
                <strong>{blocker.title}</strong>
                <p>{blocker.detail}</p>
              </div>
              <Link className={styles.action} href={blocker.actionHref}>{blocker.actionLabel}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.fallbackAction}>
          <p>Open your profile to check what this application needs.</p>
          <Link className={styles.action} href="/vault">Open profile</Link>
        </div>
      )}
      {retryControl}
    </section>
  );
}

export function ApplicationPreparationPanel({
  blockers,
  readiness,
  retryControl,
  stage,
}: ApplicationPreparationPanelProps) {
  const isBlocked = readiness === "BLOCKED" || stage === "BLOCKED" || blockers.length > 0;
  if (isBlocked) return <BlockedPreparation blockers={blockers} retryControl={retryControl} />;

  const copy = stage ? STAGE_COPY[stage] : readiness === "READY_FOR_DRAFTING"
    ? STAGE_COPY.INPUTS_READY
    : DEFAULT_COPY;

  return (
    <section
      className={`${styles.panel} ${styles[`panel${copy.tone === "working" ? "Working" : copy.tone === "ready" ? "Ready" : "Complete"}`]}`}
      aria-labelledby="application-preparation-heading"
    >
      <header className={styles.header}>
        <span className={`${styles.statusDot} ${styles[`statusDot${copy.tone === "working" ? "Working" : copy.tone === "ready" ? "Ready" : "Complete"}`]}`} aria-hidden="true" />
        <div>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h2 id="application-preparation-heading">{copy.title}</h2>
          <p>{copy.detail}</p>
        </div>
      </header>
    </section>
  );
}
