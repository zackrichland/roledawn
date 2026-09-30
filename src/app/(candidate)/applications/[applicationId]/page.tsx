import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ui from "@/components/app/ui.module.css";
import { StatusRail } from "@/components/app/StatusRail";
import { CompanyLogo } from "@/components/app/CompanyLogo";
import { ApplicationAgentQuestions } from "@/components/applications/ApplicationAgentQuestions";
import { ApplicationAutopilot } from "@/components/applications/ApplicationAutopilot";
import { ApplicationDocuments, type DownloadLink } from "@/components/applications/ApplicationDocuments";
import { ApplicationFilesRefresh } from "@/components/applications/ApplicationFilesRefresh";
import { ApplicationFillAuthorization } from "@/components/applications/ApplicationFillAuthorization";
import { ApplicationPreparationPanel } from "@/components/applications/ApplicationPreparationPanel";
import { ApplicationPreparationRetry } from "@/components/applications/ApplicationPreparationRetry";
import { SendWhenReady } from "@/components/applications/SendWhenReady";
import { StopActions } from "@/components/applications/StopActions";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import { ApplicationAgentQuestionError, type ApplicationAgentQuestion } from "@/domain/application-agent-questions";
import { ApplicationAutopilotError, type ApplicationAutopilotView } from "@/domain/application-autopilot";
import { AUTOPILOT_UNSUPPORTED_DESTINATION_COPY, parseAutopilotDestination } from "@/domain/application-autopilot-eligibility";
import { presentApplication, presentGuidance } from "@/domain/application-presentation";
import { guideIntakeFailure, guideSend, guideWritingFailure } from "@/domain/application-stop-guidance";
import { applicationSendIntentState, canOfferApplicationSend, type ApplicationSendIntentState } from "@/domain/application-send-intent";
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

async function readSendIntent(applicationId: string): Promise<ApplicationSendIntentState> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("application_send_intents")
    .select("closed_at,close_reason").eq("application_id", applicationId).maybeSingle();
  return error ? "UNAVAILABLE" : applicationSendIntentState(data);
}

type WorkspaceProps = Readonly<{
  application: ApplicationWorkspaceDTO;
  documents: ApplicationDocumentsView | null;
  sendIntent: ApplicationSendIntentState;
  agentQuestions: readonly ApplicationAgentQuestion[];
  questionsError: string | null;
  canContinueAgentQuestions: boolean;
  autopilot: ApplicationAutopilotView | null;
  autopilotEnabled: boolean;
}>;

function ApplicationWorkspace({
  application, documents, sendIntent, agentQuestions, questionsError, canContinueAgentQuestions, autopilot, autopilotEnabled,
}: WorkspaceProps) {
  const id = application.applicationRouteKey;
  const preparationRun = application.runs.find((run) => run.kind === "PREPARATION") ?? null;
  const browserClosed = !application.computerSession || !["ACTIVE", "PAUSED_FOR_REVIEW", "PROVISIONING"].includes(application.computerSession.state);
  const strandedTakeover = application.status === "TAKEOVER" && !autopilot && Boolean(application.fillAttempt) && browserClosed;
  const postingHref = application.applyUrl ?? application.sourceUrl;
  const provider = parseAutopilotDestination(application.applyUrl)?.provider ?? null;
  const intakeFailed = application.intakeStatus === "FAILED";
  // A send request speaks for the page only while it belongs to the current documents.
  const currentAutopilot = autopilot && autopilot.revisionId === application.currentRevision?.id ? autopilot : null;
  const sendGuidance = currentAutopilot && !["CONFIRMED", "CANCELED"].includes(currentAutopilot.status) ? guideSend({
    status: currentAutopilot.status, failureCode: currentAutopilot.failureCode,
    transientRetries: application.autopilot?.transientRetries, reconcileCount: application.autopilot?.reconcileCount, expired: application.autopilot?.expired,
    profileChanged: application.profileChanged, provider, questionCount: currentAutopilot.questions.length,
    verificationRecipient: currentAutopilot.verification?.recipient ?? null, verificationRetry: currentAutopilot.verification?.retry,
  }) : null;
  const intakeGuidance = intakeFailed ? guideIntakeFailure(application.failureCode) : null;
  const writingGuidance = application.status === "FAILED_SAFE" && !intakeFailed && !sendGuidance && preparationRun?.status === "FAILED"
    ? guideWritingFailure({ code: preparationRun.errorCode, profileChanged: application.profileChanged }) : null;
  const presentation = sendGuidance ? presentGuidance(sendGuidance) : (strandedTakeover
    ? Object.freeze({ label: "Finish on the employer's site", detail: "RoleDawn stopped at a step it can't do for you. Nothing was sent.", tone: "attention" as const, step: 3, needsYou: true, closed: false })
    : null) ?? presentApplication({
    status: application.status,
    intakeStatus: application.intakeStatus,
    preparationStage: preparationRun?.preparationStage ?? null,
    hasReceipt: Boolean(application.receipt),
    sendIntent,
    failureCode: application.failureCode,
    preparationFailureCode: preparationRun?.status === "FAILED" ? preparationRun.errorCode : null,
    hasDocuments: Boolean(application.currentRevision),
    profileChanged: application.profileChanged,
    provider,
  });
  const destinationSupported = application.applyUrl ? Boolean(parseAutopilotDestination(application.applyUrl)) : true;
  const sendIntentOpen = sendIntent === "OPEN";
  const preparing = application.status === "DRAFTING" || application.status === "NEEDS_USER";
  const canRefreshStaleFiles = application.profileChanged && ["READY", "NEEDS_USER", "FAILED_SAFE"].includes(application.status);
  const showPreparation = preparing && !intakeFailed && application.intakeStatus !== "PENDING" && application.intakeStatus !== "RESOLVING";
  const showSendSwitch = autopilotEnabled && destinationSupported && !intakeFailed && !autopilot && sendIntent !== "UNAVAILABLE" && sendIntent !== "DELEGATED" && sendIntent !== "NOT_DELIVERABLE" &&
    (preparing || (application.status === "READY" && sendIntentOpen));
  const showSendRetry = autopilotEnabled && !autopilot && application.status === "READY" && sendIntent === "NOT_DELIVERABLE";
  const showApply = autopilotEnabled && Boolean(application.currentRevision) &&
    (autopilot ? autopilot.status !== "CONFIRMED" : application.status === "READY" && canOfferApplicationSend(sendIntent));
  // The older approve-then-fill flow still owns applications it started.
  const showManualFill = (!autopilotEnabled || (Boolean(application.fillAttempt) && !autopilot)) &&
    application.currentRevision && agentQuestions.length === 0 &&
    !(application.profileChanged && application.status === "READY") &&
    (application.status === "READY" || application.fillAttempt || ["AUTHORIZED", "EXECUTING", "TAKEOVER", "PRE_SUBMIT_REVIEW"].includes(application.status));
  const downloads = documentDownloads(id, application.artifacts);
  const refreshCycleKey = [
    application.status, application.intakeStatus, application.updatedAt, preparationRun?.preparationStage,
    application.fillAttempt?.status, application.fillResumeAttempt?.status, application.computerSession?.state,
    autopilot?.version, sendIntent,
  ].join(":");

  return (
    <main className={`${ui.page} ${styles.page}`}>
      <RouteAutoRefresh
        active={
          isApplicationWorkInProgress(application.status, application.intakeStatus) ||
          application.fillResumeAttempt?.status === "QUEUED" ||
          (["OPEN", "DELEGATED"].includes(sendIntent) && application.status === "READY") ||
          Boolean(autopilot && ["QUEUED", "RUNNING", "SUBMITTING", "RECONCILING", "UNCERTAIN"].includes(autopilot.status))
        }
        cycleKey={refreshCycleKey}
      />

      <Link className={styles.back} href="/dashboard">← Home</Link>

      <header className={styles.header}>
        <div className={styles.employer}>
          <CompanyLogo name={application.company} postingUrl={postingHref} className={ui.avatar} />
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
        {intakeGuidance ? (
          <section className={`${styles.panel} ${intakeGuidance.tone === "error" ? styles.panelError : styles.panelAttention}`} role={intakeGuidance.tone === "error" ? "alert" : "status"}>
            <h2>{intakeGuidance.heading}.</h2>
            <p>{intakeGuidance.happened} {intakeGuidance.next}</p>
            <StopActions applicationId={id} employerUrl={postingHref} guidance={intakeGuidance} retryTarget="IMPORT" />
          </section>
        ) : null}

        {questionsError ? <p className={ui.noticeError} role="alert">{questionsError}</p> : null}

        {writingGuidance ? (
          <section className={`${styles.panel} ${styles.panelAttention}`}>
            <h2>{writingGuidance.heading}.</h2>
            <p>{writingGuidance.happened} {writingGuidance.next}</p>
            <StopActions aggregateVersion={application.aggregateVersion} applicationId={id} employerUrl={postingHref} guidance={writingGuidance} retryTarget="WRITING" />
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
            <SendWhenReady key={sendIntent} applicationId={id} open={sendIntentOpen} ready={application.status === "READY"} />
          </section>
        ) : null}

        {showSendRetry ? (
          <section className={styles.panel}>
            {destinationSupported ? <SendWhenReady key={sendIntent} applicationId={id} open={false} ready retry />
              : <p>{AUTOPILOT_UNSUPPORTED_DESTINATION_COPY} Your documents are available below.</p>}
          </section>
        ) : null}

        {showApply && application.currentRevision ? (
          <ApplicationAutopilot
            aggregateVersion={application.aggregateVersion}
            applicationId={id}
            canStart={application.status === "READY" && !application.profileChanged && application.currentRevision.validationStatus === "PASSED" && !questionsError}
            employerUrl={postingHref}
            packetHash={application.currentRevision.packetHash}
            profileChanged={application.profileChanged}
            revisionId={application.currentRevision.id}
            showHappened={!sendGuidance}
            startBlockedReason={destinationSupported ? undefined : AUTOPILOT_UNSUPPORTED_DESTINATION_COPY}
            summary={application.autopilot}
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

  const [documents, sendIntent] = await Promise.all([
    application.currentRevision ? getApplicationDocumentsView(application.currentRevision.id).catch(() => null) : Promise.resolve(null),
    readSendIntent(application.applicationRouteKey).catch((): ApplicationSendIntentState => "UNAVAILABLE"),
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
      sendIntent={sendIntent}
    />
  );
}
