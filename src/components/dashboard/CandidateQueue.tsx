"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { createPastedLinkApplicationRun } from "@/app/dashboard/actions";
import { signOut } from "@/app/dashboard/sign-out-action";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import type {
  ApplicationStatus,
  AuthenticatedDashboardData,
  PersistentQueueApplication,
} from "@/domain/dashboard-queue";
import { canPresentAsSubmitted } from "@/domain/dashboard-queue";

import styles from "./CandidateQueue.module.css";

type StatusPresentation = Readonly<{
  label: string;
  detail: string;
  tone: "neutral" | "working" | "attention" | "ready" | "done";
}>;

const APPLICATION_STATUS_COPY: Record<ApplicationStatus, StatusPresentation> = {
  DRAFTING: { label: "Queued for preparation", detail: "The source job is ready for the next worker.", tone: "working" },
  NEEDS_USER: { label: "Needs you", detail: "RoleDawn needs an answer before it can continue.", tone: "attention" },
  READY: { label: "Ready to review", detail: "The application materials are ready for your review.", tone: "ready" },
  AUTHORIZED: { label: "Approved", detail: "Your single-use approval is recorded.", tone: "ready" },
  EXECUTING: { label: "Applying", detail: "The application is in progress.", tone: "working" },
  TAKEOVER: { label: "Take over", detail: "The browser needs you to finish a protected step.", tone: "attention" },
  RECONCILING: { label: "Checking submission", detail: "RoleDawn is verifying what the employer received.", tone: "working" },
  CONFIRMED: { label: "Submitted", detail: "A submission confirmation was recorded.", tone: "done" },
  SKIPPED: { label: "Skipped", detail: "This application will not continue.", tone: "neutral" },
  FAILED_SAFE: { label: "Stopped safely", detail: "No submission was attempted after a workflow failure.", tone: "attention" },
  CANCELED: { label: "Canceled", detail: "This application was canceled.", tone: "neutral" },
};

function presentStatus(application: PersistentQueueApplication): StatusPresentation {
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
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const applications = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return initialData.applications;
    return initialData.applications.filter((application) =>
      [application.company, application.role, application.location]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [initialData.applications, query]);

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
      <header className={styles.topbar}>
        <Brand href="/dashboard" />
        <label className={styles.search}>
          <span className="sr-only">Search queue</span>
          <Icon name="search" size={18} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company or role"
            type="search"
            value={query}
          />
        </label>
        <div className={styles.account}>
          <span title={initialData.actorLabel}>{initialData.actorLabel}</span>
          <form action={signOut}>
            <button className={styles.textButton} type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <section className={styles.content}>
        <div className={styles.banner}>
          <h1>Queue</h1>
          <button className={styles.primaryButton} onClick={() => dialogRef.current?.showModal()} type="button">
            Paste a job link
            <Icon name="arrow" size={18} />
          </button>
        </div>

        {initialData.backendStatus === "unavailable" ? (
          <section className={styles.systemNotice} role="alert">
            <strong>Queue unavailable</strong>
            <span>RoleDawn could not read the database. The queue is unavailable until the connection recovers.</span>
          </section>
        ) : null}

        <section className={styles.queueCard} aria-labelledby="queue-heading">
          <div className={styles.queueHeader}>
            <div>
              <h2 id="queue-heading">Applications</h2>
              <span>{initialData.applications.length}</span>
            </div>
            <label className={styles.mobileSearch}>
              <span className="sr-only">Search queue</span>
              <Icon name="search" size={17} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                type="search"
                value={query}
              />
            </label>
          </div>

          {applications.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name="document" size={28} />
              <h3>{query ? "No applications match." : "Your queue is empty."}</h3>
              <p>{query ? "Try a different search." : "Paste a Greenhouse, Lever, or Ashby job link to start."}</p>
              {!query ? <button className={styles.secondaryButton} onClick={() => dialogRef.current?.showModal()} type="button">Add the first job</button> : null}
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
                        <small>{[application.location, sourceName(application.sourceUrl)].filter(Boolean).join(" · ")}</small>
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
        </section>
      </section>

      <dialog className={styles.dialog} ref={dialogRef} onClose={() => setMessage("")}>
        <div className={styles.dialogHeader}>
          <div>
            <span className={styles.eyebrow}>Add to queue</span>
            <h2>Paste the official job link.</h2>
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
            <button className={styles.primaryButton} disabled={isPending} type="submit">{isPending ? "Adding…" : "Add to queue"}</button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
