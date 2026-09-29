/**
 * Verifies candidate public ATS job boards before they enter a reviewed source
 * registry (`data/job-sources/reviewed-*.json`).
 *
 *   node --experimental-strip-types scripts/verify-job-boards.ts <candidates.json> <out.json> [--resume]
 *
 * Candidates: a JSON array, or `{ "candidates": [...] }`, of
 * `{ provider: "GREENHOUSE"|"LEVER"|"ASHBY", token, employerName, industry, category? }`.
 * `--resume` reuses observations already recorded in <out.json> for the same
 * provider and token. Transient failures are probed again, and so is every
 * board that answered 2xx under an older ANALYSIS_VERSION.
 *
 * Output: one result per candidate with the observation, an identity verdict
 * (provider label or posting text naming the employer), and, for passing
 * boards, a registry-ready entry. Identity mismatches need manual review before
 * an entry is copied into a reviewed registry file.
 *
 * Safety: unauthenticated, read-only GETs to fixed provider origins only; at
 * most four requests in flight; a 12-second timeout (the production catalog
 * fetch default); one retry for transient failures; no database access and no
 * form submission. Listing requests go through the production fetch port,
 * loader, adapters and snapshot serializer, so a pass means the daily catalog
 * worker can ingest the same complete board snapshot.
 *
 * Pass = HTTP 200, 5–5,000 postings, response ≤ 20 MiB, production snapshot
 * accepted, and ≥ 30% of postings with a US location signal. The US signal is a
 * heuristic over location text and structured country fields; it is an
 * inclusion screen, not a claim about where any individual role can be filled.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  JobSourceProvider,
  RegisteredJobSource,
  SourceFetchPort,
  SourceFetchResponse,
  SourceLoadResult,
} from "../src/server/ingestion/contracts.ts";
import {
  buildAshbyJobBoardEndpoint,
  buildGreenhouseJobsEndpoint,
  buildLeverPostingsEndpoint,
} from "../src/server/ingestion/endpoints.ts";
import { createNativeJobApiFetchPort } from "../src/server/ingestion/fetch-port.ts";
import {
  DEFAULT_MAX_SOURCE_RECORDS,
  DEFAULT_MAX_SOURCE_RESPONSE_BYTES,
  loadRegisteredJobSource,
} from "../src/server/ingestion/load-source.ts";
import { parseReviewedJobSourceRegistry, type ReviewedJobSource } from "../src/server/ingestion/source-registry.ts";
import { serializeSourceSnapshot } from "../src/server/ingestion/source-snapshot.ts";

const USER_AGENT = "RoleDawn catalog verifier (contact: ops@roledawn.invalid)";
const MAX_IN_FLIGHT = 4;
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 2_000;
const LABEL_MAX_BYTES = 3 * 1024 * 1024;
const CHECKPOINT_EVERY = 20;
const MIN_JOBS = 5;
const MAX_JOBS = DEFAULT_MAX_SOURCE_RECORDS;
const MAX_BYTES = DEFAULT_MAX_SOURCE_RESPONSE_BYTES;
const MIN_US_SHARE = 0.3;
const PROVIDERS: readonly JobSourceProvider[] = ["GREENHOUSE", "LEVER", "ASHBY"];
const TENANT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const TRANSIENT_REASONS = new Set<FailureReason>(["TIMEOUT", "NETWORK_ERROR", "HTTP_RETRYABLE"]);
/** Bump when payload analysis changes; `--resume` then re-probes every board that answered 2xx. */
const ANALYSIS_VERSION = 3;
const MIN_EMPLOYER_MENTION_SHARE = 0.5;

type Candidate = Readonly<{
  provider: JobSourceProvider;
  token: string;
  employerName: string;
  industry: string;
  category: string | null;
}>;

type FailureReason =
  | "ENDPOINT_INVALID"
  | "NOT_FOUND"
  | "HTTP_RETRYABLE"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "CONTENT_TYPE_INVALID"
  | "RESPONSE_TOO_LARGE"
  | "JSON_INVALID"
  | "TOO_FEW_JOBS"
  | "TOO_MANY_JOBS"
  | "SNAPSHOT_REJECTED"
  | "LOW_US_SHARE";

type Region = "US" | "NON_US" | "UNKNOWN";

/** Everything observed from the network. Derived identity and registry fields are recomputed per run. */
type Observation = {
  analysisVersion: number;
  outcome: "PASS" | "FAIL";
  reason: FailureReason | null;
  detail: string | null;
  httpStatus: number | null;
  attempts: number;
  verifiedAt: string | null;
  elapsedMs: number | null;
  openJobs: number | null;
  listedJobs: number | null;
  responseBytes: number | null;
  usJobs: number | null;
  nonUsJobs: number | null;
  unknownLocationJobs: number | null;
  usShare: number | null;
  sampleTitles: string[];
  employerMentionShare: number | null;
  snapshotAccepted: boolean | null;
  snapshotIssue: string | null;
  boardLabel: string | null;
  boardLabelSource: string | null;
  boardLabelUrl: string | null;
  boardLabelStatus: number | null;
  boardWebsite: string | null;
};

type CandidateResult = Candidate & Observation & {
  apiUrl: string;
  publicBoardUrl: string;
  identity: "LABEL_MATCH" | "CONTENT_MATCH" | "LABEL_MISMATCH" | "LABEL_UNAVAILABLE" | null;
  registryEntry: ReviewedJobSource | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized || null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function parseCandidates(input: unknown): Candidate[] {
  const list = Array.isArray(input) ? input : isRecord(input) && Array.isArray(input.candidates) ? input.candidates : null;
  if (!list || list.length === 0) throw new Error("CANDIDATES_INVALID: expected a non-empty array or { candidates: [...] }");
  const seen = new Set<string>();
  return list.map((raw: unknown, index: number): Candidate => {
    const where = `candidate ${index}`;
    if (!isRecord(raw)) throw new Error(`CANDIDATES_INVALID: ${where} is not an object`);
    const provider = PROVIDERS.find((value) => value === raw.provider);
    const token = typeof raw.token === "string" ? raw.token.trim() : "";
    const employerName = text(raw.employerName);
    const industry = text(raw.industry);
    const category = raw.category === undefined || raw.category === null ? null : text(raw.category);
    if (!provider) throw new Error(`CANDIDATES_INVALID: ${where} has an unsupported provider`);
    if (!TENANT_KEY_PATTERN.test(token)) throw new Error(`CANDIDATES_INVALID: ${where} has an invalid token`);
    if (!employerName || employerName.length > 200) throw new Error(`CANDIDATES_INVALID: ${where} needs employerName`);
    if (!industry || industry.length > 120) throw new Error(`CANDIDATES_INVALID: ${where} needs industry`);
    if (raw.category !== undefined && raw.category !== null && (!category || category.length > 120)) {
      throw new Error(`CANDIDATES_INVALID: ${where} has an invalid category`);
    }
    const key = candidateKey({ provider, token });
    if (seen.has(key)) throw new Error(`CANDIDATES_INVALID: duplicate ${key}`);
    seen.add(key);
    return { provider, token, employerName, industry, category };
  });
}

function candidateKey(candidate: Readonly<{ provider: JobSourceProvider; token: string }>): string {
  return `${candidate.provider}:${candidate.token.toLowerCase()}`;
}

function registeredSource(candidate: Candidate): RegisteredJobSource {
  const sourceId = `registry:${candidate.provider}:${candidate.token}`;
  switch (candidate.provider) {
    case "GREENHOUSE": return { sourceId, provider: "GREENHOUSE", tenantKey: candidate.token, includeContent: true };
    case "LEVER": return { sourceId, provider: "LEVER", tenantKey: candidate.token };
    case "ASHBY": return { sourceId, provider: "ASHBY", tenantKey: candidate.token, includeCompensation: true };
  }
}

/** Mirrors `parseReviewedJobSourceRegistry` so a passing board is registry-ready. */
function registryUrls(source: RegisteredJobSource): Readonly<{ apiUrl: string; publicBoardUrl: string }> {
  switch (source.provider) {
    case "GREENHOUSE": return { apiUrl: buildGreenhouseJobsEndpoint(source), publicBoardUrl: `https://job-boards.greenhouse.io/${source.tenantKey}` };
    case "LEVER": return { apiUrl: buildLeverPostingsEndpoint(source), publicBoardUrl: `https://jobs.lever.co/${source.tenantKey}` };
    case "ASHBY": return { apiUrl: buildAshbyJobBoardEndpoint(source), publicBoardUrl: `https://jobs.ashbyhq.com/${source.tenantKey}` };
  }
}

// ---------------------------------------------------------------------------
// US location heuristic
// ---------------------------------------------------------------------------

const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
  "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
  "Puerto Rico",
];
const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
];
/** State codes that double as common ISO country codes ("Bengaluru, IN", "Berlin, DE", "Toronto, CA"). */
const COLLIDING_STATE_CODES = new Set(["AL", "AR", "AZ", "CA", "CO", "DE", "GA", "ID", "IL", "IN", "MA", "MD", "ME", "MT", "PA"]);
const US_CITIES = [
  "New York", "Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "Long Island", "San Francisco",
  "Bay Area", "Silicon Valley", "Los Angeles", "Chicago", "Seattle", "Boston", "Austin", "Denver", "Atlanta",
  "Miami", "Dallas", "Houston", "Phoenix", "Philadelphia", "San Diego", "San Jose", "Palo Alto", "Mountain View",
  "Menlo Park", "Sunnyvale", "Santa Clara", "Redwood City", "Oakland", "Berkeley", "Emeryville", "San Mateo",
  "Foster City", "Burlingame", "Cupertino", "Milpitas", "Fremont", "Pleasanton", "Walnut Creek", "Santa Monica",
  "Culver City", "Playa Vista", "El Segundo", "Hawthorne", "Long Beach", "Torrance", "Irvine", "Costa Mesa",
  "Newport Beach", "Pasadena", "Burbank", "Sacramento", "Fresno", "Salt Lake City", "Lehi", "Provo",
  "Minneapolis", "Saint Paul", "St. Paul", "Twin Cities", "Detroit", "Ann Arbor", "Grand Rapids", "Pittsburgh",
  "Nashville", "Memphis", "Knoxville", "Chattanooga", "Charlotte", "Raleigh", "Durham", "Chapel Hill",
  "Research Triangle", "Columbus", "Cleveland", "Cincinnati", "Indianapolis", "Saint Louis", "St. Louis",
  "Kansas City", "Omaha", "Milwaukee", "Baltimore", "Tampa", "Orlando", "Jacksonville", "Fort Lauderdale",
  "Boca Raton", "West Palm Beach", "Las Vegas", "Reno", "Boise", "Spokane", "Tacoma", "Bellevue", "Redmond",
  "Kirkland", "Portland", "Albuquerque", "Tucson", "Scottsdale", "Tempe", "Chandler", "Plano", "Frisco",
  "Irving", "Fort Worth", "San Antonio", "El Paso", "Round Rock", "The Woodlands", "Somerville", "Waltham",
  "Providence", "Hartford", "Stamford", "New Haven", "Jersey City", "Hoboken", "Newark", "Princeton",
  "Morristown", "White Plains", "Buffalo", "Syracuse", "Albany", "Reston", "Herndon", "McLean", "Tysons",
  "Arlington", "Bethesda", "Rockville", "Gaithersburg", "Annapolis", "Virginia Beach", "Charleston", "Greenville",
  "Savannah", "Huntsville", "New Orleans", "Baton Rouge", "Louisville", "Des Moines", "Oklahoma City", "Tulsa",
  "Little Rock", "Honolulu", "Anchorage", "Colorado Springs", "Boulder", "Fort Collins", "Bozeman", "Fargo",
  "Sioux Falls", "Wichita", "Lansing", "Toledo", "Akron", "Dayton", "Fort Wayne", "South Bend", "Naperville",
  "Evanston", "Schaumburg", "Green Bay", "Sarasota", "Gainesville", "Tallahassee", "Asheville", "Greensboro",
  "Winston-Salem", "Cary", "Allentown", "Harrisburg", "King of Prussia", "Conshohocken", "Long Island City",
  "New England", "Tri-State Area",
];
const NON_US_PLACES = [
  // Countries and regions
  "Canada", "(?<!New )Mexico", "United Kingdom", "(?<!New )England", "Scotland", "Wales", "Northern Ireland",
  "Ireland", "Germany", "Deutschland", "France", "Spain", "España", "Portugal", "Italy", "Italia", "Netherlands",
  "Holland", "Belgium", "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland", "Iceland", "Poland",
  "Czech Republic", "Czechia", "Slovakia", "Hungary", "Romania", "Bulgaria", "Greece", "Turkey", "Türkiye",
  "Israel", "India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "China", "Hong Kong", "Taiwan", "Japan",
  "Korea", "Singapore", "Malaysia", "Indonesia", "Philippines", "Vietnam", "Thailand", "Australia",
  "New Zealand", "Brazil", "Brasil", "Argentina", "Chile", "Colombia", "Peru", "Uruguay", "Paraguay", "Bolivia",
  "Ecuador", "Venezuela", "Costa Rica", "Panama", "Guatemala", "Honduras", "El Salvador", "Nicaragua",
  "Dominican Republic", "Jamaica", "United Arab Emirates", "UAE", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain",
  "Egypt", "Morocco", "Nigeria", "Kenya", "Ghana", "South Africa", "Ethiopia", "Rwanda", "Uganda", "Ukraine",
  "Russia", "Serbia", "Croatia", "Slovenia", "Lithuania", "Latvia", "Estonia", "Luxembourg", "Malta", "Cyprus",
  "Armenia", "Kazakhstan", "EMEA", "APAC", "APJ", "LATAM", "Europe", "Asia", "Africa", "Middle East", "Oceania",
  "Ontario", "Quebec", "Québec", "British Columbia", "Alberta", "Manitoba", "Nova Scotia",
  // Cities
  "London", "Dublin", "Toronto", "Vancouver", "Montreal", "Montréal", "Ottawa", "Calgary", "Edmonton",
  "Winnipeg", "Kitchener", "Berlin", "Munich", "München", "Hamburg", "Frankfurt", "Cologne", "Köln",
  "Düsseldorf", "Stuttgart", "Paris", "Lyon", "Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven",
  "Brussels", "Antwerp", "Zurich", "Zürich", "Geneva", "Basel", "Lausanne", "Vienna", "Madrid", "Barcelona",
  "Lisbon", "Porto", "Milan", "Rome", "Turin", "Stockholm", "Gothenburg", "Copenhagen", "Oslo", "Helsinki",
  "Warsaw", "Krakow", "Kraków", "Wroclaw", "Wrocław", "Gdansk", "Prague", "Brno", "Budapest", "Bucharest",
  "Cluj", "Sofia", "Istanbul", "Tel Aviv", "Jerusalem", "Haifa", "Herzliya", "Bangalore", "Bengaluru",
  "Hyderabad", "Pune", "Mumbai", "Delhi", "Gurgaon", "Gurugram", "Noida", "Chennai", "Kolkata", "Ahmedabad",
  "Karachi", "Lahore", "Islamabad", "Dhaka", "Colombo", "Beijing", "Shanghai", "Shenzhen", "Guangzhou",
  "Hangzhou", "Tokyo", "Osaka", "Seoul", "Taipei", "Kuala Lumpur", "Jakarta", "Manila", "Cebu", "Ho Chi Minh",
  "Hanoi", "Bangkok", "Sydney", "Melbourne", "Brisbane", "Adelaide", "Auckland", "Wellington", "São Paulo",
  "Sao Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Florianópolis", "Mexico City", "Guadalajara",
  "Monterrey", "Buenos Aires", "Santiago", "Bogotá", "Bogota", "Medellín", "Medellin", "Lima", "Montevideo",
  "Quito", "Cape Town", "Johannesburg", "Lagos", "Nairobi", "Cairo", "Accra", "Kigali", "Kyiv", "Kiev", "Lviv",
  "Belgrade", "Zagreb", "Ljubljana", "Vilnius", "Riga", "Tallinn", "Edinburgh", "Glasgow", "Leeds", "Belfast",
  "Cardiff", "Cork", "Galway", "Limerick", "Dubai", "Abu Dhabi", "Riyadh", "Doha",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const US_COUNTRY_CASED = /(?<![A-Za-z])(?:US|USA|U\.S\.(?:A\.)?)(?![A-Za-z])/u;
const US_COUNTRY_ANY_CASE = /\b(?:united states|usa)\b/iu;
const US_STATE_NAME = new RegExp(`\\b(?:${US_STATE_NAMES.map(escapeRegExp).join("|")})\\b`, "iu");
const US_STATE_CODE_AFTER_COMMA = new RegExp(`,\\s*(${US_STATE_CODES.join("|")})(?![A-Za-z])`, "u");
const US_STATE_NAME_AFTER_COMMA = new RegExp(`,\\s*(?:${US_STATE_NAMES.map(escapeRegExp).join("|")})\\b`, "iu");
const US_CITY = new RegExp(`\\b(?:${US_CITIES.map(escapeRegExp).join("|")})\\b`, "iu");
const US_CITY_CASED = /(?<![A-Za-z])(?:NYC|SF|LA|DFW|DMV)(?![A-Za-z])/u;
// NON_US_PLACES entries may carry lookbehinds, so they are not escaped; none contain other metacharacters.
const NON_US_PLACE = new RegExp(`(?<![\\p{L}])(?:${NON_US_PLACES.join("|")})(?![\\p{L}])`, "iu");
const NON_US_CASED = /(?<![A-Za-z])(?:UK|GB|GBR)(?![A-Za-z])|,\s*(?:ON|BC|QC|AB|MB|SK|NS|NB|NL|PE)(?![A-Za-z])/u;
const US_COUNTRY_VALUES = new Set(["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"]);

function classifyLocationText(value: string): Region {
  const location = value.replace(/\s+/gu, " ").trim();
  if (!location) return "UNKNOWN";
  if (US_COUNTRY_CASED.test(location) || US_COUNTRY_ANY_CASE.test(location)) return "US";
  const stateCode = US_STATE_CODE_AFTER_COMMA.exec(location)?.[1] ?? null;
  if (stateCode && !COLLIDING_STATE_CODES.has(stateCode)) return "US";
  // "Brisbane, California" or "Dublin, Ohio": an explicit state outranks a foreign-sounding city.
  if (US_STATE_NAME_AFTER_COMMA.test(location)) return "US";
  if (NON_US_PLACE.test(location) || NON_US_CASED.test(location)) return "NON_US";
  if (stateCode || US_STATE_NAME.test(location) || US_CITY.test(location) || US_CITY_CASED.test(location)) return "US";
  return "UNKNOWN";
}

function classifyCountry(value: string): Region {
  const country = value.trim().toLowerCase();
  if (!country) return "UNKNOWN";
  return US_COUNTRY_VALUES.has(country) ? "US" : "NON_US";
}

type PostingSignals = Readonly<{ texts: readonly string[]; countries: readonly string[] }>;

function classifyPosting(signals: PostingSignals): Region {
  let nonUs = false;
  for (const country of signals.countries) {
    const region = classifyCountry(country);
    if (region === "US") return "US";
    if (region === "NON_US") nonUs = true;
  }
  for (const location of signals.texts) {
    const region = classifyLocationText(location);
    if (region === "US") return "US";
    if (region === "NON_US") nonUs = true;
  }
  return nonUs ? "NON_US" : "UNKNOWN";
}

function strings(values: readonly unknown[]): string[] {
  return values.map(text).filter((value): value is string => value !== null);
}

function addressCountry(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const postal = isRecord(value.postalAddress) ? value.postalAddress : value;
  return postal.addressCountry;
}

/** Provider-specific location signals, read from the raw public payload. */
function postingSignals(provider: JobSourceProvider, payload: unknown): PostingSignals[] {
  if (provider === "LEVER") {
    if (!Array.isArray(payload)) return [];
    return payload.filter(isRecord).map((posting) => {
      const categories = isRecord(posting.categories) ? posting.categories : {};
      const all = Array.isArray(categories.allLocations) ? categories.allLocations : [];
      return { texts: strings([categories.location, ...all]), countries: strings([posting.country]) };
    });
  }
  const jobs = isRecord(payload) && Array.isArray(payload.jobs) ? payload.jobs.filter(isRecord) : [];
  if (provider === "GREENHOUSE") {
    return jobs.map((job) => {
      const offices = Array.isArray(job.offices) ? job.offices.filter(isRecord) : [];
      const location = isRecord(job.location) ? job.location.name : null;
      return { texts: strings([location, ...offices.flatMap((office) => [office.name, office.location])]), countries: [] };
    });
  }
  return jobs.map((job) => {
    const secondary = Array.isArray(job.secondaryLocations) ? job.secondaryLocations.filter(isRecord) : [];
    return {
      texts: strings([job.location, ...secondary.map((location) => location.location)]),
      countries: strings([addressCountry(job.address), ...secondary.map((location) => addressCountry(location.address))]),
    };
  });
}

function rawPostingCount(provider: JobSourceProvider, payload: unknown): number | null {
  if (provider === "LEVER") return Array.isArray(payload) ? payload.length : null;
  return isRecord(payload) && Array.isArray(payload.jobs) ? payload.jobs.length : null;
}

// ---------------------------------------------------------------------------
// Board ownership label (provider metadata or provider-hosted board page)
// ---------------------------------------------------------------------------

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, code: string) => {
    const lower = code.toLowerCase();
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
    if (named[lower]) return named[lower];
    const point = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

function cleanBoardLabel(value: string | null): string | null {
  if (!value) return null;
  const label = decodeEntities(value).replace(/\s+/gu, " ").trim()
    .replace(/^(?:careers|jobs|job openings|open positions|current openings)\s+(?:at|@|with)\s+/iu, "")
    .replace(/\s*[-–—|:]\s*(?:careers|jobs|job board|open positions|current openings)$/iu, "")
    .replace(/\s+(?:careers|jobs|job board)$/iu, "")
    .trim();
  if (/^(?:careers|jobs|job board|open positions)$/iu.test(label)) return null;
  return label.length > 0 && label.length <= 200 ? label : null;
}

type BoundedText = Readonly<{ status: number; body: string }>;

/** Fixed provider origins only; stops reading once `done` finds what it needs. */
async function fetchBoundedText(url: string, accept: string, done: (body: string) => boolean): Promise<BoundedText | null> {
  const origin = new URL(url).origin;
  if (!["https://boards-api.greenhouse.io", "https://jobs.lever.co", "https://jobs.ashbyhq.com"].includes(origin)) {
    throw new Error("LABEL_ORIGIN_NOT_ALLOWED");
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept, "user-agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      return { status: response.status, body: "" };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    try {
      while (true) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        bytes += value.byteLength;
        body += decoder.decode(value, { stream: true });
        if (done(body) || bytes > LABEL_MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

async function fetchLabelSource(url: string, accept: string, done: (body: string) => boolean): Promise<BoundedText | null> {
  const first = await fetchBoundedText(url, accept, done);
  if (first && first.status !== 429 && first.status < 500) return first;
  await delay(RETRY_DELAY_MS);
  return fetchBoundedText(url, accept, done);
}

type BoardLabel = Readonly<{ label: string | null; source: string | null; url: string; status: number | null; website: string | null }>;

async function fetchBoardLabel(candidate: Candidate): Promise<BoardLabel> {
  const token = encodeURIComponent(candidate.token);
  if (candidate.provider === "GREENHOUSE") {
    const url = `https://boards-api.greenhouse.io/v1/boards/${token}`;
    const response = await fetchLabelSource(url, "application/json", () => false);
    let label: string | null = null;
    try {
      const payload: unknown = response?.status === 200 ? JSON.parse(response.body) : null;
      label = isRecord(payload) ? text(payload.name) : null;
    } catch {
      label = null;
    }
    return { label, source: label ? "GREENHOUSE_BOARD_METADATA" : null, url, status: response?.status ?? null, website: null };
  }
  if (candidate.provider === "LEVER") {
    const url = `https://jobs.lever.co/${token}`;
    const response = await fetchLabelSource(url, "text/html", (body) => body.includes("</title>"));
    const label = response?.status === 200 ? text(/<title>([^<]*)<\/title>/iu.exec(response.body)?.[1] ?? null) : null;
    return { label, source: label ? "LEVER_HOSTED_BOARD_TITLE" : null, url, status: response?.status ?? null, website: null };
  }
  const url = `https://jobs.ashbyhq.com/${token}`;
  const organization = /"organization":\{"organizationId":"[^"]*","name":"((?:[^"\\]|\\.)*)"(?:,"publicWebsite":"((?:[^"\\]|\\.)*)")?/u;
  const response = await fetchLabelSource(url, "text/html", (body) => organization.test(body));
  const status = response?.status ?? null;
  if (response?.status !== 200) return { label: null, source: null, url, status, website: null };
  const match = organization.exec(response.body);
  const unescape = (value: string | undefined): string | null => {
    if (!value) return null;
    try {
      return text(JSON.parse(`"${value}"`));
    } catch {
      return null;
    }
  };
  const orgName = unescape(match?.[1]);
  if (orgName) return { label: orgName, source: "ASHBY_HOSTED_BOARD_ORGANIZATION", url, status, website: unescape(match?.[2]) };
  const title = cleanBoardLabel(text(/<title>([^<]*)<\/title>/iu.exec(response.body)?.[1] ?? null));
  return { label: title, source: title ? "ASHBY_HOSTED_BOARD_TITLE" : null, url, status, website: null };
}

const NAME_NOISE = new Set([
  "inc", "llc", "ltd", "limited", "co", "corp", "corporation", "company", "the", "and", "of", "pbc", "plc",
  "group", "holdings", "careers", "career", "jobs", "job", "board", "usa", "us", "hq", "team",
]);

function nameTokens(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/&/gu, " and ")
    .split(/[^a-z0-9]+/u).filter((token) => token.length > 0 && !NAME_NOISE.has(token));
}

/** True when one token list starts with the other ("Ro" / "Ro Health"), never on a bare substring ("Ro" / "Romeo"). */
function tokenPrefix(left: readonly string[], right: readonly string[]): boolean {
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length > 0 && shorter.every((token, index) => longer[index] === token);
}

function prefixKeys(tokens: readonly string[]): string[] {
  return tokens.map((_, index) => tokens.slice(0, index + 1).join(""));
}

/**
 * Conservative ownership check against the reviewed employer name; a mismatch only routes the board
 * to manual review. The board token is deliberately ignored: a token read from a careers page or
 * guessed from a brand ("air", "kodiak") says nothing about who owns the board.
 */
function labelMatchesEmployer(label: string, employerName: string): boolean {
  const labelTokens = nameTokens(label);
  const employerTokens = nameTokens(employerName);
  const labelKey = labelTokens.join("");
  const employerKey = employerTokens.join("");
  if (labelKey.length < 2) return false;
  if (labelKey === employerKey || tokenPrefix(labelTokens, employerTokens)) return true;
  if (prefixKeys(labelTokens).includes(employerKey) || prefixKeys(employerTokens).includes(labelKey)) return true;
  const [labelBrand] = labelTokens;
  return labelBrand !== undefined && labelBrand.length >= 4 && labelBrand === employerTokens[0];
}

/**
 * "Anysphere (Cursor)" -> ["Anysphere", "Cursor"]. Matching is case-sensitive and word-bounded, and
 * needles shorter than four characters are ignored, so "xAI" cannot match inside "SpaceXAI" and a
 * lower-case common word ("better", "figure") cannot stand in for a brand. Corroborating evidence only.
 */
function employerNeedles(name: string): RegExp[] {
  const variants = [name.replace(/\([^)]*\)/gu, " "), ...Array.from(name.matchAll(/\(([^)]+)\)/gu), (match) => match[1])];
  return [...new Set(variants.map((value) => value.replace(/\s+/gu, " ").replace(/^The /u, "").trim()))]
    .filter((value) => value.length >= 4)
    .map((value) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "u"));
}

function employerMentionShare(name: string, descriptions: readonly (string | null)[]): number | null {
  const needles = employerNeedles(name);
  if (needles.length === 0 || descriptions.length === 0) return null;
  const mentioned = descriptions.filter((description) => needles.some((needle) => needle.test(description ?? ""))).length;
  return Number((mentioned / descriptions.length).toFixed(4));
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

function failureReason(result: Extract<SourceLoadResult, { kind: "FAILED" }>): FailureReason {
  switch (result.code) {
    case "ENDPOINT_INVALID": return "ENDPOINT_INVALID";
    case "BODY_TOO_LARGE": return "RESPONSE_TOO_LARGE";
    case "JSON_INVALID": return "JSON_INVALID";
    case "TOO_MANY_RECORDS": return "TOO_MANY_JOBS";
    case "HTTP_ERROR":
      if (result.status === 404) return "NOT_FOUND";
      return result.retryable ? "HTTP_RETRYABLE" : "HTTP_ERROR";
    case "NOT_MODIFIED_UNEXPECTED": return "HTTP_ERROR";
    case "FETCH_TIMEOUT": return "TIMEOUT";
    case "FETCH_FAILED":
      if (result.message.includes("JOB_API_RESPONSE_TOO_LARGE")) return "RESPONSE_TOO_LARGE";
      if (result.message.includes("JOB_API_RESPONSE_CONTENT_TYPE_INVALID")) return "CONTENT_TYPE_INVALID";
      if (/time(?:d)?\s?out|aborted/iu.test(result.message)) return "TIMEOUT";
      return "NETWORK_ERROR";
  }
}

function emptyObservation(): Observation {
  return {
    analysisVersion: ANALYSIS_VERSION, outcome: "FAIL", reason: null, detail: null, httpStatus: null, attempts: 0, verifiedAt: null, elapsedMs: null,
    openJobs: null, listedJobs: null, responseBytes: null, usJobs: null, nonUsJobs: null, unknownLocationJobs: null,
    usShare: null, sampleTitles: [], employerMentionShare: null, snapshotAccepted: null, snapshotIssue: null,
    boardLabel: null, boardLabelSource: null, boardLabelUrl: null, boardLabelStatus: null, boardWebsite: null,
  };
}

async function observe(candidate: Candidate, port: SourceFetchPort): Promise<Observation> {
  const observation = emptyObservation();
  const source = registeredSource(candidate);
  let captured: SourceFetchResponse | null = null;
  const capturingPort: SourceFetchPort = {
    async fetch(request) {
      const response = await port.fetch(request);
      captured = response;
      return response;
    },
  };

  let result: SourceLoadResult;
  for (;;) {
    observation.attempts += 1;
    captured = null;
    const started = performance.now();
    result = await loadRegisteredJobSource(source, capturingPort, { maxResponseBytes: MAX_BYTES, maxRecords: MAX_JOBS });
    observation.elapsedMs = Math.round(performance.now() - started);
    if (result.kind === "FAILED" && observation.attempts < 2 && TRANSIENT_REASONS.has(failureReason(result))) {
      await delay(RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  const response = captured as SourceFetchResponse | null;
  observation.httpStatus = result.kind === "FAILED" ? result.status : result.responseStatus;
  observation.verifiedAt = response?.observedAt ?? null;
  if (response && response.status >= 200 && response.status < 300) {
    observation.responseBytes = Buffer.byteLength(response.body, "utf8");
  }
  if (result.kind === "NOT_MODIFIED") {
    observation.reason = "HTTP_ERROR";
    observation.detail = "Unexpected 304 without a conditional request.";
    return observation;
  }

  let payload: unknown = null;
  if (response && observation.responseBytes !== null) {
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = null;
    }
  }
  if (payload !== null) {
    const signals = postingSignals(candidate.provider, payload);
    observation.openJobs = rawPostingCount(candidate.provider, payload);
    if (signals.length > 0) {
      const regions = signals.map(classifyPosting);
      observation.usJobs = regions.filter((region) => region === "US").length;
      observation.nonUsJobs = regions.filter((region) => region === "NON_US").length;
      observation.unknownLocationJobs = regions.filter((region) => region === "UNKNOWN").length;
      observation.usShare = Number((observation.usJobs / signals.length).toFixed(4));
    }
  }

  if (result.kind === "FAILED") {
    observation.reason = failureReason(result);
    observation.detail = result.message.slice(0, 200);
    return observation;
  }

  const snapshot = result.snapshot;
  observation.listedJobs = snapshot.jobs.filter((job) => job.listed).length;
  observation.sampleTitles = [...new Set(snapshot.jobs.map((job) => job.title))].slice(0, 3);
  observation.employerMentionShare = employerMentionShare(candidate.employerName, snapshot.jobs.map((job) => job.descriptionText));
  try {
    serializeSourceSnapshot({
      sourceId: source.sourceId,
      ingestionRunId: "verification",
      provider: source.provider,
      tenantKey: source.tenantKey,
      adapterRelease: `${source.provider.toLowerCase()}/verification`,
      etag: result.etag,
      sourceOptions: {},
    }, result);
    observation.snapshotAccepted = true;
  } catch (error) {
    observation.snapshotAccepted = false;
    const firstIssue = snapshot.issues[0];
    observation.snapshotIssue = [
      error instanceof Error ? error.message : "SNAPSHOT_REJECTED",
      snapshot.issues.length > 0 ? `${snapshot.issues.length} issue(s); first: ${firstIssue?.code} ${firstIssue?.message}` : null,
    ].filter(Boolean).join(" — ").slice(0, 300);
  }

  const openJobs = observation.openJobs ?? snapshot.jobs.length;
  observation.openJobs = openJobs;
  if (openJobs < MIN_JOBS) observation.reason = "TOO_FEW_JOBS";
  else if (openJobs > MAX_JOBS) observation.reason = "TOO_MANY_JOBS";
  else if ((observation.responseBytes ?? 0) > MAX_BYTES) observation.reason = "RESPONSE_TOO_LARGE";
  else if (!observation.snapshotAccepted) observation.reason = "SNAPSHOT_REJECTED";
  else if ((observation.usShare ?? 0) < MIN_US_SHARE) observation.reason = "LOW_US_SHARE";
  if (observation.reason) return observation;

  observation.outcome = "PASS";
  const label = await fetchBoardLabel(candidate);
  observation.boardLabel = label.label;
  observation.boardLabelSource = label.source;
  observation.boardLabelUrl = label.url;
  observation.boardLabelStatus = label.status;
  observation.boardWebsite = label.website;
  return observation;
}

function finalize(candidate: Candidate, observation: Observation): CandidateResult {
  const source = registeredSource(candidate);
  const { apiUrl, publicBoardUrl } = registryUrls(source);
  const cleanedLabel = cleanBoardLabel(observation.boardLabel);
  const identity = observation.outcome !== "PASS" ? null
    : cleanedLabel && labelMatchesEmployer(cleanedLabel, candidate.employerName) ? "LABEL_MATCH"
      : (observation.employerMentionShare ?? 0) >= MIN_EMPLOYER_MENTION_SHARE ? "CONTENT_MATCH"
        : cleanedLabel ? "LABEL_MISMATCH" : "LABEL_UNAVAILABLE";
  let registryEntry: ReviewedJobSource | null = null;
  if (observation.outcome === "PASS" && observation.verifiedAt && observation.openJobs && observation.responseBytes) {
    const metadataUrl = `https://boards-api.greenhouse.io/v1/boards/${candidate.token}`;
    const evidenceUrls = candidate.provider === "GREENHOUSE" && observation.boardLabelSource === "GREENHOUSE_BOARD_METADATA"
      ? [metadataUrl, apiUrl]
      : [publicBoardUrl, apiUrl];
    const entry: ReviewedJobSource = {
      // Board ownership labels come from provider metadata when they corroborate the reviewed employer.
      employerName: identity === "LABEL_MATCH" && cleanedLabel ? cleanedLabel : candidate.employerName,
      provider: candidate.provider,
      tenantKey: candidate.token,
      publicBoardUrl,
      apiUrl,
      category: candidate.category ?? candidate.industry,
      verifiedAt: observation.verifiedAt,
      observedJobs: observation.openJobs,
      observedBytes: observation.responseBytes,
      evidenceUrls,
    };
    try {
      parseReviewedJobSourceRegistry({ schemaVersion: 1, release: `job-source-registry/${entry.verifiedAt.slice(0, 10)}`, sources: [entry] });
      registryEntry = entry;
    } catch {
      registryEntry = null;
    }
  }
  return { ...candidate, apiUrl, publicBoardUrl, ...observation, identity, registryEntry };
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildReport(candidatesFile: string, startedAt: string, results: readonly CandidateResult[], complete: boolean) {
  const passed = results.filter((result) => result.outcome === "PASS");
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    complete,
    candidatesFile,
    method: {
      userAgent: USER_AGENT,
      maxInFlight: MAX_IN_FLIGHT,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      retries: "one retry after 2 s for timeouts, network errors, HTTP 408/429/5xx",
      requests: "unauthenticated public GETs to boards-api.greenhouse.io, api.lever.co, api.ashbyhq.com; board labels from boards-api.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com for passing boards only",
      passCriteria: {
        httpStatus: 200,
        minJobs: MIN_JOBS,
        maxJobs: MAX_JOBS,
        maxResponseBytes: MAX_BYTES,
        minUsShare: MIN_US_SHARE,
        productionSnapshotAccepted: true,
      },
      analysisVersion: ANALYSIS_VERSION,
      usShare: "Share of postings with any US location signal: US country value or text, a US state name, a ', ST' state code, or a major US city. Plain 'Remote' is not a US signal.",
      identity: "LABEL_MATCH: the provider board label (Greenhouse board metadata, Lever hosted board title, Ashby hosted organization) names the candidate employer. CONTENT_MATCH: no corroborating label, but at least half of posting descriptions name the employer (case-sensitive, whole words, names of four or more characters). LABEL_MISMATCH and LABEL_UNAVAILABLE require manual review before a board enters a registry.",
    },
    summary: {
      probed: results.length,
      passed: passed.length,
      failed: results.length - passed.length,
      failuresByReason: tally(results.filter((result) => result.reason).map((result) => result.reason as string)),
      passedByProvider: tally(passed.map((result) => result.provider)),
      passedByIndustry: tally(passed.map((result) => result.industry)),
      passedIdentity: tally(passed.map((result) => result.identity ?? "UNKNOWN")),
      passedObservedJobs: passed.reduce((sum, result) => sum + (result.openJobs ?? 0), 0),
    },
    results,
  };
}

async function readPriorObservations(path: string): Promise<Map<string, Observation>> {
  const prior = new Map<string, Observation>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return prior;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) return prior;
  for (const raw of parsed.results) {
    if (!isRecord(raw) || !PROVIDERS.includes(raw.provider as JobSourceProvider) || typeof raw.token !== "string") continue;
    const reason = raw.reason as FailureReason | null;
    if (reason && TRANSIENT_REASONS.has(reason)) continue;
    const analysisVersion = typeof raw.analysisVersion === "number" ? raw.analysisVersion : 1;
    const answered = typeof raw.httpStatus === "number" && raw.httpStatus >= 200 && raw.httpStatus < 300;
    if (answered && analysisVersion !== ANALYSIS_VERSION) continue;
    const observation = emptyObservation();
    for (const key of Object.keys(observation) as (keyof Observation)[]) {
      if (key in raw) (observation as Record<string, unknown>)[key] = raw[key];
    }
    observation.analysisVersion = analysisVersion;
    prior.set(candidateKey({ provider: raw.provider as JobSourceProvider, token: raw.token }), observation);
  }
  return prior;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const [candidatesPath, outPath] = args.filter((arg) => !arg.startsWith("--"));
  if (!candidatesPath || !outPath) {
    process.stderr.write("Usage: node --experimental-strip-types scripts/verify-job-boards.ts <candidates.json> <out.json> [--resume]\n");
    process.exitCode = 2;
    return;
  }
  const candidates = parseCandidates(JSON.parse(await readFile(resolve(candidatesPath), "utf8")));
  const prior = resume ? await readPriorObservations(resolve(outPath)) : new Map<string, Observation>();
  const port = createNativeJobApiFetchPort({ timeoutMilliseconds: REQUEST_TIMEOUT_MS, userAgent: USER_AGENT });
  const startedAt = new Date().toISOString();
  const observations = new Array<Observation | undefined>(candidates.length);
  let reused = 0;
  candidates.forEach((candidate, index) => {
    const observation = prior.get(candidateKey(candidate));
    if (observation) {
      observations[index] = observation;
      reused += 1;
    }
  });
  const pending = candidates.map((_, index) => index).filter((index) => !observations[index]);
  process.stderr.write(`Probing ${pending.length} candidate board(s); reusing ${reused} prior observation(s).\n`);

  const snapshot = (complete: boolean) => buildReport(
    candidatesPath,
    startedAt,
    candidates.flatMap((candidate, index) => {
      const observation = observations[index];
      return observation ? [finalize(candidate, observation)] : [];
    }),
    complete,
  );
  let finished = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const index = pending[next++];
      const candidate = candidates[index];
      const observation = await observe(candidate, port);
      observations[index] = observation;
      finished += 1;
      const share = observation.usShare === null ? "" : ` us=${Math.round(observation.usShare * 100)}%`;
      const jobs = observation.openJobs === null ? "" : ` jobs=${observation.openJobs}`;
      process.stderr.write(`[${finished}/${pending.length}] ${observation.outcome} ${candidate.provider} ${candidate.token}${jobs}${share}${observation.reason ? ` ${observation.reason}` : ""}\n`);
      if (finished % CHECKPOINT_EVERY === 0) await writeFile(resolve(outPath), `${JSON.stringify(snapshot(false), null, 2)}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, pending.length) }, worker));

  const report = snapshot(true);
  await writeFile(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

await main();
