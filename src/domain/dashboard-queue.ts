import type { ApplicationPreparationStage } from "@/domain/application-input-snapshot";
import type { AutoApplyState } from "./account-auto-apply.ts";
import type { CandidateSearchProfileViewModel } from "./candidate-onboarding.ts";
import type { MatchedJob } from "./candidate-matching.ts";

export type ApplicationStatus =
  | "DRAFTING"
  | "NEEDS_USER"
  | "READY"
  | "AUTHORIZED"
  | "EXECUTING"
  | "TAKEOVER"
  | "PRE_SUBMIT_REVIEW"
  | "RECONCILING"
  | "CONFIRMED"
  | "SKIPPED"
  | "FAILED_SAFE"
  | "CANCELED";

const APPLICATION_STATUSES = new Set<ApplicationStatus>([
  "DRAFTING",
  "NEEDS_USER",
  "READY",
  "AUTHORIZED",
  "EXECUTING",
  "TAKEOVER",
  "PRE_SUBMIT_REVIEW",
  "RECONCILING",
  "CONFIRMED",
  "SKIPPED",
  "FAILED_SAFE",
  "CANCELED",
]);

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return APPLICATION_STATUSES.has(value as ApplicationStatus);
}

export function canPresentAsSubmitted(
  status: ApplicationStatus,
  hasReceipt: boolean,
): boolean {
  return status === "CONFIRMED" && hasReceipt;
}

export type QueueStatusFilter =
  | "ALL"
  | "IN_PROGRESS"
  | "NEEDS_YOU"
  | "READY"
  | "DONE";

export type QueueStatusGroup = Exclude<QueueStatusFilter, "ALL">;

export function applicationStatusGroup(
  status: ApplicationStatus,
  intakeStatus: JobIntakeStatus | null,
  hasReceipt: boolean,
): QueueStatusGroup {
  if (intakeStatus === "PENDING" || intakeStatus === "RESOLVING") {
    return "IN_PROGRESS";
  }
  if (intakeStatus === "FAILED" || (status === "CONFIRMED" && !hasReceipt)) {
    return "NEEDS_YOU";
  }

  switch (status) {
    case "DRAFTING":
    case "AUTHORIZED":
    case "EXECUTING":
    case "RECONCILING":
      return "IN_PROGRESS";
    case "NEEDS_USER":
    case "TAKEOVER":
    case "FAILED_SAFE":
      return "NEEDS_YOU";
    case "READY":
    case "PRE_SUBMIT_REVIEW":
      return "READY";
    case "CONFIRMED":
    case "SKIPPED":
    case "CANCELED":
      return "DONE";
  }
}

export function isApplicationWorkInProgress(
  status: ApplicationStatus,
  intakeStatus: JobIntakeStatus | null,
): boolean {
  return applicationStatusGroup(status, intakeStatus, false) === "IN_PROGRESS";
}

export type PreparationRunSnapshotBinding = Readonly<{
  runKind: string;
  inputSnapshotId: string | null;
}>;

/**
 * Runs must be ordered newest first. A queued retry intentionally has no
 * snapshot yet, so its null binding must hide any snapshot from an older run.
 */
export function latestPreparationSnapshotId(
  runs: readonly PreparationRunSnapshotBinding[],
): string | null {
  return runs.find((run) => run.runKind === "PREPARATION")?.inputSnapshotId ?? null;
}

export type JobIntakeStatus =
  | "PENDING"
  | "RESOLVING"
  | "RESOLVED"
  | "FAILED";

const JOB_INTAKE_STATUSES = new Set<JobIntakeStatus>([
  "PENDING",
  "RESOLVING",
  "RESOLVED",
  "FAILED",
]);

export function isJobIntakeStatus(value: string): value is JobIntakeStatus {
  return JOB_INTAKE_STATUSES.has(value as JobIntakeStatus);
}

export type PersistentQueueApplication = Readonly<{
  applicationRouteKey: string;
  status: ApplicationStatus;
  hasReceipt: boolean;
  intakeStatus: JobIntakeStatus | null;
  failureCode: string | null;
  queuedAt: string;
  updatedAt: string;
  sourceUrl: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  preparationStage: ApplicationPreparationStage | null;
  autoApplySelected?: boolean;
}>;

export type AuthenticatedDashboardData = Readonly<{
  mode: "authenticated";
  actorLabel: string;
  backendStatus: "available" | "unavailable";
  applications: readonly PersistentQueueApplication[];
  autoApply?: AutoApplyState | null;
  searchProfile?: CandidateSearchProfileViewModel | null;
  preferencesCommandId?: string;
  recommendations?: Readonly<{
    scannedJobs: number;
    complete: boolean;
    items: readonly Pick<MatchedJob, "jobId" | "jobVersionId" | "title" | "employerName" | "location" | "canonicalUrl" | "queuedApplicationId" | "matching">[];
  }> | null;
}>;
