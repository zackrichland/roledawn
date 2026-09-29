import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.ts";
import { CANDIDATE_MATCHING_POLICY_VERSION, matchingProfileHash, rankCandidateJobs, shortlistCandidateJobs,
  type CandidateRecommendations, type MatchingCatalogJob, type MatchingIndexJob, type MatchingProfile } from "../../domain/candidate-matching.ts";
import { isUuid, parseOpportunityCatalogRows } from "../../domain/opportunity-catalog.ts";

export type MatchingScope = Readonly<{candidateId: string; workspaceId: string}>;
type Client = SupabaseClient<Database>;
const PAGE_SIZE = 500;
const MAX_CATALOG_JOBS = 25_000;
const INDEX_PAGE_SIZE = 10_000;
const MAX_INDEX_JOBS = 250_000;
const SHORTLIST_SIZE = 600;
const DETAIL_BATCH = 500;
type CatalogScan = Readonly<{jobs: readonly MatchingCatalogJob[]; complete: boolean}>;
type IndexScan = Readonly<{jobs: readonly MatchingIndexJob[]; complete: boolean}>;
type UntypedRpc = {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
// Only public job content is cached. Private profile inputs and previous
// applications are read for the current candidate on every request.
const catalogCache = new Map<string, Readonly<{expiresAt: number; value: Promise<IndexScan>}>>();

function checkedScope(scope: MatchingScope): void {
  if (!isUuid(scope.candidateId) || !isUuid(scope.workspaceId)) throw new Error("MATCHING_SCOPE_INVALID");
}
function assertRead(error: unknown, data: unknown): void {
  if (error || data === null) throw new Error("MATCHING_PROFILE_READ_FAILED");
}
export async function loadMatchingProfile(client: Client, scope: MatchingScope): Promise<MatchingProfile> {
  checkedScope(scope);
  const candidateResult = await client.from("candidates").select("application_input_version,status").eq("id",scope.candidateId).eq("workspace_id",scope.workspaceId).single();
  assertRead(candidateResult.error,candidateResult.data);
  const candidate = candidateResult.data!;
  if (!["ACTIVE","ONBOARDING","PAUSED"].includes(candidate.status)) throw new Error("MATCHING_CANDIDATE_UNAVAILABLE");
  const [search,document,evidenceItems,facts] = await Promise.all([
    client.from("candidate_search_profiles").select("aggregate_version,target_roles,preferred_locations,desired_country_codes,work_modes,employment_types").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).maybeSingle(),
    client.from("source_documents").select("id,status,current_version_number").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("document_kind","RESUME").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    client.from("candidate_evidence_items").select("id,document_id,text_review_id,current_version_number,evidence_category").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("review_status","VERIFIED"),
    client.from("candidate_facts").select("id,fact_key,current_version_number").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("verification_status","VERIFIED").eq("usage_policy","EXACT_FIELDS").like("fact_key","work_authorization.%"),
  ]);
  if (search.error || document.error || evidenceItems.error || facts.error) throw new Error("MATCHING_PROFILE_READ_FAILED");
  let reviewedResume: MatchingProfile["reviewedResume"] = null;
  if (document.data?.status === "READY") {
    const version = await client.from("source_document_versions").select("id").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("document_id",document.data.id).eq("version_number",document.data.current_version_number!).maybeSingle();
    if (version.error) throw new Error("MATCHING_PROFILE_READ_FAILED");
    if (version.data) {
      const review = await client.from("source_document_text_reviews").select("id,text_sha256").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("document_version_id",version.data.id).order("review_version_number",{ascending:false}).limit(1).maybeSingle();
      if (review.error) throw new Error("MATCHING_PROFILE_READ_FAILED");
      if (review.data) reviewedResume = {versionId:review.data.id,hash:review.data.text_sha256};
    }
  }
  const selectedItems = (evidenceItems.data ?? []).filter((item) => item.document_id === document.data?.id && item.text_review_id === reviewedResume?.versionId && item.current_version_number !== null);
  const [evidenceVersions,factVersions] = await Promise.all([
    selectedItems.length ? client.from("candidate_evidence_versions").select("id,evidence_item_id,version_number,claim_text,claim_sha256,usage_policy").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("candidate_disposition","APPROVED").in("usage_policy",["RESUME_AND_COVER_LETTER","COVER_LETTER_ONLY"]).in("evidence_item_id",selectedItems.map((item)=>item.id)) : {data:[],error:null},
    facts.data?.length ? client.from("candidate_fact_versions").select("id,fact_id,version_number,value_json").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).eq("candidate_disposition","APPROVED").in("fact_id",facts.data.map((fact)=>fact.id)) : {data:[],error:null},
  ]);
  if (evidenceVersions.error || factVersions.error) throw new Error("MATCHING_PROFILE_READ_FAILED");
  const evidence = selectedItems.flatMap((item) => {
    const version = evidenceVersions.data?.find((row)=>row.evidence_item_id===item.id && row.version_number===item.current_version_number);
    if (version && createHash("sha256").update(version.claim_text).digest("hex") !== version.claim_sha256) throw new Error("MATCHING_EVIDENCE_HASH_MISMATCH");
    return version ? [{versionId:version.id,hash:version.claim_sha256,text:version.claim_text,category:item.evidence_category}] : [];
  });
  const authorizations: MatchingProfile["workAuthorizations"] = ["US","CA"].map((countryCode) => {
    const resolved = (suffix:string) => {
      const fact = facts.data?.find((row)=>row.fact_key===`work_authorization.${countryCode.toLowerCase()}.${suffix}`);
      return factVersions.data?.find((row)=>row.fact_id===fact?.id && row.version_number===fact?.current_version_number);
    };
    const authorized = resolved("authorized"), sponsorship = resolved("sponsorship_required");
    return {countryCode, authorized:typeof authorized?.value_json === "boolean" ? authorized.value_json : null,
      sponsorshipRequired:typeof sponsorship?.value_json === "boolean" ? sponsorship.value_json : null,
      versionIds:[authorized?.id,sponsorship?.id].filter((id):id is string=>Boolean(id)).sort()};
  });
  return Object.freeze({candidateId:scope.candidateId,candidateInputEpoch:candidate.application_input_version,
    searchVersion:search.data?.aggregate_version ?? null,targetRoles:search.data?.target_roles ?? [],
    preferredLocations:search.data?.preferred_locations ?? [],desiredCountryCodes:search.data?.desired_country_codes ?? [],
    workModes:search.data?.work_modes ?? [],employmentTypes:search.data?.employment_types ?? [],reviewedResume,
    evidence:Object.freeze(evidence),workAuthorizations:Object.freeze(authorizations)});
}

export function parseMatchingCatalogPage(data: unknown): readonly MatchingCatalogJob[] {
  const items = parseOpportunityCatalogRows(data);
  return Object.freeze(items.map((item,index) => {
    const row = (data as Record<string,unknown>[])[index];
    if (typeof row.content_hash !== "string" || !/^[0-9a-f]{64}$/u.test(row.content_hash) || !Number.isSafeInteger(row.version_number) || Number(row.version_number)<1) throw new Error("MATCHING_CATALOG_ROW_INVALID");
    return {...item,contentHash:row.content_hash,versionNumber:Number(row.version_number)};
  }));
}
export async function scanMatchingCatalog(client: Client): Promise<CatalogScan> {
  const jobs: MatchingCatalogJob[] = [];
  let cursor: string | null = null;
  for (let page=0;page<MAX_CATALOG_JOBS/PAGE_SIZE;page++) {
    const result = await (client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc("matching_catalog_page",{p_after_job_id:cursor,p_limit:PAGE_SIZE});
    if (result.error) throw new Error("MATCHING_CATALOG_UNAVAILABLE");
    const rows = parseMatchingCatalogPage(result.data);
    if (rows.some((row,index)=> (index===0 ? cursor !== null && row.jobId<=cursor : row.jobId<=rows[index-1].jobId))) throw new Error("MATCHING_CATALOG_CURSOR_INVALID");
    jobs.push(...rows);
    if (rows.length<PAGE_SIZE) return {jobs:Object.freeze(jobs),complete:true};
    cursor=rows.at(-1)!.jobId;
  }
  return {jobs:Object.freeze(jobs),complete:false};
}

export function parseMatchingIndexPage(data: unknown): readonly MatchingIndexJob[] {
  if (!Array.isArray(data)) throw new Error("MATCHING_INDEX_ROW_INVALID");
  return Object.freeze(data.map((value) => {
    const row = (value ?? {}) as Record<string, unknown>;
    if (!isUuid(String(row.job_id ?? "")) || typeof row.title !== "string" || typeof row.employer_name !== "string"
      || typeof row.observed_at !== "string") throw new Error("MATCHING_INDEX_ROW_INVALID");
    return Object.freeze({
      jobId: String(row.job_id),
      title: row.title,
      employerName: row.employer_name,
      location: typeof row.location_text === "string" ? row.location_text : null,
      workMode: typeof row.work_mode === "string" ? row.work_mode : null,
      employmentType: typeof row.employment_type === "string" ? row.employment_type : null,
      observedAt: row.observed_at,
    });
  }));
}

/** Stage one: the compact index of every fresh job (no descriptions). */
export async function scanMatchingIndex(client: Client): Promise<IndexScan> {
  const jobs: MatchingIndexJob[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_INDEX_JOBS / INDEX_PAGE_SIZE; page++) {
    // One JSON value per page: set-returning RPCs are capped at 1000 rows.
    const result = await (client as unknown as UntypedRpc).rpc("matching_catalog_index_json", {p_after_job_id: cursor, p_limit: INDEX_PAGE_SIZE});
    if (result.error) throw new Error("MATCHING_CATALOG_UNAVAILABLE");
    const rows = parseMatchingIndexPage(result.data);
    if (rows.some((row, index) => (index === 0 ? cursor !== null && row.jobId <= cursor : row.jobId <= rows[index - 1].jobId))) throw new Error("MATCHING_CATALOG_CURSOR_INVALID");
    jobs.push(...rows);
    if (rows.length < INDEX_PAGE_SIZE) return {jobs: Object.freeze(jobs), complete: true};
    cursor = rows.at(-1)!.jobId;
  }
  return {jobs: Object.freeze(jobs), complete: false};
}

/** Stage two: full postings for the shortlist only. */
export async function fetchMatchingJobs(client: Client, jobIds: readonly string[]): Promise<readonly MatchingCatalogJob[]> {
  const jobs: MatchingCatalogJob[] = [];
  for (let start = 0; start < jobIds.length; start += DETAIL_BATCH) {
    const batch = jobIds.slice(start, start + DETAIL_BATCH);
    const result = await (client as unknown as UntypedRpc).rpc("matching_catalog_jobs", {p_job_ids: batch});
    if (result.error) throw new Error("MATCHING_CATALOG_UNAVAILABLE");
    jobs.push(...parseMatchingCatalogPage(result.data));
  }
  return Object.freeze(jobs);
}

async function cachedIndex(client: Client, now: Date, useCache: boolean): Promise<IndexScan> {
  // supabaseUrl identifies the database, never an API key or candidate identity.
  const key = (client as unknown as {supabaseUrl?:string}).supabaseUrl;
  if (!useCache || !key) return scanMatchingIndex(client);
  const existing = catalogCache.get(key);
  if (existing && existing.expiresAt>now.getTime()) return existing.value;
  const value = scanMatchingIndex(client);
  catalogCache.set(key,{value,expiresAt:now.getTime()+60_000});
  try { return await value; } catch (error) { catalogCache.delete(key); throw error; }
}

export async function loadCandidateJobHistory(client: Client, scope: MatchingScope): Promise<Readonly<{applied:ReadonlySet<string>;passed:ReadonlySet<string>;saved:ReadonlySet<string>}>> {
  checkedScope(scope);
  async function history(table:"applications"|"candidate_job_decisions") {
    const rows: {id:string;job_id:string|null;decision?:string}[]=[];
    let after:string|null=null;
    for(let page=0;page<100;page++) {
      let query=table==="applications"
        ? client.from("applications").select("id,job_id").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).order("id").limit(500)
        : client.from("candidate_job_decisions").select("id,job_id,decision").eq("candidate_id",scope.candidateId).eq("workspace_id",scope.workspaceId).is("undone_at",null).order("id").limit(500);
      if(after) query=query.gt("id",after);
      const result=await query;
      if(result.error || !result.data) throw new Error("MATCHING_HISTORY_READ_FAILED");
      const entries=result.data as {id:string;job_id:string|null;decision?:string}[];
      if(entries.some((entry,index)=>index===0 ? after!==null && entry.id<=after : entry.id<=entries[index-1].id)) throw new Error("MATCHING_HISTORY_CURSOR_INVALID");
      rows.push(...entries);
      if(entries.length<500) return rows;
      after=entries.at(-1)!.id;
    }
    throw new Error("MATCHING_HISTORY_LIMIT_REACHED");
  }
  const [applications,decisions]=await Promise.all([history("applications"),history("candidate_job_decisions")]);
  return {applied:new Set(applications.flatMap(row=>row.job_id?[row.job_id]:[])),
    passed:new Set(decisions.flatMap(row=>row.decision==="PASSED" && row.job_id?[row.job_id]:[])),
    saved:new Set(decisions.flatMap(row=>row.decision==="SAVED" && row.job_id?[row.job_id]:[]))};
}

export async function loadCandidateRecommendations(
  client: Client, scope: MatchingScope, options: Readonly<{limit?:number;now?:Date;useCatalogCache?:boolean;automaticSelection?:boolean}> = {},
): Promise<CandidateRecommendations> {
  checkedScope(scope);
  const profile = await loadMatchingProfile(client,scope);
  const [index,history] = await Promise.all([
    cachedIndex(client,options.now ?? new Date(),options.useCatalogCache !== false),
    loadCandidateJobHistory(client,scope),
  ]);
  const {applied,passed,saved}=history;
  const open = index.jobs.filter((job)=>!applied.has(job.jobId) && !passed.has(job.jobId));
  const shortlist = shortlistCandidateJobs(profile,open,SHORTLIST_SIZE);
  const details = await fetchMatchingJobs(client,shortlist);
  const catalog = {jobs:index.jobs,complete:index.complete};
  const jobs = details.map((job)=>({...job,saved:saved.has(job.jobId)}));
  let items = rankCandidateJobs(profile,jobs,options.limit ?? 24,{automaticSelection:options.automaticSelection});
  // Detect private changes during the catalog scan. No partial/stale read may
  // become an automatic selection, even if a UI preview can still explain it.
  const current = await client.from("candidates").select("application_input_version").eq("id",scope.candidateId).eq("workspace_id",scope.workspaceId).single();
  assertRead(current.error,current.data);
  const stable = current.data!.application_input_version === profile.candidateInputEpoch;
  const complete = catalog.complete && stable;
  if (!complete) items = items.map((job)=>({...job,matching:{...job.matching,autoApplyEligible:false}}));
  return Object.freeze({profileHash:matchingProfileHash(profile),policyVersion:CANDIDATE_MATCHING_POLICY_VERSION,
    candidateInputEpoch:profile.candidateInputEpoch,scannedJobs:catalog.jobs.length,complete,items,
    diagnostics:Object.freeze([...(catalog.complete?[]:["CATALOG_SCAN_LIMIT_REACHED"]),...(stable?[]:["PROFILE_CHANGED_DURING_MATCHING"]),
      ...(profile.evidence.length?[]:["APPROVED_EXPERIENCE_REQUIRED"]),...(profile.targetRoles.length?[]:["TARGET_ROLES_REQUIRED"])])});
}
