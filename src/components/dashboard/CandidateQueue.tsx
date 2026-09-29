"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { createPastedLinkApplicationRun } from "@/app/dashboard/actions";
import { AutoApplyPanel } from "@/components/dashboard/AutoApplyPanel";
import { Icon } from "@/components/ui/Icon";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import type {
  ApplicationStatus,
  AuthenticatedDashboardData,
  PersistentQueueApplication,
  QueueStatusFilter,
} from "@/domain/dashboard-queue";
import type { ApplicationPreparationStage } from "@/domain/application-input-snapshot";
import {
  applicationStatusGroup,
  canPresentAsSubmitted,
  isApplicationWorkInProgress,
} from "@/domain/dashboard-queue";

import styles from "./CandidateQueue.module.css";

type StatusPresentation = Readonly<{
  label: string;
  detail: string;
  tone: "neutral" | "working" | "attention" | "ready" | "done";
}>;

const APPLICATION_STATUS_COPY: Record<ApplicationStatus, StatusPresentation> = {
  DRAFTING: { label: "Waiting to start", detail: "RoleDawn will start preparing this application soon.", tone: "working" },
  NEEDS_USER: { label: "Needs you", detail: "RoleDawn needs an answer before it can continue.", tone: "attention" },
  READY: { label: "Ready to review", detail: "The application materials are ready for your review.", tone: "ready" },
  AUTHORIZED: { label: "Queued", detail: "RoleDawn is waiting to continue this application.", tone: "working" },
  EXECUTING: { label: "Working on form", detail: "RoleDawn is entering your approved information.", tone: "working" },
  TAKEOVER: { label: "Needs your help", detail: "Open the application to resolve a question or employer step.", tone: "attention" },
  PRE_SUBMIT_REVIEW: { label: "Review filled form", detail: "The employer form is filled and waiting for you. It was not submitted.", tone: "ready" },
  RECONCILING: { label: "Checking submission", detail: "RoleDawn is verifying what the employer received.", tone: "working" },
  CONFIRMED: { label: "Submitted", detail: "A submission confirmation was recorded.", tone: "done" },
  SKIPPED: { label: "Skipped", detail: "This application will not continue.", tone: "neutral" },
  FAILED_SAFE: { label: "Stopped", detail: "Open the application to see the issue and its recorded outcome.", tone: "attention" },
  CANCELED: { label: "Canceled", detail: "This application was canceled.", tone: "neutral" },
};

const PREPARATION_STAGE_COPY: Readonly<
  Record<ApplicationPreparationStage, StatusPresentation>
> = {
  QUEUED: { label: "Waiting to start", detail: "RoleDawn will start preparing this application soon.", tone: "working" },
  FREEZING_INPUTS: { label: "Checking profile", detail: "RoleDawn is checking your reviewed résumé and experience.", tone: "working" },
  INPUTS_READY: { label: "Ready to write", detail: "RoleDawn has the job details and profile information it needs.", tone: "ready" },
  BLOCKED: { label: "Needs you", detail: "Finish the missing profile review to continue.", tone: "attention" },
  RESEARCHING: { label: "Researching role", detail: "RoleDawn is gathering context for the draft.", tone: "working" },
  DRAFTING: { label: "Writing files", detail: "RoleDawn is writing from your approved profile information.", tone: "working" },
  VALIDATING: { label: "Checking draft", detail: "RoleDawn is checking claims and citations.", tone: "working" },
  RENDERING: { label: "Creating review files", detail: "RoleDawn is preparing files for your review.", tone: "working" },
  COMPLETE: { label: "Files ready", detail: "Open this application to review the files.", tone: "ready" },
};

type QueuePresentationApplication = PersistentQueueApplication & Readonly<{
  preparationStage?: ApplicationPreparationStage | null;
}>;

const STATUS_FILTERS: readonly Readonly<{
  id: QueueStatusFilter;
  label: string;
}>[] = [
  { id: "ALL", label: "All" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "NEEDS_YOU", label: "Needs you" },
  { id: "READY", label: "Ready" },
  { id: "DONE", label: "Done" },
];

function presentStatus(application: QueuePresentationApplication): StatusPresentation {
  if (application.intakeStatus === "FAILED") {
    return {
      label: "Could not read job",
      detail: "Open the application to see what stopped the import.",
      tone: "attention",
    };
  }

  if (application.intakeStatus === "PENDING" || application.intakeStatus === "RESOLVING") {
    return {
      label: application.intakeStatus === "PENDING" ? "Waiting to import" : "Importing job",
      detail: "RoleDawn is reading the official job posting.",
      tone: "working",
    };
  }

  if (
    application.status === "CONFIRMED" &&
    !canPresentAsSubmitted(application.status, application.hasReceipt)
  ) {
    return {
      label: "Receipt missing",
      detail: "Open this application to verify its submission evidence.",
      tone: "attention",
    };
  }

  if (application.status === "DRAFTING" && application.preparationStage) {
    return PREPARATION_STAGE_COPY[application.preparationStage] ?? APPLICATION_STATUS_COPY.DRAFTING;
  }

  if (application.autoApplySelected && application.status === "READY") {
    return { label: "Ready for auto-apply", detail: "Your files are ready. Sending waits for the next available slot and current authorization.", tone: "ready" };
  }

  return APPLICATION_STATUS_COPY[application.status];
}

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function sourceName(sourceUrl: string | null): string {
  if (!sourceUrl) return "Source pending";
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Source job";
  }
}

export function CandidateQueue({ initialData }: { initialData: AuthenticatedDashboardData }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>("ALL");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const statusCounts = useMemo(() => {
    const counts: Record<QueueStatusFilter, number> = {
      ALL: initialData.applications.length,
      IN_PROGRESS: 0,
      NEEDS_YOU: 0,
      READY: 0,
      DONE: 0,
    };
    for (const application of initialData.applications) {
      counts[applicationStatusGroup(
        application.status,
        application.intakeStatus,
        application.hasReceipt,
      )] += 1;
    }
    return counts;
  }, [initialData.applications]);

  const workingApplications = useMemo(
    () => initialData.applications.filter((application) =>
      isApplicationWorkInProgress(application.status, application.intakeStatus)
    ),
    [initialData.applications],
  );

  const refreshCycleKey = workingApplications
    .map((application) => [
      application.applicationRouteKey,
      application.status,
      application.intakeStatus,
      application.preparationStage,
      application.updatedAt,
    ].join(":"))
    .join("|");

  const applications = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return initialData.applications.filter((application) => {
      const matchesStatus = statusFilter === "ALL" || applicationStatusGroup(
        application.status,
        application.intakeStatus,
        application.hasReceipt,
      ) === statusFilter;
      if (!matchesStatus) return false;
      if (!normalizedQuery) return true;
      return [application.company, application.role, application.location]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [initialData.applications, query, statusFilter]);

  function submitJob(formData: FormData) {
    const jobUrl = String(formData.get("jobUrl") ?? "");
    setMessage("");
    startTransition(async () => {
      const result = await createPastedLinkApplicationRun({
        commandId: crypto.randomUUID(),
        jobUrl,
      });

      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }

      formRef.current?.reset();
      dialogRef.current?.close();
      router.refresh();
    });
  }

  return (
    <main className={styles.shell}>
      <RouteAutoRefresh
        active={initialData.backendStatus === "available" && (workingApplications.length > 0 || initialData.autoApply?.enabled === true)}
        cycleKey={refreshCycleKey}
        intervalMs={initialData.autoApply?.enabled ? 60_000 : 12_000}
        maxUnchangedRefreshes={initialData.autoApply?.enabled ? Number.POSITIVE_INFINITY : 25}
      />
      <section className={styles.content}>
        <div className={styles.banner}>
          <div><h1>Applications</h1><p>Your matches, your applications, one place.</p></div>
          <button
            className={styles.secondaryButton}
            disabled={initialData.backendStatus === "unavailable"}
            onClick={() => dialogRef.current?.showModal()}
            type="button"
          >
            Add a job link
            <Icon name="arrow" size={18} />
          </button>
        </div>

        <AutoApplyPanel data={initialData} />

        {initialData.backendStatus === "unavailable" ? (
          <section className={styles.systemNotice} role="alert">
            <div>
              <strong>Applications unavailable</strong>
              <span>RoleDawn could not load your applications. Your saved work has not been removed.</span>
            </div>
            <button onClick={() => router.refresh()} type="button">Try again</button>
          </section>
        ) : null}

        {initialData.backendStatus === "available" ? <section className={styles.queueCard} aria-labelledby="queue-heading">
          <div className={styles.queueHeader}>
            <div>
              <h2 id="queue-heading">Recent applications</h2>
              <span aria-live="polite">{applications.length}</span>
            </div>
            <label className={styles.queueSearch}>
              <span className="sr-only">Search applications</span>
              <Icon name="search" size={17} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search company or role"
                type="search"
                value={query}
              />
            </label>
          </div>

          {initialData.applications.length === 100 ? <p className={styles.historyNotice}>Showing your latest 100 applications. Earlier records are retained.</p> : null}

          {initialData.applications.length > 0 ? (
            <div aria-label="Filter applications by status" className={styles.statusFilters} role="group">
              {STATUS_FILTERS.map((filter) => (
                <button
                  aria-pressed={statusFilter === filter.id}
                  className={statusFilter === filter.id ? styles.statusFilterActive : undefined}
                  key={filter.id}
                  onClick={() => setStatusFilter(filter.id)}
                  type="button"
                >
                  {filter.label}
                  <span>{statusCounts[filter.id]}</span>
                </button>
              ))}
            </div>
          ) : null}

          {applications.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name="document" size={28} />
              <h3>{query || statusFilter !== "ALL" ? "No applications match." : "No applications yet."}</h3>
              <p>{query || statusFilter !== "ALL" ? "Change the search or status filter." : initialData.autoApply?.enabled ? "Matched applications will appear here as RoleDawn prepares them." : "Turn on auto-apply above, or prepare an application from your matches."}</p>
              {!query && statusFilter === "ALL" ? <button className={styles.secondaryButton} onClick={() => dialogRef.current?.showModal()} type="button">Start an application</button> : null}
            </div>
          ) : (
            <ol className={styles.applicationList}>
              {applications.map((application) => {
                const status = presentStatus(application);
                return (
                  <li key={application.applicationRouteKey}>
                    <Link className={styles.applicationRow} href={`/applications/${application.applicationRouteKey}`}>
                      <span className={styles.applicationIdentity}>
                        <strong>{application.company ?? "Reading company"}</strong>
                        <span>{application.role ?? "Reading job title"}</span>
                        <small>{[application.autoApplySelected ? "Auto-apply" : null, application.location, sourceName(application.sourceUrl)].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className={`${styles.status} ${styles[`status--${status.tone}`]}`}>
                        <i aria-hidden="true" />
                        <span>
                          <strong>{status.label}</strong>
                          <small>{status.detail}</small>
                        </span>
                      </span>
                      <time dateTime={application.queuedAt}>{displayDate(application.queuedAt)}</time>
                      <Icon name="arrow" size={18} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section> : null}
      </section>

      <dialog className={styles.dialog} ref={dialogRef} onClose={() => setMessage("")}>
        <div className={styles.dialogHeader}>
          <div>
            <span className={styles.eyebrow}>New application</span>
            <h2>Paste the official job link</h2>
          </div>
          <button aria-label="Close" className={styles.iconButton} onClick={() => dialogRef.current?.close()} type="button"><Icon name="close" /></button>
        </div>
        <form action={submitJob} ref={formRef}>
          <label htmlFor="job-url">Job URL</label>
          <input autoFocus id="job-url" name="jobUrl" placeholder="https://boards.greenhouse.io/…" required type="url" />
          <p className={styles.fieldNote}>Supported now: direct public postings on Greenhouse, Lever, and Ashby.</p>
          {message ? <p className={styles.formError} role="alert">{message}</p> : null}
          <div className={styles.dialogActions}>
            <button className={styles.secondaryButton} onClick={() => dialogRef.current?.close()} type="button">Cancel</button>
            <button className={styles.primaryButton} disabled={isPending} type="submit">{isPending ? "Starting…" : "Start application"}</button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
