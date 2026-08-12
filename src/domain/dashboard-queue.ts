export type ApplicationStatus =
  | "DRAFTING"
  | "NEEDS_USER"
  | "READY"
  | "AUTHORIZED"
  | "EXECUTING"
  | "TAKEOVER"
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
}>;

export type AuthenticatedDashboardData = Readonly<{
  mode: "authenticated";
  actorLabel: string;
  backendStatus: "available" | "unavailable";
  applications: readonly PersistentQueueApplication[];
}>;
