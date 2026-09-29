"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { setAccountAutoApply } from "@/app/dashboard/actions";
import { saveCandidateSearchProfileAction } from "@/app/onboarding/actions";
import { queueCatalogJobAction } from "@/app/opportunities/actions";
import { SearchGoals } from "@/components/onboarding/SearchGoals";
import type { AuthenticatedDashboardData } from "@/domain/dashboard-queue";
import styles from "./AutoApplyPanel.module.css";

const OUTCOME_COPY: Readonly<Record<string, string>> = {
  PREPARED: "Preparing a matched application.",
  DELEGATED: "An application is queued for delivery.",
  WAITING_APPLICATION: "Finishing the current application before choosing another.",
  NO_MATCHES: "Waiting for a strong match that supports auto-apply. New imports are checked automatically.",
  RANKING_INCOMPLETE: "The catalog check is incomplete. Sending waits until it finishes.",
  RATE_LIMITED: "Waiting for the next available hour.",
  CHECK_FAILED: "The last check failed. RoleDawn will try the check again.",
  PROFILE_CHANGED: "Your profile or preferences changed. Turn auto-apply on again to use the updated information.",
  PAUSED: "New automatic applications are paused.",
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export function AutoApplyPanel({ data }: { data: AuthenticatedDashboardData }) {
  const router = useRouter();
  const noteId = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [showAllMatches, setShowAllMatches] = useState(false);
  const state = data.autoApply;
  const matches = data.recommendations;

  function toggle() {
    if (!state) return;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await setAccountAutoApply({ commandId: crypto.randomUUID(), expectedVersion: state.version, enabled: !state.enabled });
        if (!result.ok) setMessage(result.message);
        router.refresh();
      } catch { setMessage("Connection interrupted. Refresh to check whether auto-apply changed."); }
    });
  }

  function addJob(jobId: string, jobVersionId: string) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await queueCatalogJobAction({ commandId: crypto.randomUUID(), jobId, jobVersionId });
        if (!result.ok) { setMessage(result.error.message); return; }
        router.push(`/applications/${result.value.applicationId}`);
      } catch { setMessage("Connection interrupted. Check your applications before trying again."); }
    });
  }

  return (
    <section className={styles.panel} aria-labelledby="auto-apply-heading">
      <div className={styles.control}>
        <div>
          <div className={styles.titleLine}>
            <h2 id="auto-apply-heading">Auto-apply</h2>
            <span className={state?.enabled ? styles.active : styles.off}>{!state ? "Unavailable" : state.enabled ? "On" : state.status === "PAUSED_PROFILE_CHANGED" ? "Paused" : "Off"}</span>
          </div>
          <p id={noteId}>Find strong matches, tailor your résumé and cover letter, and submit applications using your approved profile.</p>
        </div>
        <button aria-checked={state?.enabled ?? false} aria-describedby={noteId} aria-label="Auto-apply" className={styles.toggle} disabled={pending || !state} onClick={toggle} role="switch" type="button">
          <span aria-hidden="true" />
        </button>
      </div>
      {state ? <>
        <div className={styles.stats}>
          <span><strong>1 per hour</strong> maximum · {state.dailyCap} per UTC day</span>
          <span><strong>{state.confirmedToday}</strong> confirmed today</span>
          <span><strong>{state.attemptedToday}</strong> attempted today</span>
        </div>
        <p className={styles.explanation}>{state.enabled
          ? (OUTCOME_COPY[state.lastOutcome ?? ""] ?? "Checking your profile and the latest jobs.")
          : state.status === "PAUSED_PROFILE_CHANGED" ? OUTCOME_COPY.PROFILE_CHANGED
            : "Turning this on authorizes RoleDawn to submit matched applications for you. Pause it anytime."}</p>
        {state.enabled && state.nextSubmissionAt ? <p className={styles.timing}>Earliest next attempt: {dateLabel(state.nextSubmissionAt)}. Preparation or employer questions can take longer.</p> : null}
        <p className={styles.note}>Missing facts, sign-ins, and CAPTCHA may need your help. Pausing stops unsent work; RoleDawn still checks any submission already attempted.</p>
      </> : <p className={styles.explanation}>We could not load auto-apply. <button className={styles.textButton} onClick={() => router.refresh()} type="button">Try again</button></p>}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <details className={styles.preferences}>
        <summary>Job preferences <span>{data.searchProfile?.targetRoles.slice(0, 2).join(" · ") || "Choose your target roles"}</span></summary>
        <div className={styles.goals}>
          <p>These preferences guide your shortlist. Saving changes pauses auto-apply so you can turn it back on with the new targets.</p>
          {data.searchProfile && data.preferencesCommandId ? <SearchGoals key={data.searchProfile.aggregateVersion} action={saveCandidateSearchProfileAction} commandId={data.preferencesCommandId} mode="settings" profile={data.searchProfile} /> : <p>Job preferences could not load. Refresh and try again.</p>}
        </div>
      </details>
      <div className={styles.matchesHeader}>
        <div><h3>Matched for you</h3><p>{matches ? `Ranked across ${matches.scannedJobs.toLocaleString("en-US")} current jobs${matches.complete ? "" : " · check incomplete"}.` : "Your shortlist could not load. Refresh to try again."}</p></div>
        <Link href="/search">Browse all jobs →</Link>
      </div>
      {matches?.items.length ? <><ul className={styles.matches} id="matched-jobs">
        {(showAllMatches ? matches.items : matches.items.slice(0, 3)).map(job => <li key={job.jobId}>
          <div className={styles.job}>
            <a href={job.canonicalUrl} rel="noreferrer" target="_blank">{job.title}</a>
            <p>{job.employerName}{job.location ? ` · ${job.location}` : ""}</p>
            <details className={styles.reason}>
              <summary>{job.matching.band === "STRONG" ? "Strong match" : "Possible match"}{job.matching.autoApplyEligible ? " · Auto-apply eligible" : " · Review needed"}</summary>
              <ul>{[...job.matching.reasons, ...job.matching.reviewReasons].map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
            </details>
          </div>
          {job.queuedApplicationId ? <Link className={styles.add} href={`/applications/${job.queuedApplicationId}`}>View application</Link>
            : <button className={styles.add} disabled={pending} onClick={() => addJob(job.jobId, job.jobVersionId)} type="button">Prepare</button>}
        </li>)}
      </ul>{matches.items.length > 3 ? <button aria-controls="matched-jobs" aria-expanded={showAllMatches} className={styles.more} onClick={() => setShowAllMatches(value => !value)} type="button">{showAllMatches ? "Show fewer matches" : "Show more matches"}</button> : null}</> : matches ? <p className={styles.noMatches}>No strong matches yet. Check your job preferences and approved experience. New imports will be assessed as they arrive.</p> : null}
    </section>
  );
}
