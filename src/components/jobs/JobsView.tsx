"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { applyToCatalogJobAction } from "@/app/(candidate)/apply-actions";
import { getJobDetailAction } from "@/app/(candidate)/search/job-actions";
import { saveCatalogJobAction } from "@/app/opportunities/actions";
import { useClientNow } from "@/components/app/useClientNow";
import { CompanyLogo } from "@/components/app/CompanyLogo";
import { useReviewFirst } from "@/components/app/useReviewFirst";
import type { OpportunityCatalogDTO } from "@/domain/opportunity-catalog";
import type { JobDetail, JobListItem } from "@/server/opportunities/jobs-view";

import styles from "./JobsView.module.css";

export type JobsMode = "FOR_YOU" | "SEARCH" | "SAVED";

function titleCase(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("_", " ").replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

function meta(item: Pick<JobListItem, "location" | "workMode" | "employmentType">): string[] {
  const parts = [
    item.location,
    item.workMode && item.workMode !== "UNKNOWN" ? titleCase(item.workMode) : null,
    item.employmentType && !["UNSPECIFIED", "UNKNOWN", "OTHER"].includes(item.employmentType) ? titleCase(item.employmentType) : null,
  ].filter((value): value is string => Boolean(value));
  // "Remote · Remote" reads as a glitch: keep each fact once.
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLocaleLowerCase("en-US");
    if (seen.has(key) || (key === "remote" && [...seen].some((value) => value.includes("remote")))) return false;
    seen.add(key);
    return true;
  });
}

/** The most specific reason: experience beats "matches a role you chose". */
function bestReason(reasons: readonly string[]): string | null {
  return reasons.find((reason) => /experience|skills?|you(?:'ve| have) (?:done|led|built)/iu.test(reason)) ?? reasons[0] ?? null;
}

function posted(now: Date | null, value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  if (!now) return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  const days = Math.floor((now.valueOf() - date.valueOf()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 45) return `${Math.floor(days / 7)}w ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function tint(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function fromCatalog(item: OpportunityCatalogDTO["items"][number]): JobListItem {
  const flat = item.description.replace(/\s+/gu, " ").trim();
  return {
    jobId: item.jobId,
    jobVersionId: item.jobVersionId,
    title: item.title,
    employerName: item.employerName,
    location: item.location,
    workMode: item.workMode,
    employmentType: item.employmentType,
    postedAt: item.publishedAt ?? item.observedAt,
    // The apply URL stays on the ATS host that identifies the employer's board (and its logo); the canonical URL can be an employer domain.
    url: item.applyUrl,
    applicationId: item.queuedApplicationId,
    saved: item.saved,
    reasons: item.fit?.decision === "ADMIT" ? item.fit.reasons.slice(0, 3) : [],
    strong: item.fit?.decision === "ADMIT",
    excerpt: flat.length <= 240 ? flat : `${flat.slice(0, 237).trimEnd()}…`,
  };
}

function Logo({ name, url, size = 40 }: Readonly<{ name: string; url: string; size?: number }>) {
  return (
    <CompanyLogo name={name} postingUrl={url} className={styles.logo} style={{ ["--h" as string]: tint(name), width: size, height: size }} />
  );
}

export function JobsView({ mode, items: initialItems, query, totalOpen, nextCursor: initialCursor, unavailable }: Readonly<{
  mode: JobsMode;
  items: readonly JobListItem[];
  query: string;
  totalOpen: number | null;
  nextCursor?: string | null;
  unavailable?: boolean;
}>) {
  const router = useRouter();
  const now = useClientNow();
  const [reviewFirst, setReviewFirst] = useReviewFirst();
  const [items, setItems] = useState<readonly JobListItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Readonly<{ text: string; href?: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(query);
  const [, startTransition] = useTransition();
  const sheet = useRef<HTMLDivElement>(null);

  const open = items.find((item) => item.jobId === openId) ?? null;

  const closeSheet = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, closeSheet]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function show(item: JobListItem) {
    setOpenId(item.jobId);
    setDetail(null);
    setDetailError(null);
    startTransition(async () => {
      const result = await getJobDetailAction(item.jobVersionId);
      if (result.ok) setDetail(result.job);
      else setDetailError(result.message);
    });
    window.setTimeout(() => sheet.current?.focus(), 30);
  }

  function update(jobId: string, patch: Partial<JobListItem>) {
    setItems((current) => current.map((item) => (item.jobId === jobId ? { ...item, ...patch } : item)));
  }

  function apply(item: JobListItem) {
    if (busy || item.applicationId) return;
    setBusy(`apply:${item.jobId}`);
    setError(null);
    startTransition(async () => {
      const result = await applyToCatalogJobAction({
        commandId: crypto.randomUUID(),
        sendCommandId: crypto.randomUUID(),
        jobId: item.jobId,
        jobVersionId: item.jobVersionId,
        sendWhenReady: !reviewFirst,
      });
      setBusy(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      update(item.jobId, { applicationId: result.applicationId });
      setToast({ text: reviewFirst ? `Preparing ${item.title}. It's in your queue for review.` : `Applying to ${item.title}. Track it on Home.`, href: "/dashboard" });
    });
  }

  function toggleSave(item: JobListItem) {
    if (busy) return;
    setBusy(`save:${item.jobId}`);
    startTransition(async () => {
      const result = await saveCatalogJobAction({ commandId: crypto.randomUUID(), jobId: item.jobId, jobVersionId: item.jobVersionId, saved: !item.saved });
      setBusy(null);
      if (!result.ok) { setError(result.error.message); return; }
      update(item.jobId, { saved: result.value.saved });
    });
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor });
      if (query) params.set("q", query);
      if (mode === "SAVED") params.set("saved", "true");
      const response = await fetch(`/api/opportunities?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load");
      const page = await response.json() as OpportunityCatalogDTO;
      setItems((current) => {
        const known = new Set(current.map((item) => item.jobId));
        return [...current, ...page.items.filter((item) => !known.has(item.jobId)).map(fromCatalog)];
      });
      setCursor(page.nextCursor);
    } catch {
      setError("More jobs couldn't load. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    router.push(value ? `/search?q=${encodeURIComponent(value)}` : "/search");
  }

  const heading = mode === "SEARCH" ? `Results for “${query}”` : mode === "SAVED" ? "Saved jobs" : "Picked for you";

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div>
          <h1>Jobs</h1>
          <p>{totalOpen ? `${totalOpen.toLocaleString("en-US")} open roles from the companies RoleDawn tracks.` : "Open roles from the companies RoleDawn tracks."} Tap one to read it; Apply sends it to your queue.</p>
        </div>
      </header>

      <form className={styles.search} onSubmit={submitSearch} role="search">
        <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
        <label className={styles.srOnly} htmlFor="job-search">Search all jobs</label>
        <input id="job-search" onChange={(event) => setSearch(event.target.value)} placeholder="Search all jobs by title, company, or skill" type="search" value={search} />
        {query ? <Link className={styles.clear} href="/search">Clear</Link> : null}
        <button type="submit">Search</button>
      </form>

      <div className={styles.bar}>
        {mode === "SEARCH" ? (
          <p className={styles.resultsFor}>{heading}</p>
        ) : (
          <nav aria-label="Job lists" className={styles.tabs}>
            <Link aria-current={mode === "FOR_YOU" ? "page" : undefined} href="/search">For you</Link>
            <Link aria-current={mode === "SAVED" ? "page" : undefined} href="/saved">Saved</Link>
          </nav>
        )}
        <label className={styles.reviewToggle}>
          <input checked={reviewFirst} onChange={(event) => setReviewFirst(event.target.checked)} type="checkbox" />
          <span className={styles.miniSwitch} aria-hidden="true" />
          <span>Review before it&apos;s sent</span>
        </label>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {unavailable ? (
        <div className={styles.empty}>
          <strong>{mode === "FOR_YOU" ? "Your matches are still being ranked." : "Jobs couldn't load."}</strong>
          <span>Refresh in a moment{mode === "FOR_YOU" ? ", or search all jobs above" : ""}.</span>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <strong>{mode === "SEARCH" ? "No jobs match that search." : mode === "SAVED" ? "Nothing saved yet." : "No strong matches yet."}</strong>
          <span>{mode === "FOR_YOU" ? <>Add the roles you want in <Link href="/vault/preferences">Profile → Preferences</Link> and RoleDawn will rank jobs for them.</> : mode === "SAVED" ? "Bookmark a job to keep it here." : "Try a different title or company."}</span>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item, index) => {
            const inQueue = Boolean(item.applicationId);
            return (
              <li className={styles.row} key={item.jobId} style={{ ["--i" as string]: Math.min(index, 14) }}>
                <button aria-label={`Read ${item.title} at ${item.employerName}`} className={styles.rowButton} onClick={() => show(item)} type="button" />
                <Logo name={item.employerName} url={item.url} />
                <div className={styles.rowMain}>
                  <div className={styles.titleLine}>
                    <strong>{item.title}</strong>
                    {item.strong ? <span className={styles.fit}>Strong fit</span> : null}
                  </div>
                  <span className={styles.rowMeta}><b>{item.employerName}</b>{meta(item).map((part, at) => <span key={`${at}:${part}`}> · {part}</span>)}</span>
                  {bestReason(item.reasons) ? <span className={styles.reason}>{bestReason(item.reasons)}</span> : null}
                </div>
                <span className={styles.when}>{posted(now, item.postedAt)}</span>
                <div className={styles.rowActions}>
                  <button
                    aria-label={item.saved ? "Unsave" : "Save"}
                    aria-pressed={item.saved}
                    className={styles.save}
                    disabled={busy === `save:${item.jobId}`}
                    onClick={() => toggleSave(item)}
                    type="button"
                  >
                    <svg aria-hidden="true" fill={item.saved ? "currentColor" : "none"} height="18" viewBox="0 0 24 24" width="18"><path d="M6 3h12v18l-6-4-6 4V3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>
                  </button>
                  {inQueue ? (
                    <Link className={styles.queued} href={`/applications/${item.applicationId}`}>
                      <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m5 12 5 5 9-10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" /></svg>
                      In queue
                    </Link>
                  ) : (
                    <button className={styles.apply} disabled={busy === `apply:${item.jobId}`} onClick={() => apply(item)} type="button">
                      {busy === `apply:${item.jobId}` ? <span className={styles.spinner} aria-hidden="true" /> : null}
                      {reviewFirst ? "Prepare" : "Apply"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cursor && mode !== "FOR_YOU" ? (
        <div className={styles.more}>
          <button disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? "Loading…" : "Show more"}</button>
        </div>
      ) : null}

      <div aria-hidden={!open} className={styles.backdrop} data-open={Boolean(open)} onClick={closeSheet} />
      <aside aria-label={open ? `${open.title} at ${open.employerName}` : "Job details"} aria-modal="true" className={styles.sheet} data-open={Boolean(open)} ref={sheet} role="dialog" tabIndex={-1}>
        {open ? (
          <>
            <div className={styles.sheetHead}>
              <button aria-label="Close" className={styles.close} onClick={closeSheet} type="button">
                <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
              </button>
              <div className={styles.sheetCompany}>
                <Logo name={open.employerName} url={open.url} size={48} />
                <span>{open.employerName}</span>
              </div>
              <h2>{open.title}</h2>
              <div className={styles.chips}>
                {meta(detail ?? open).map((part, at) => <span key={`${at}:${part}`}>{part}</span>)}
                {open.postedAt ? <span>Posted {posted(now, open.postedAt).toLowerCase()}</span> : null}
              </div>
              <div className={styles.sheetActions}>
                {open.applicationId ? (
                  <Link className={styles.queuedLarge} href={`/applications/${open.applicationId}`}>
                    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16"><path d="m5 12 5 5 9-10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" /></svg>
                    In your queue · Open
                  </Link>
                ) : (
                  <button className={styles.applyLarge} disabled={busy === `apply:${open.jobId}`} onClick={() => apply(open)} type="button">
                    {busy === `apply:${open.jobId}` ? <span className={styles.spinner} aria-hidden="true" /> : null}
                    {reviewFirst ? "Prepare application" : "Apply"}
                  </button>
                )}
                <button className={styles.secondary} onClick={() => toggleSave(open)} type="button">{open.saved ? "Saved" : "Save"}</button>
                <a className={styles.secondary} href={detail?.applyUrl ?? open.url} rel="noreferrer" target="_blank">View posting ↗</a>
              </div>
            </div>
            <div className={styles.sheetBody}>
              {open.reasons.length ? (
                <section className={styles.why}>
                  <h3>Why it fits</h3>
                  <ul>{open.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </section>
              ) : null}
              <section>
                <h3>About the role</h3>
                {detail ? (
                  <div className={styles.description}>{detail.description}</div>
                ) : detailError ? (
                  <p className={styles.error}>{detailError}</p>
                ) : (
                  <div className={styles.skeleton} aria-label="Loading the job description"><span /><span /><span /><span /><span /></div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </aside>

      <div aria-live="polite" className={styles.toast} data-open={Boolean(toast)}>
        {toast ? (
          <>
            <span>{toast.text}</span>
            {toast.href ? <Link href={toast.href}>View queue</Link> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

export function JobsSkeleton({ mode }: Readonly<{ mode: JobsMode }>) {
  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div>
          <h1>Jobs</h1>
          <p>{mode === "FOR_YOU" ? "Ranking open roles against your résumé and target roles…" : "Loading…"}</p>
        </div>
      </header>
      <div className={styles.searchGhost} />
      <ul className={styles.list} aria-busy="true">
        {Array.from({ length: 6 }, (_, index) => (
          <li className={styles.ghostRow} key={index} style={{ ["--i" as string]: index }}>
            <span className={styles.ghostLogo} />
            <span className={styles.ghostLines}><span /><span /></span>
          </li>
        ))}
      </ul>
    </main>
  );
}
