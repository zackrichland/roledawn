import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { signOut } from "@/app/dashboard/sign-out-action";
import { AuthenticatedAppShell } from "@/components/ui/AuthenticatedAppShell";
import type {
  ApplicationEventDTO,
  ApplicationRunDTO,
  ApplicationWorkspaceDTO,
} from "@/server/dashboard/queue";
import { canPresentAsSubmitted } from "@/domain/dashboard-queue";
import { formatUtcDateTime } from "@/domain/date-format";
import { getApplicationWorkspace } from "@/server/dashboard/queue";
import { requireActor } from "@/server/auth/session";

import styles from "./ApplicationWorkspace.module.css";

export const metadata: Metadata = {
  title: "Application",
  description: "Persistent application status and source details.",
};

const APPLICATION_STATUS_COPY = {
  DRAFTING: ["Preparing", "RoleDawn has preparation authority only."],
  NEEDS_USER: ["Needs you", "RoleDawn needs an answer before preparation can continue."],
  READY: ["Ready to review", "A candidate review is the next step."],
  AUTHORIZED: ["Approved", "A single-use approval is recorded for the current revision."],
  EXECUTING: ["Applying", "The approved application attempt is in progress."],
  TAKEOVER: ["Take over", "A protected step requires the candidate."],
  RECONCILING: ["Checking submission", "RoleDawn is checking the existing attempt before any retry."],
  CONFIRMED: ["Submitted", "A submission receipt is recorded."],
  SKIPPED: ["Skipped", "Preparation is closed for this application."],
  FAILED_SAFE: ["Stopped safely", "RoleDawn stopped without assuming the application was submitted."],
  CANCELED: ["Canceled", "This application is closed."],
} as const;

const INTAKE_STATUS_COPY = {
  PENDING: ["Waiting to import", "The official job link is queued for a resolver."],
  RESOLVING: ["Importing job", "RoleDawn is reading the official hosted posting."],
  RESOLVED: ["Job imported", "The official posting is saved as an immutable job version."],
  FAILED: ["Job import stopped", "The source could not be imported. No application was submitted."],
} as const;

const FAILURE_COPY: Readonly<Record<string, string>> = {
  ATS_UNSUPPORTED: "This job board is not supported by the current resolver.",
  JOB_URL_SHAPE_UNSUPPORTED: "The link does not identify one supported public job posting.",
  JOB_NOT_FOUND: "The official job board no longer lists this posting.",
  BODY_TOO_LARGE: "The official job response exceeded the safe import limit.",
  JSON_INVALID: "The official job board returned an unreadable response.",
  PAYLOAD_INVALID: "The official job record was incomplete.",
  HTTP_ERROR: "The official job board returned an error.",
  FETCH_FAILED: "RoleDawn could not reach the official job board.",
};

const EVENT_COPY: Readonly<Record<string, string>> = {
  "application.queued": "Added to queue",
  "application.job_resolved": "Official job imported",
  "application.intake_failed": "Job import stopped",
};

const RUN_KIND_COPY: Readonly<Record<string, string>> = {
  PREPARATION: "Preparation",
  BROWSER_FILL: "Browser fill",
  RECONCILIATION: "Submission check",
};

const RUN_STATUS_COPY: Readonly<Record<string, string>> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  WAITING: "Waiting",
  SUCCEEDED: "Complete",
  FAILED: "Stopped",
  CANCELED: "Canceled",
};

function titleCaseCode(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function sourceLabel(value: string | null): string {
  if (!value) return "Official source pending";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Official source";
  }
}

function applicationPresentation(application: ApplicationWorkspaceDTO) {
  if (application.intakeStatus === "FAILED") {
    return { label: "Job import stopped", detail: "No application was submitted.", tone: "attention" } as const;
  }
  if (application.intakeStatus === "PENDING" || application.intakeStatus === "RESOLVING") {
    const [label, detail] = INTAKE_STATUS_COPY[application.intakeStatus];
    return { label, detail, tone: "working" } as const;
  }
  if (
    application.status === "CONFIRMED" &&
    !canPresentAsSubmitted(application.status, Boolean(application.receipt))
  ) {
    return {
      label: "Receipt missing",
      detail: "This record is not treated as submitted until confirmation evidence is attached.",
      tone: "attention",
    } as const;
  }

  const [label, detail] = APPLICATION_STATUS_COPY[application.status];
  const tone = application.status === "CONFIRMED"
    ? "done"
    : ["NEEDS_USER", "TAKEOVER", "RECONCILING", "FAILED_SAFE"].includes(application.status)
      ? "attention"
      : application.status === "READY" || application.status === "AUTHORIZED"
        ? "ready"
        : ["SKIPPED", "CANCELED"].includes(application.status)
          ? "neutral"
          : "working";
  return { label, detail, tone } as const;
}

function eventLabel(event: ApplicationEventDTO): string {
  return EVENT_COPY[event.type] ?? titleCaseCode(event.type.replace(/^application\./, ""));
}

function runLabel(run: ApplicationRunDTO): string {
  return `${RUN_KIND_COPY[run.kind] ?? titleCaseCode(run.kind)} · ${RUN_STATUS_COPY[run.status] ?? titleCaseCode(run.status)}`;
}

function FailureNotice({ code }: { code: string }) {
  return (
    <section className={styles.failure} aria-labelledby="import-failure-heading">
      <h2 id="import-failure-heading">The job could not be imported.</h2>
      <p>{FAILURE_COPY[code] ?? "The source import stopped safely."}</p>
      <p>No application was submitted.</p>
    </section>
  );
}

function ApplicationWorkspace({
  actorLabel,
  application,
}: {
  actorLabel: string;
  application: ApplicationWorkspaceDTO;
}) {
  const status = applicationPresentation(application);
  const sourceHref = application.applyUrl ?? application.sourceUrl;

  return (
    <AuthenticatedAppShell active="application-kits" actorLabel={actorLabel} signOutAction={signOut}>
      <main className={styles.page}>
        <div className={styles.shell}>
        <nav aria-label="Application breadcrumb" className={styles.breadcrumb}>
          <Link href="/dashboard">Application Kits</Link>
          <span aria-hidden="true">/</span>
          <span>Application</span>
        </nav>

        <header className={styles.header}>
          <div className={styles.heading}>
            <h1>{application.company ?? "Reading company"}</h1>
            <p>{application.role ?? "Reading job title"}</p>
            <div className={styles.jobMeta}>
              <span>{application.location ?? "Location pending"}</span>
              {application.workMode && application.workMode !== "UNKNOWN"
                ? <span>{titleCaseCode(application.workMode)}</span>
                : null}
              {application.employmentType && application.employmentType !== "UNSPECIFIED"
                ? <span>{titleCaseCode(application.employmentType)}</span>
                : null}
              {sourceHref ? <a href={sourceHref} rel="noreferrer" target="_blank">Open official posting</a> : <span>{sourceLabel(application.sourceUrl)}</span>}
            </div>
          </div>
          <div className={`${styles.status} ${styles[`status--${status.tone}`]}`}>
            <i aria-hidden="true" />
            <span>
              <strong>{status.label}</strong>
              <small>{status.detail}</small>
            </span>
          </div>
        </header>

        {application.failureCode ? <FailureNotice code={application.failureCode} /> : null}

        <div className={styles.grid}>
          <div className={styles.primaryColumn}>
            <section className={styles.card} aria-labelledby="overview-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="overview-heading">Current state</h2>
                </div>
                <time dateTime={application.updatedAt}>Updated {formatUtcDateTime(application.updatedAt)}</time>
              </div>
              <dl className={styles.definitionGrid}>
                <div><dt>Application</dt><dd>{status.label}</dd></div>
                <div><dt>Job import</dt><dd>{application.intakeStatus ? INTAKE_STATUS_COPY[application.intakeStatus][0] : "Not required"}</dd></div>
                <div><dt>Queued</dt><dd>{formatUtcDateTime(application.queuedAt)}</dd></div>
              </dl>
              {application.description ? (
                <div className={styles.description}>
                  <h3>Official job snapshot</h3>
                  <p>{application.description}</p>
                </div>
              ) : (
                <div className={styles.pendingBlock}>
                  <strong>Job details are not available yet.</strong>
                  <span>{application.intakeStatus === "FAILED" ? "The import stopped before a job snapshot was saved." : "The resolver must finish before RoleDawn can prepare application materials."}</span>
                </div>
              )}
            </section>

            <section className={styles.card} aria-labelledby="activity-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="activity-heading">History</h2>
                </div>
              </div>
              {application.events.length > 0 ? (
                <ol className={styles.timeline}>
                  {application.events.map((event, index) => (
                    <li key={`${event.occurredAt}-${event.type}-${index}`}>
                      <i aria-hidden="true" />
                      <span>
                        <strong>{eventLabel(event)}</strong>
                        <small>{titleCaseCode(event.actorKind)} · {formatUtcDateTime(event.occurredAt)}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <p className={styles.emptyCopy}>No candidate-facing events have been recorded.</p>}
            </section>
          </div>

          <aside className={styles.secondaryColumn}>
            <section className={styles.card} aria-labelledby="materials-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="materials-heading">Application files</h2>
                </div>
              </div>
              {application.currentRevision ? (
                <>
                  <dl className={styles.stackList}>
                    <div><dt>Revision</dt><dd>{application.currentRevision.version}</dd></div>
                    <div><dt>Validation</dt><dd>{titleCaseCode(application.currentRevision.validationStatus)}</dd></div>
                    <div><dt>Created</dt><dd>{formatUtcDateTime(application.currentRevision.createdAt)}</dd></div>
                  </dl>
                  {application.artifacts.length > 0 ? (
                    <ul className={styles.artifactList}>
                      {application.artifacts.map((artifact, index) => (
                        <li key={`${artifact.kind}-${artifact.createdAt}-${index}`}>
                          <strong>{titleCaseCode(artifact.kind)}</strong>
                          <span>{titleCaseCode(artifact.qaStatus)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className={styles.emptyCopy}>No files have been created for this version.</p>}
                </>
              ) : <p className={styles.emptyCopy}>Application files are not ready yet.</p>}
            </section>

            <section className={styles.card} aria-labelledby="runs-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="runs-heading">Work status</h2>
                </div>
              </div>
              {application.runs.length > 0 ? (
                <ul className={styles.runList}>
                  {application.runs.map((run, index) => (
                    <li key={`${run.createdAt}-${run.kind}-${index}`}>
                      <strong>{runLabel(run)}</strong>
                      <span>{run.errorCode ? FAILURE_COPY[run.errorCode] ?? titleCaseCode(run.errorCode) : formatUtcDateTime(run.startedAt ?? run.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.emptyCopy}>No work has started.</p>}
            </section>

            <section className={styles.card} aria-labelledby="receipt-heading">
              <div className={styles.cardHeader}>
                <div>
                  <h2 id="receipt-heading">Submission proof</h2>
                </div>
              </div>
              {application.receipt ? (
                <dl className={styles.stackList}>
                  <div><dt>Confirmation</dt><dd>{titleCaseCode(application.receipt.confirmationKind)}</dd></div>
                  <div><dt>Confirmed</dt><dd>{formatUtcDateTime(application.receipt.confirmedAt)}</dd></div>
                </dl>
              ) : <p className={styles.emptyCopy}>No submission receipt exists. Queueing and preparation are not submission.</p>}
            </section>
          </aside>
        </div>
        </div>
      </main>
    </AuthenticatedAppShell>
  );
}

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const actor = await requireActor();
  const { applicationId } = await params;
  const application = await getApplicationWorkspace(actor, applicationId);

  if (!application) {
    notFound();
  }

  return (
    <ApplicationWorkspace
      actorLabel={actor.email?.split("@")[0] ?? "Signed-in candidate"}
      application={application}
    />
  );
}
