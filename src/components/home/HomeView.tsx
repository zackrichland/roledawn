"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";

import { applyToJobLinkAction } from "@/app/(candidate)/apply-actions";
import { setAccountAutoApply } from "@/app/dashboard/actions";
import { useClientNow } from "@/components/app/useClientNow";
import { useReviewFirst } from "@/components/app/useReviewFirst";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import type { ApplicationPresentation } from "@/domain/application-presentation";
import { presentHomeApplication } from "@/domain/home-presentation";
import type { HomeApplication, HomeData } from "@/server/home/home-data";

import styles from "./HomeView.module.css";
import { NeedsYouSheet } from "./NeedsYouSheet";

type Filter = "ALL" | "ACTIVE" | "NEEDS_YOU" | "APPLIED";
type Row = Readonly<{ application: HomeApplication; presentation: ApplicationPresentation }>;

const FILTERS: readonly Readonly<{ id: Filter; label: string }>[] = [
  { id: "ALL", label: "All" },
  { id: "ACTIVE", label: "In progress" },
  { id: "NEEDS_YOU", label: "Needs you" },
  { id: "APPLIED", label: "Applied" },
];

function presentationFor(application: HomeApplication): ApplicationPresentation {
  return presentHomeApplication(application);
}

function inFilter(presentation: ApplicationPresentation, filter: Filter): boolean {
  if (filter === "ALL") return true;
  if (filter === "NEEDS_YOU") return presentation.needsYou;
  if (filter === "APPLIED") return presentation.tone === "done";
  return !presentation.needsYou && !presentation.closed && presentation.tone !== "done";
}

function ago(from: Date | null, value: string | number, fallback: string): string {
  if (!from) return fallback;
  const seconds = Math.max(0, Math.round((from.valueOf() - new Date(value).valueOf()) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function initial(value: string | null): string {
  return (value ?? "").trim().slice(0, 1).toUpperCase() || "·";
}

/** Stable, pleasant tint per company so rows are easy to scan. */
function tint(value: string | null): number {
  let hash = 0;
  for (const char of value ?? "") hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function greeting(now: Date | null): string {
  if (!now) return "Your applications";
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function actionFor(row: Row): string {
  if (row.presentation.needsYou) return "Resolve";
  if (row.presentation.tone === "ready") return "Review";
  if (row.presentation.tone === "done") return "Receipt";
  return "View";
}

export function HomeView({ data }: Readonly<{ data: HomeData }>) {
  const router = useRouter();
  const now = useClientNow();
  const [jobUrl, setJobUrl] = useState("");
  const [reviewFirst, setReviewFirst] = useReviewFirst();
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [confirmOn, setConfirmOn] = useState(false);
  const [autopilotError, setAutopilotError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const closeSheet = useCallback(() => setOpenId(null), []);

  const rows = useMemo<readonly Row[]>(() => [...data.applications]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((application) => ({ application, presentation: presentationFor(application) })), [data.applications]);
  const counts = useMemo(() => ({
    applied: rows.filter((row) => row.presentation.tone === "done").length,
    active: rows.filter((row) => inFilter(row.presentation, "ACTIVE")).length,
    needsYou: rows.filter((row) => row.presentation.needsYou).length,
  }), [rows]);
  const visible = rows.filter((row) => inFilter(row.presentation, filter));
  const openRow = openId ? rows.find((row) => row.application.applicationRouteKey === openId) ?? null : null;
  const autopilot = data.autoApply;
  const autopilotOn = autopilot?.enabled === true;
  const working = rows.some((row) => row.presentation.tone === "working" || row.presentation.label === "Sending soon");

  // Highlight rows that arrive while the page is open (autopilot or a new link).
  useEffect(() => {
    const keys = new Set(rows.map((row) => row.application.applicationRouteKey));
    const previous = seen.current;
    seen.current = keys;
    if (!previous) return undefined;
    const arrived = [...keys].filter((key) => !previous.has(key));
    if (arrived.length === 0) return undefined;
    setFresh(new Set(arrived));
    const timer = window.setTimeout(() => setFresh(new Set()), 2400);
    return () => window.clearTimeout(timer);
  }, [rows]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = jobUrl.trim();
    if (!value || pending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await applyToJobLinkAction({
        commandId: crypto.randomUUID(),
        sendCommandId: crypto.randomUUID(),
        jobUrl: value,
        sendWhenReady: !reviewFirst,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setJobUrl("");
      setFilter("ALL");
      router.refresh();
    });
  }

  function setAutopilot(enabled: boolean) {
    if (!autopilot) return;
    setAutopilotError(null);
    setConfirmOn(false);
    startTransition(async () => {
      try {
        const result = await setAccountAutoApply({ commandId: crypto.randomUUID(), expectedVersion: autopilot.version, enabled });
        if (!result.ok) setAutopilotError(result.message);
        router.refresh();
      } catch {
        setAutopilotError("The connection dropped. Refresh to see the current setting.");
      }
    });
  }

  const statusWord = !autopilot ? "Unavailable" : autopilotOn ? (working ? "Applying" : "Watching") : autopilot.status === "PAUSED_PROFILE_CHANGED" ? "Paused" : "Off";

  return (
    <main className={styles.page}>
      <RouteAutoRefresh
        active={data.backendStatus === "available" && (working || autopilotOn)}
        cycleKey={rows.map((row) => `${row.application.applicationRouteKey}:${row.application.status}:${row.application.preparationStage}:${row.application.updatedAt}`).join("|")}
        intervalMs={working ? 6_000 : 30_000}
        maxUnchangedRefreshes={autopilotOn ? Number.POSITIVE_INFINITY : 60}
      />

      <header className={styles.top}>
        <h1>{greeting(now)}{now && data.firstName ? `, ${data.firstName}` : ""}</h1>
        <p>
          {counts.needsYou ? <><strong>{counts.needsYou} need{counts.needsYou === 1 ? "s" : ""} you</strong> · </> : null}
          {counts.active ? `${counts.active} in progress · ` : ""}
          {counts.applied ? `${counts.applied} applied` : autopilotOn ? "Autopilot is looking for your next match" : "Paste a link or turn on autopilot"}
        </p>
      </header>

      <form className={styles.paste} onSubmit={submit}>
        <svg aria-hidden="true" className={styles.pasteIcon} fill="none" height="20" viewBox="0 0 24 24" width="20"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
        <label className={styles.srOnly} htmlFor="job-link">Job link</label>
        <input
          autoComplete="off"
          className={styles.pasteInput}
          id="job-link"
          inputMode="url"
          onChange={(event) => setJobUrl(event.target.value)}
          placeholder="Paste any Greenhouse, Lever, or Ashby job link"
          spellCheck={false}
          type="url"
          value={jobUrl}
        />
        <button className={styles.pasteButton} disabled={pending || !jobUrl.trim()} type="submit">
          {pending && jobUrl ? <span className={styles.spinner} aria-hidden="true" /> : null}
          {reviewFirst ? "Prepare" : "Apply"}
          <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
        </button>
      </form>
      <div className={styles.pasteMeta}>
        <label className={styles.reviewToggle}>
          <input checked={reviewFirst} onChange={(event) => setReviewFirst(event.target.checked)} type="checkbox" />
          <span className={styles.miniSwitch} aria-hidden="true" />
          <span>Let me review before it&apos;s sent</span>
        </label>
        {message ? <p className={styles.error} role="alert">{message}</p> : null}
      </div>

      <section className={styles.queue} aria-labelledby="queue-heading">
        <div className={styles.stats}>
          <div className={styles.stat} style={{ ["--i" as string]: 0 }}>
            <span className={styles.statLabel}>
              <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
              Autopilot
            </span>
            <div className={styles.statusValue}>
              <strong data-state={autopilotOn ? "on" : "off"}>{statusWord}</strong>
              {autopilot ? (
                <button
                  aria-checked={autopilotOn}
                  aria-label="Autopilot"
                  className={styles.switch}
                  disabled={pending}
                  onClick={() => (autopilotOn ? setAutopilot(false) : setConfirmOn((open) => !open))}
                  role="switch"
                  type="button"
                >
                  <span />
                </button>
              ) : null}
            </div>
            {confirmOn ? (
              <div className={styles.confirm} role="dialog" aria-label="Turn on autopilot">
                <p>RoleDawn will apply to your strongest matches for you, one at a time and up to {autopilot?.dailyCap ?? 24} a day, using your profile and saved answers. Turn it off anytime.</p>
                <div>
                  <button className={styles.confirmPrimary} onClick={() => setAutopilot(true)} type="button">Turn on</button>
                  <button className={styles.confirmQuiet} onClick={() => setConfirmOn(false)} type="button">Not now</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className={styles.stat} style={{ ["--i" as string]: 1 }}>
            <span className={styles.statLabel}>
              <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m4 12 5 5L20 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>
              Applied
            </span>
            <strong>{counts.applied}</strong>
          </div>
          <div className={styles.stat} style={{ ["--i" as string]: 2 }}>
            <span className={styles.statLabel}>
              <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="M4 17 9 12l4 4 7-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>
              Sent today
            </span>
            <strong>{autopilot ? `${autopilot.confirmedToday}/${autopilot.dailyCap}` : "—"}</strong>
          </div>
          <div className={styles.stat} style={{ ["--i" as string]: 3 }}>
            <span className={styles.statLabel}>
              <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" /></svg>
              Updated
            </span>
            <strong>{ago(now, data.fetchedAt, "Just now")}</strong>
          </div>
        </div>
        {autopilotError ? <p className={styles.error} role="alert">{autopilotError}</p> : null}

        <div className={styles.tableHead}>
          <h2 id="queue-heading">Applications</h2>
          <div className={styles.segmented} role="tablist" aria-label="Filter applications">
            {FILTERS.map((option) => (
              <button aria-selected={filter === option.id} key={option.id} onClick={() => setFilter(option.id)} role="tab" type="button">
                {option.label}
                {option.id === "NEEDS_YOU" && counts.needsYou ? <span className={styles.count}>{counts.needsYou}</span> : null}
              </button>
            ))}
          </div>
        </div>

        {data.backendStatus === "unavailable" ? (
          <p className={styles.empty}>Your applications couldn&apos;t load. Nothing was lost. <button className={styles.link} onClick={() => router.refresh()} type="button">Try again</button></p>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            {rows.length === 0 ? (
              <>
                <strong>Your queue is empty.</strong>
                <span>Paste a job link above, pick one from <Link href="/search">Jobs</Link>, or turn on autopilot and RoleDawn will start applying to your best matches.</span>
              </>
            ) : <span>Nothing here right now.</span>}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col"><span className={styles.srOnly}>Action</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => {
                  const { application, presentation } = row;
                  const href = `/applications/${application.applicationRouteKey}`;
                  const company = application.company ?? (application.intakeStatus === "FAILED" ? "Job link" : "Reading…");
                  return (
                    <tr
                      className={styles.row}
                      data-fresh={fresh.has(application.applicationRouteKey)}
                      key={application.applicationRouteKey}
                      onClick={() => (presentation.needsYou ? setOpenId(application.applicationRouteKey) : router.push(href))}
                      style={{ ["--i" as string]: Math.min(index, 12) }}
                    >
                      <td>
                        <span className={styles.company}>
                          <span className={styles.logo} style={{ ["--h" as string]: tint(application.company) }} aria-hidden="true">{initial(application.company)}</span>
                          <span>
                            <strong>{company}</strong>
                            {application.autoApplySelected ? <em className={styles.auto}>Autopilot</em> : null}
                          </span>
                        </span>
                      </td>
                      <td>
                        <Link className={styles.role} href={href} onClick={(event) => event.stopPropagation()}>
                          {application.role ?? (application.intakeStatus === "FAILED" ? "Couldn't import this job" : "Reading the job…")}
                        </Link>
                        {application.location ? <span className={styles.sub}>{application.location}</span> : null}
                      </td>
                      <td>
                        <span className={styles.pill} data-tone={presentation.tone} title={presentation.detail}>
                          <i aria-hidden="true" />
                          {presentation.label}
                        </span>
                      </td>
                      <td className={styles.when}>
                        <time dateTime={application.updatedAt} title={shortDate(application.updatedAt)}>{ago(now, application.updatedAt, shortDate(application.updatedAt))}</time>
                      </td>
                      <td className={styles.actionCell}>
                        {presentation.needsYou ? (
                          <button className={styles.action} data-urgent="true" onClick={(event) => { event.stopPropagation(); setOpenId(application.applicationRouteKey); }} type="button">
                            {application.need?.kind === "CODE" ? "Enter code" : application.need?.kind === "ANSWERS" ? "Answer" : actionFor(row)}
                            <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
                          </button>
                        ) : (
                          <Link className={styles.action} href={href} onClick={(event) => event.stopPropagation()}>
                            {actionFor(row)}
                            <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {openRow ? (
        <NeedsYouSheet
          application={openRow.application}
          key={openRow.application.applicationRouteKey}
          onClose={closeSheet}
          presentation={openRow.presentation}
          refreshKey={`${openRow.application.status}:${openRow.application.updatedAt}:${openRow.application.need?.kind ?? ""}`}
        />
      ) : null}
    </main>
  );
}
