import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ui from "@/components/app/ui.module.css";
import { StatusRail } from "@/components/app/StatusRail";
import { ApplicationAgentQuestions } from "@/components/applications/ApplicationAgentQuestions";
import { ApplicationAutopilot } from "@/components/applications/ApplicationAutopilot";
import { ApplicationDocuments, type DownloadLink } from "@/components/applications/ApplicationDocuments";
import { ApplicationFilesRefresh } from "@/components/applications/ApplicationFilesRefresh";
import { ApplicationFillAuthorization } from "@/components/applications/ApplicationFillAuthorization";
import { ApplicationPreparationPanel } from "@/components/applications/ApplicationPreparationPanel";
import { ApplicationPreparationRetry } from "@/components/applications/ApplicationPreparationRetry";
import { RetryImport } from "@/components/applications/RetryImport";
import { SendWhenReady } from "@/components/applications/SendWhenReady";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import { ApplicationAgentQuestionError, type ApplicationAgentQuestion } from "@/domain/application-agent-questions";
import { ApplicationAutopilotError, type ApplicationAutopilotView } from "@/domain/application-autopilot";
import { AUTOPILOT_UNSUPPORTED_DESTINATION_COPY, parseAutopilotDestination } from "@/domain/application-autopilot-eligibility";
import { explainFailure, presentApplication, type ApplicationPresentation } from "@/domain/application-presentation";
import { isApplicationWorkInProgress } from "@/domain/dashboard-queue";
import { formatUtcDateTime } from "@/domain/date-format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listApplicationAgentQuestions } from "@/server/applications/agent-questions";
import { getApplicationDocumentsView, type ApplicationDocumentsView } from "@/server/applications/application-documents-view";
import { getApplicationAutopilot } from "@/server/applications/autopilot";
import { requireActor } from "@/server/auth/session";
import {
  getApplicationWorkspace,
  type ApplicationArtifactDTO,
  type ApplicationEventDTO,
  type ApplicationWorkspaceDTO,
} from "@/server/dashboard/queue";

import styles from "./ApplicationWorkspace.module.css";

export const metadata: Metadata = {
  title: "Application",
  description: "One application: its status, documents, and next step.",
};

const INTAKE_FAILURE_COPY: Readonly<Record<string, string>> = {
  ATS_UNSUPPORTED: "This job board isn't supported yet.",
  JOB_URL_SHAPE_UNSUPPORTED: "That link doesn't point to a single public job posting.",
  JOB_NOT_FOUND: "The employer took this posting down.",
  BODY_TOO_LARGE: "The posting was too large to import safely.",
  JSON_INVALID: "The job board returned something RoleDawn couldn't read.",
  PAYLOAD_INVALID: "The job board's record for this posting was incomplete.",
  HTTP_ERROR: "The job board returned an error.",
  FETCH_FAILED: "RoleDawn couldn't reach the job board.",
};

const EVENT_COPY: Readonly<Record<string, string>> = {
  "application.queued": "Added",
  "application.job_resolved": "Read the job posting",
  "application.intake_failed": "Couldn't read the job posting",
  "application.preparation_requested": "Started preparing",
  "application.preparation_queued": "Queued to prepare",
  "application.inputs_frozen": "Locked in your profile for this job",
  "application.inputs_invalidated": "Your profile changed, so inputs were refreshed",
  "application.preparation_blocked": "Paused until your profile has what it needs",
  "application.drafting_requested": "Started writing",
  "application.drafting_failed": "Writing stopped",
  "application.kit_ready": "Documents ready",
  "application.files_refresh_queued": "Rewriting with your latest profile",
  "application.autopilot_delegated": "Applying started",
  "application.autopilot_questions_requested": "The form asked a question",
  "application.autopilot_answers_saved": "Your answers were saved",
  "application.autopilot_submit_started": "Submitting",
  "application.autopilot_completed": "Result recorded",
  "application.autopilot_controlled": "Paused, resumed, or canceled",
  "application.fill_authorized": "Form fill approved",
  "application.browser_fill_requested": "Form fill requested",
  "application.fill_started": "Opened the employer's form",
  "application.filled_for_review": "Form filled for your review",
  "application.fill_takeover_required": "Asked for your help",
  "application.fill_resume_requested": "Continuing the form",
  "application.browser_fill_resume_requested": "Continuing the form",
  "application.fill_takeover_still_required": "Still needs your help",
  "application.fill_resume_failed_safe": "Stopped safely",
  "application.fill_failed_safe": "Stopped safely",
  "application.fill_review_runtime_released": "Closed the secure browser",
  "application.fill_review_runtime_release_uncertain": "Checking the secure browser closed",
};

const ACTOR_COPY: Readonly<Record<string, string>> = { CANDIDATE: "You", SYSTEM: "RoleDawn", WORKER: "RoleDawn", SUPPORT: "Support" };

function titleCase(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("_", " ").replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

function eventLabel(event: ApplicationEventDTO): string {
  return EVENT_COPY[event.type] ?? titleCase(event.type.replace(/^application\./u, ""));
}

function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return "";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function freeze(label: string, detail: string, tone: ApplicationPresentation["tone"], needsYou = false): ApplicationPresentation {
  return Object.freeze({ label, detail, tone, step: 3, needsYou, closed: false });
}

/** While a send is live, its state outranks the application record's. */
function autopilotPresentation(view: ApplicationAutopilotView | null): ApplicationPresentation | null {
  if (view?.verification) return freeze("Needs you", "The employer emailed you a verification code. Enter it below to finish sending.", "attention", true);
  switch (view?.status) {
    case "WAITING_ANSWERS": return freeze("Needs you", "The employer's form asked something only you can answer. Answer below and RoleDawn continues.", "attention", true);
    case "PAUSED": return freeze("Paused", "Nothing is being sent. Resume when you're ready.", "attention", true);
    case "UNCERTAIN":
    case "RECONCILING": return freeze("Confirming", "Checking whether the employer received it before anything else happens.", "working");
    case "SUBMITTING": return freeze("Sending", "Submitting and waiting for the employer's confirmation.", "working");
    case "QUEUED":
    case "RUNNING": return freeze("Applying", "Filling out the employer's form with your documents and saved answers.", "working");
    case "FAILED_SAFE": return freeze("Stopped", "RoleDawn stopped before sending anything. Details below.", "error", true);
    default: return null;
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function artifactHref(applicationId: string, artifact: ApplicationArtifactDTO): string {
  return `/applications/${applicationId}/artifacts/${artifact.id}`;
}

function documentDownloads(applicationId: string, artifacts: readonly ApplicationArtifactDTO[]) {
  const byVariant = new Map(artifacts.map((artifact) => [artifact.variant, artifact]));
  const link = (variant: string, label: string): DownloadLink[] => {
    const artifact = byVariant.get(variant);
    return artifact ? [{ label, href: artifactHref(applicationId, artifact) }] : [];
  };
  const combined = byVariant.get("APPLICATION_PDF");
  return {
    letter: [...link("COVER_LETTER_PDF", "PDF"), ...link("COVER_LETTER_DOCX", "Word")],
    resume: [...link("RESUME_PDF", "PDF"), ...link("RESUME_DOCX", "Word")],
    combined: combined ? { label: "Download both (PDF)", href: artifactHref(applicationId, combined) } : null,
  };
}

async function readSendIntentOpen(applicationId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("application_send_intents")
    .select("application_id").eq("application_id", applicationId).is("closed_at", null).maybeSingle();
  return !error && Boolean(data);
}

type WorkspaceProps = Readonly<{
  application: ApplicationWorkspaceDTO;
  documents: ApplicationDocumentsView | null;
  sendIntentOpen: boolean;
  agentQuestions: readonly ApplicationAgentQuestion[];
  questionsError: string | null;
  canContinueAgentQuestions: boolean;
  autopilot: ApplicationAutopilotView | null;
  autopilotEnabled: boolean;
}>;

function ApplicationWorkspace({
  application, documents, sendIntentOpen, agentQuestions, questionsError, canContinueAgentQuestions, autopilot, autopilotEnabled,
}: WorkspaceProps) {
  const id = application.applicationRouteKey;
  const preparationRun = application.runs.find((run) => run.kind === "PREPARATION") ?? null;
  const browserClosed = !application.computerSession || !["ACTIVE", "PAUSED_FOR_REVIEW", "PROVISIONING"].includes(application.computerSession.state);
  const strandedTakeover = application.status === "TAKEOVER" && !autopilot && Boolean(application.fillAttempt) && browserClosed;
  const presentation = autopilotPresentation(autopilot) ?? (strandedTakeover
    ? Object.freeze({ label: "Finish on the employer's site", detail: "RoleDawn stopped at a step it can't do for you. Nothing was sent.", tone: "attention" as const, step: 3, needsYou: true, closed: false })
    : null) ?? presentApplication({
    status: application.status,
    intakeStatus: application.intakeStatus,
    preparationStage: preparationRun?.preparationStage ?? null,
    hasReceipt: Boolean(application.receipt),
    sendIntentOpen,
  });
  const postingHref = application.applyUrl ?? application.sourceUrl;
  const destinationSupported = application.applyUrl ? Boolean(parseAutopilotDestination(application.applyUrl)) : true;
  const preparing = application.status === "DRAFTING" || application.status === "NEEDS_USER";
  const intakeFailed = application.intakeStatus === "FAILED";
  const canRefreshStaleFiles = application.profileChanged && ["READY", "NEEDS_USER", "FAILED_SAFE"].includes(application.status);
  const showPreparation = preparing && !intakeFailed && application.intakeStatus !== "PENDING" && application.intakeStatus !== "RESOLVING";
  const writingProblem = ["NEEDS_USER", "FAILED_SAFE"].includes(application.status) ? explainFailure(preparationRun?.errorCode) : null;
  const showSendSwitch = autopilotEnabled && destinationSupported && !intakeFailed && !autopilot &&
    (preparing || (application.status === "READY" && sendIntentOpen));
  const showApply = autopilotEnabled && Boolean(application.currentRevision) &&
    (autopilot ? autopilot.status !== "CONFIRMED" : application.status === "READY" && !sendIntentOpen);
  // The older approve-then-fill flow still owns applications it started.
  const showManualFill = (!autopilotEnabled || (Boolean(application.fillAttempt) && !autopilot)) &&
    application.currentRevision && agentQuestions.length === 0 &&
    !(application.profileChanged && application.status === "READY") &&
    (application.status === "READY" || application.fillAttempt || ["AUTHORIZED", "EXECUTING", "TAKEOVER", "PRE_SUBMIT_REVIEW"].includes(application.status));
  const downloads = documentDownloads(id, application.artifacts);
  const refreshCycleKey = [
    application.status, application.intakeStatus, application.updatedAt, preparationRun?.preparationStage,
    application.fillAttempt?.status, application.fillResumeAttempt?.status, application.computerSession?.state,
    autopilot?.version, sendIntentOpen,
  ].join(":");

  return (
    <main className={`${ui.page} ${styles.page}`}>
      <RouteAutoRefresh
        active={
          isApplicationWorkInProgress(application.status, application.intakeStatus) ||
          application.fillResumeAttempt?.status === "QUEUED" ||
          (sendIntentOpen && application.status === "READY") ||
          Boolean(autopilot && ["QUEUED", "RUNNING", "SUBMITTING", "RECONCILING", "UNCERTAIN"].includes(autopilot.status))
        }
        cycleKey={refreshCycleKey}
      />

      <Link className={styles.back} href="/dashboard">← Home</Link>

      <header className={styles.header}>
        <div className={styles.employer}>
          <span className={ui.avatar} aria-hidden="true">{(application.company ?? "?").slice(0, 1)}</span>
          <span>
            <strong>{application.company ?? (intakeFailed ? hostOf(application.sourceUrl) ?? "Job link" : "Reading the posting…")}</strong>
            <small>
              {[application.location,
                application.workMode && application.workMode !== "UNKNOWN" ? titleCase(application.workMode) : null,
                application.employmentType && !["UNSPECIFIED", "UNKNOWN", "OTHER"].includes(application.employmentType) ? titleCase(application.employmentType) : null,
              ].filter(Boolean).join(" · ")}
            </small>
          </span>
        </div>
        <h1 className={styles.role}>{application.role ?? (intakeFailed ? "This job couldn't be imported" : "Reading the job…")}</h1>
        <div className={styles.statusBlock} data-tone={presentation.tone}>
          <StatusRail presentation={presentation} />
          <p><strong>{presentation.label}.</strong> {presentation.detail}</p>
        </div>
        {postingHref ? <a className={styles.posting} href={postingHref} rel="noreferrer" target="_blank">View the posting ↗</a> : null}
      </header>

      <div className={styles.next}>
        {intakeFailed ? (
          <section className={`${styles.panel} ${styles.panelError}`} role="alert">
            <h2>RoleDawn couldn&apos;t read this job.</h2>
            <p>{explainFailure(application.failureCode) ?? INTAKE_FAILURE_COPY[application.failureCode ?? ""] ?? "The import stopped safely."} Nothing was sent.</p>
            {application.failureCode !== "ATS_UNSUPPORTED" && application.failureCode !== "JOB_URL_SHAPE_UNSUPPORTED" ? <RetryImport applicationId={id} /> : null}
          </section>
        ) : null}

        {questionsError ? <p className={ui.noticeError} role="alert">{questionsError}</p> : null}

        {writingProblem ? (
          <section className={`${styles.panel} ${styles.panelAttention}`}>
            <h2>Writing stopped before your documents were ready.</h2>
            <p>{writingProblem} Nothing was sent.</p>
          </section>
        ) : null}

        {canRefreshStaleFiles ? <ApplicationFilesRefresh aggregateVersion={application.aggregateVersion} applicationId={id} /> : null}

        {showPreparation ? (
          <ApplicationPreparationPanel
            blockers={application.inputSnapshot?.blockers ?? []}
            readiness={application.inputSnapshot?.readiness ?? null}
            retryControl={application.status === "NEEDS_USER" && application.inputSnapshot?.readiness === "BLOCKED" && !application.profileChanged
              ? <ApplicationPreparationRetry aggregateVersion={application.aggregateVersion} applicationId={id} />
              : null}
            stage={preparationRun?.preparationStage ?? null}
          />
        ) : null}

        {showSendSwitch ? (
          <section className={styles.panel}>
            <SendWhenReady applicationId={id} open={sendIntentOpen} ready={application.status === "READY"} />
          </section>
        ) : null}

        {showApply && application.currentRevision ? (
          <ApplicationAutopilot
            aggregateVersion={application.aggregateVersion}
            applicationId={id}
            canStart={application.status === "READY" && !application.profileChanged && application.currentRevision.validationStatus === "PASSED" && !questionsError}
            packetHash={application.currentRevision.packetHash}
            revisionId={application.currentRevision.id}
            startBlockedReason={destinationSupported ? undefined : AUTOPILOT_UNSUPPORTED_DESTINATION_COPY}
            view={autopilot}
          />
        ) : null}

        {application.currentRevision && application.fillAttempt && application.computerSession ? (
          <ApplicationAgentQuestions
            aggregateVersion={application.aggregateVersion}
            applicationId={id}
            canContinue={canContinueAgentQuestions}
            computerSessionId={application.computerSession.id}
            fillAttemptId={application.fillAttempt.id}
            questions={agentQuestions}
            revisionId={application.currentRevision.id}
          />
        ) : null}

        {showManualFill && application.currentRevision ? (
          <ApplicationFillAuthorization
            aggregateVersion={application.aggregateVersion}
            applicationId={id}
            artifacts={application.artifacts}
            computerSession={application.computerSession}
            destinationHost={hostOf(application.applyUrl) ?? "the employer's site"}
            fillAttempt={application.fillAttempt}
            fillResumeAttempt={application.fillResumeAttempt}
            revision={application.currentRevision}
            status={application.status}
          />
        ) : null}

        {application.receipt ? (
          <section className={`${styles.panel} ${styles.panelDone}`}>
            <h2>Applied.</h2>
            <p>
              The employer confirmed your application on {formatUtcDateTime(application.receipt.confirmedAt)}
              {application.receipt.confirmationKind ? ` (${titleCase(application.receipt.confirmationKind).toLocaleLowerCase("en-US")})` : ""}.
            </p>
            <a className={`${ui.secondary} ${ui.small}`} href={`/applications/${id}/receipt`}>Download the receipt</a>
          </section>
        ) : null}
      </div>

      {documents ? (
        <ApplicationDocuments
          combinedDownload={downloads.combined}
          letterDownloads={downloads.letter}
          resumeDownloads={downloads.resume}
          view={documents}
        />
      ) : application.artifacts.length > 0 ? (
        <section className={styles.files} aria-labelledby="files-heading">
          <h2 id="files-heading" className={styles.subhead}>Your documents</h2>
          <ul className={ui.list}>
            {application.artifacts.map((artifact) => (
              <li className={styles.file} key={artifact.id}>
                <span><strong>{artifact.displayName}</strong><small>{fileSize(artifact.byteSize)}</small></span>
                <a className={`${ui.secondary} ${ui.small}`} href={artifactHref(id, artifact)}>Download</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.more} aria-label="Job and history">
        {application.description ? (
          <details className={styles.disclosure}>
            <summary>The job description</summary>
            <div className={styles.description}>{application.description}</div>
          </details>
        ) : null}
        <details className={styles.disclosure}>
          <summary>Activity</summary>
          {application.events.length > 0 ? (
            <ol className={styles.timeline}>
              {application.events.map((event, index) => (
                <li key={`${event.occurredAt}-${event.type}-${index}`}>
                  <strong>{eventLabel(event)}</strong>
                  <small>{ACTOR_COPY[event.actorKind] ?? titleCase(event.actorKind)} · {formatUtcDateTime(event.occurredAt)}</small>
                </li>
              ))}
            </ol>
          ) : <p className={ui.hint}>Nothing yet.</p>}
        </details>
      </section>
    </main>
  );
}

export default async function ApplicationPage({ params }: Readonly<{ params: Promise<{ applicationId: string }> }>) {
  const { applicationId } = await params;
  const actor = await requireActor(`/applications/${encodeURIComponent(applicationId)}`);
  const application = await getApplicationWorkspace(actor, applicationId);
  if (!application) notFound();

  const autopilotEnabled = process.env.ROLEDAWN_AUTOPILOT_ENABLED === "true";
  let questionsError: string | null = null;
  let autopilot: ApplicationAutopilotView | null = null;
  let agentQuestions: readonly ApplicationAgentQuestion[] = [];

  const [documents, sendIntentOpen] = await Promise.all([
    application.currentRevision ? getApplicationDocumentsView(application.currentRevision.id).catch(() => null) : Promise.resolve(null),
    readSendIntentOpen(application.applicationRouteKey).catch(() => false),
  ]);

  if (autopilotEnabled) {
    try {
      autopilot = await getApplicationAutopilot(await createSupabaseServerClient(), applicationId);
    } catch (error) {
      questionsError = error instanceof ApplicationAutopilotError ? error.message : "Progress couldn't be loaded. Reload to check.";
    }
  }
  if (process.env.ROLEDAWN_FORM_DRIVER === "agents" && application.currentRevision && application.fillAttempt && application.computerSession) {
    try {
      agentQuestions = await listApplicationAgentQuestions(await createSupabaseServerClient(), {
        applicationId: application.applicationRouteKey,
        revisionId: application.currentRevision.id,
        fillAttemptId: application.fillAttempt.id,
        computerSessionId: application.computerSession.id,
      }, { enabled: true });
    } catch (error) {
      questionsError = error instanceof ApplicationAgentQuestionError ? error.message : "Questions couldn't be loaded. Reload to try again.";
    }
  }
  const canContinueAgentQuestions = application.status === "TAKEOVER" &&
    application.computerSession?.state === "PAUSED_FOR_REVIEW" &&
    // Server-rendered expiry hint; the command rechecks current database time.
    // eslint-disable-next-line react-hooks/purity
    Date.parse(application.computerSession.expiresAt) > Date.now() &&
    application.fillResumeAttempt?.status !== "QUEUED";

  return (
    <ApplicationWorkspace
      agentQuestions={agentQuestions}
      application={application}
      autopilot={autopilot}
      autopilotEnabled={autopilotEnabled}
      canContinueAgentQuestions={canContinueAgentQuestions}
      documents={documents}
      questionsError={questionsError}
      sendIntentOpen={sendIntentOpen}
    />
  );
}
