export const JOB_SOURCE_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY"] as const;

export type JobSourceProvider = (typeof JOB_SOURCE_PROVIDERS)[number];

type RegisteredSourceBase = Readonly<{
  sourceId: string;
  tenantKey: string;
}>;

export type GreenhouseSource = RegisteredSourceBase & Readonly<{
  provider: "GREENHOUSE";
  includeContent?: boolean;
}>;

export type LeverSource = RegisteredSourceBase & Readonly<{
  provider: "LEVER";
  region?: "GLOBAL" | "EU";
  page?: Readonly<{ skip: number; limit: number }>;
}>;

export type AshbySource = RegisteredSourceBase & Readonly<{
  provider: "ASHBY";
  includeCompensation?: boolean;
}>;

export type RegisteredJobSource = GreenhouseSource | LeverSource | AshbySource;

export type SourceFetchRequest = Readonly<{
  sourceId: string;
  provider: JobSourceProvider;
  url: string;
  ifNoneMatch?: string;
  maxResponseBytes: number;
  signal?: AbortSignal;
}>;

export type SourceFetchResponse = Readonly<{
  status: number;
  body: string;
  headers: Readonly<Record<string, string | undefined>>;
  observedAt: string;
}>;

/**
 * The only network boundary in the ingestion module. Production workers may
 * implement this with fetch, but adapters and tests receive it as a dependency.
 */
export interface SourceFetchPort {
  fetch(request: SourceFetchRequest): Promise<SourceFetchResponse>;
}

export type WorkplaceType = "REMOTE" | "HYBRID" | "ON_SITE" | "UNSPECIFIED";

export type EmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERN"
  | "TEMPORARY"
  | "OTHER"
  | "UNSPECIFIED";

export type PostedAtConfidence =
  | "PROVIDER_ASSERTED"
  | "OBSERVED_UNDOCUMENTED"
  | "UNKNOWN";

export type NormalizedJobLocation = Readonly<{
  label: string;
  countryCode: string | null;
}>;

export type NormalizedCompensation = Readonly<{
  kind: string | null;
  currencyCode: string | null;
  interval: string | null;
  minimum: number | null;
  maximum: number | null;
  summary: string | null;
}>;

export type NormalizedSourceJob = Readonly<{
  sourceId: string;
  provider: JobSourceProvider;
  tenantKey: string;
  externalJobId: string;
  externalJobIdBasis: "PROVIDER_ID" | "CANONICAL_URL_HASH";
  title: string;
  canonicalJobUrl: string;
  applyUrl: string;
  descriptionText: string | null;
  descriptionHtml: string | null;
  locations: readonly NormalizedJobLocation[];
  department: string | null;
  team: string | null;
  workplaceType: WorkplaceType;
  employmentType: EmploymentType;
  requisitionId: string | null;
  language: string | null;
  sourcePostedAt: string | null;
  postedAtConfidence: PostedAtConfidence;
  sourceUpdatedAt: string | null;
  listed: boolean;
  compensation: readonly NormalizedCompensation[];
  observedAt: string;
}>;

export type NormalizationIssue = Readonly<{
  recordIndex: number | null;
  code: "PAYLOAD_INVALID" | "RECORD_INVALID" | "URL_INVALID";
  message: string;
}>;

export type NormalizedSourceSnapshot = Readonly<{
  provider: JobSourceProvider;
  sourceId: string;
  tenantKey: string;
  complete: boolean;
  jobs: readonly NormalizedSourceJob[];
  issues: readonly NormalizationIssue[];
}>;

export type NormalizationContext = Readonly<{
  sourceId: string;
  tenantKey: string;
  observedAt: string;
}>;

export interface JobSourceAdapter<TSource extends RegisteredJobSource> {
  readonly provider: TSource["provider"];
  buildEndpoint(source: TSource): string;
  normalize(payload: unknown, context: NormalizationContext): NormalizedSourceSnapshot;
}

export type LoadedSourceSnapshot = Readonly<{
  kind: "LOADED";
  endpoint: string;
  etag: string | null;
  rawSha256: string;
  rawBytes: number;
  snapshot: NormalizedSourceSnapshot;
}>;

export type SupportedJobReference = Readonly<{
  provider: JobSourceProvider;
  tenantKey: string;
  externalJobId: string;
  region?: "GLOBAL" | "EU";
  canonicalInputUrl: string;
}>;

export type ResolvedPublicJob = Readonly<{
  reference: SupportedJobReference;
  endpoint: string;
  rawSha256: string;
  rawBytes: number;
  job: NormalizedSourceJob;
}>;

export type PublicJobResolutionResult =
  | Readonly<{ kind: "RESOLVED"; value: ResolvedPublicJob }>
  | Readonly<{
      kind: "UNSUPPORTED";
      code: "ATS_UNSUPPORTED" | "JOB_URL_SHAPE_UNSUPPORTED";
      message: string;
    }>
  | Readonly<{
      kind: "FAILED";
      code:
        | "FETCH_FAILED"
        | "HTTP_ERROR"
        | "BODY_TOO_LARGE"
        | "JSON_INVALID"
        | "JOB_NOT_FOUND"
        | "PAYLOAD_INVALID";
      message: string;
      retryable: boolean;
      status: number | null;
    }>;

export type SourceLoadResult =
  | LoadedSourceSnapshot
  | Readonly<{ kind: "NOT_MODIFIED"; endpoint: string; etag: string | null; observedAt: string }>
  | Readonly<{
      kind: "FAILED";
      endpoint: string | null;
      code:
        | "ENDPOINT_INVALID"
        | "FETCH_FAILED"
        | "HTTP_ERROR"
        | "BODY_TOO_LARGE"
        | "JSON_INVALID"
        | "TOO_MANY_RECORDS";
      message: string;
      retryable: boolean;
      status: number | null;
    }>;
