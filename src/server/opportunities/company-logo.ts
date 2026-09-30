import { isCompanyLogoBoardSlug, isCompanyLogoProvider, type CompanyLogoProvider } from "../../domain/company-logo.ts";

const BOARD_BYTE_LIMIT = 1_000_000;
// Employer-uploaded PNGs can exceed 256 KB (Coder's observed square logo is 495 KB).
const IMAGE_BYTE_LIMIT = 1_000_000;
const LOGO_CACHE_SECONDS = 86_400;
// Thumbnails are at most 96 px; a stored SVG passes through untouched, so cap it where a database row stays small.
export const STORED_LOGO_BYTE_LIMIT = 262_144;
const IMAGE_PIXEL_LIMIT = 80_000_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const ASHBY_LOGO_PATH = new RegExp(`^/api/images/org-theme-logo/(${UUID})/${UUID}/${UUID}\\.(?:png|jpe?g|webp|svg)$`, "iu");
const LEVER_LOGO_PATH = new RegExp(`^/${UUID}-[0-9]{10,16}\\.(?:png|jpe?g|webp|svg)$`, "iu");
const GREENHOUSE_LOGO_PATH = /^\/external_greenhouse_job_boards\/logos\/[0-9]{3}\/[0-9]{3}\/[0-9]{3}\/original\/[A-Za-z0-9_-][A-Za-z0-9_.%-]{0,199}\.(?:png|jpe?g|webp|svg)$/iu;
const BOARD_ORIGINS: Readonly<Record<CompanyLogoProvider, string>> = {
  ashby: "https://jobs.ashbyhq.com",
  greenhouse: "https://job-boards.greenhouse.io",
  // Unverified (2026-09-30, the review network could not reach any ATS host): the EU boards are read with the
  // same parsers and exact-origin checks as the US boards. Markup or asset hosts that differ fail closed to initials.
  "greenhouse-eu": "https://job-boards.eu.greenhouse.io",
  lever: "https://jobs.lever.co",
  "lever-eu": "https://jobs.eu.lever.co",
};

export type CompanyLogoAsset = Readonly<{ bytes: Uint8Array; contentType: string }>;

/**
 * What one live read of a board decided. `none` is a stable answer (no logo, not found, not usable) and is
 * remembered for hours. `error` is a transient problem (timeout, throttling, upstream 5xx) and is never remembered,
 * so it can never replace a logo that was already found. Reasons are static codes, never URLs or response text.
 */
export type CompanyLogoFetchResult =
  | Readonly<{ kind: "found"; asset: CompanyLogoAsset }>
  | Readonly<{ kind: "none"; reason: string }>
  | Readonly<{ kind: "error"; reason: string }>;

/** What the route serves: a logo, a stable "no logo", or "could not tell right now". */
export type CompanyLogoResolution =
  | Readonly<{ kind: "asset"; asset: CompanyLogoAsset }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "invalid" }>;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rasterMatchesType(bytes: Uint8Array, contentType: string): boolean {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  if (contentType === "image/png") return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg") return header[0] === 255 && header[1] === 216 && header[2] === 255;
  return contentType === "image/webp" && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
}

/** Observed public board bootstrap, 2026-09-30. A changed format falls back to initials. */
export function ashbySquareLogoUrl(html: string, board: string): string | null {
  const raw = /<script\b[^>]*>\s*window\.__appData\s*=\s*(\{[^\r\n]*\});[ \t]*(?:\r?\n)/u.exec(html)?.[1];
  if (!raw) return null;
  try {
    const organization = object(object(JSON.parse(raw))?.organization);
    const theme = object(organization?.theme);
    if (typeof organization?.hostedJobsPageSlug !== "string" || organization.hostedJobsPageSlug.toLowerCase() !== board.toLowerCase()
      || typeof organization.organizationId !== "string" || typeof theme?.logoSquareImageUrl !== "string") return null;
    const url = new URL(theme.logoSquareImageUrl);
    const path = ASHBY_LOGO_PATH.exec(url.pathname);
    if (url.origin !== "https://app.ashbyhq.com" || url.username || url.password || url.search || url.hash
      || !path || path[1].toLowerCase() !== organization.organizationId.toLowerCase()) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Greenhouse's employer logo is distinct from its optional board banner and platform branding. */
export function greenhouseLogoUrl(html: string, board: string): string | null {
  const raw = /<script\b[^>]*>\s*window\.__remixContext\s*=\s*(\{[^\r\n]*\});\s*<\/script>/u.exec(html)?.[1];
  if (!raw) return null;
  try {
    const state = object(object(JSON.parse(raw))?.state);
    const root = object(object(state?.loaderData)?.root);
    const logo = object(object(root?.boardConfiguration)?.logo);
    if (typeof root?.urlToken !== "string" || root.urlToken.toLowerCase() !== board.toLowerCase()
      || typeof logo?.url !== "string") return null;
    const url = new URL(logo.url);
    // Only the public employer-logo CDN/path observed on the hosted board, not arbitrary config URLs.
    if (!["https://s8-recruiting.cdn.greenhouse.io", "https://s5-recruiting.cdn.greenhouse.io"].includes(url.origin) || url.username || url.password || url.hash
      || (url.search && !/^\?[0-9]{10,16}$/u.test(url.search)) || !GREENHOUSE_LOGO_PATH.test(url.pathname)
      || /%2f|%5c|%2e/iu.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function quotedAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

/** Read only Lever's employer-header image; the footer always advertises Lever itself. */
export function leverLogoUrl(html: string, board: string, origin = "https://jobs.lever.co"): string | null {
  // Ignore text examples inside comments/scripts before looking at the observed hosted-board markup.
  const markup = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/giu, "");
  const identity = Array.from(markup.matchAll(/<meta\b[^>]*>/giu))
    .filter(([tag]) => quotedAttribute(tag, "property") === "og:url");
  if (identity.length !== 1 || quotedAttribute(identity[0][0], "content")?.toLowerCase() !== `${origin}/${board.toLowerCase()}`) return null;
  const headers = Array.from(markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu))
    .filter(([, attributes]) => quotedAttribute(attributes, "class")?.split(/\s+/u).includes("main-header-logo"));
  if (headers.length !== 1) return null;
  const images = Array.from(headers[0][2].matchAll(/<img\b[^>]*>/giu));
  if (images.length !== 1) return null;
  const source = quotedAttribute(images[0][0], "src");
  if (!source) return null;
  try {
    const url = new URL(source);
    if (!["https://lever-client-logos.s3.amazonaws.com", "https://lever-client-logos.s3.us-west-2.amazonaws.com"].includes(url.origin)
      || url.username || url.password || url.search || url.hash || !LEVER_LOGO_PATH.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Null when the body exceeds the limit or is missing. Read errors propagate: they are transient, not answers. */
async function readBounded(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) { await response.body.cancel(); return null; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const none = (reason: string): CompanyLogoFetchResult => ({ kind: "none", reason });
const failed = (reason: string): CompanyLogoFetchResult => ({ kind: "error", reason });

/** Redirects, missing pages and gone pages are stable answers; throttling and server errors are not. */
async function rejectedStatus(response: Response, stage: string): Promise<CompanyLogoFetchResult | null> {
  if (response.ok) return null;
  await response.body?.cancel().catch(() => undefined);
  const stable = response.status === 404 || response.status === 410 || (response.status >= 300 && response.status < 400);
  return stable ? none(`${stage}_HTTP_${response.status}`) : failed(`${stage}_HTTP_${response.status}`);
}

// sharp is loaded on first use: serving a stored logo never pays its WASM/native start-up, and a sharp that
// cannot load (a bundling or platform problem) cannot take stored logos down with it.
async function thumbnail(bytes: Uint8Array): Promise<CompanyLogoFetchResult> {
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return failed("THUMBNAIL_UNAVAILABLE");
  }
  try {
    // Employer-uploaded rasters can be enormous despite a small compressed body.
    // Decode once on the server; the stored asset stays at most 96 px per side.
    // Netlify Linux uses sharp's WASM fallback, so allow a bounded cold-start margin.
    const output = await sharp(bytes, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "warning", animated: false })
      .rotate().resize({ width: 96, height: 96, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).timeout({ seconds: 8 }).toBuffer();
    if (output.byteLength > STORED_LOGO_BYTE_LIMIT) return none("THUMBNAIL_TOO_LARGE");
    return { kind: "found", asset: { bytes: output, contentType: "image/webp" } };
  } catch (error) {
    // A cold WASM start or memory pressure is transient; an image sharp rejects (over the pixel limit,
    // corrupt, truncated) is a stable property of the employer's file.
    return /time.?out|timed out|memory|EAGAIN/iu.test(error instanceof Error ? error.message : "") ? failed("THUMBNAIL_TIMEOUT") : none("IMAGE_INVALID");
  }
}

/**
 * One live read of a board: page, then the exact logo it names, then a thumbnail. Public assets only:
 * no candidate data, cookies, authorization, followed redirects or arbitrary hosts. Never throws.
 */
export async function fetchCompanyLogo(provider: string, board: string, fetcher: typeof fetch = fetch): Promise<CompanyLogoFetchResult> {
  if (!isCompanyLogoProvider(provider) || !isCompanyLogoBoardSlug(board)) return none("BOARD_INVALID");
  // "manual" never follows a redirect; a 3xx comes back as a stable "not at this address" answer instead of
  // an exception that looks like a network failure.
  const request = (url: string, accept: string) => fetcher(url, {
    headers: { accept }, credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer",
    // Cache the bounded final route response, not fetch's unbounded clone of the upstream body.
    signal: AbortSignal.timeout(5_000), cache: "no-store",
  });
  let stage = "BOARD";
  try {
    let boardResponse: Response | null = null;
    let boardRejected: CompanyLogoFetchResult | null = null;
    try {
      boardResponse = await request(`${BOARD_ORIGINS[provider]}/${board}`, "text/html");
      boardRejected = await rejectedStatus(boardResponse, "BOARD");
    } catch (error) {
      if (provider !== "greenhouse") throw error;
      boardRejected = failed("BOARD_NETWORK");
    }
    // Some employers disable their board index while individual hosted job pages remain available.
    // Resolve one public posting ID from the same board; never follow an employer-provided URL.
    if (boardRejected && provider === "greenhouse") {
      const index = await request(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`, "application/json");
      const indexRejected = await rejectedStatus(index, "BOARD_INDEX");
      if (indexRejected) return boardRejected.kind === "error" ? boardRejected : indexRejected;
      const bytes = await readBounded(index, BOARD_BYTE_LIMIT);
      if (!bytes) return failed("BOARD_INDEX_TOO_LARGE");
      const jobs = object(JSON.parse(new TextDecoder().decode(bytes)))?.jobs;
      const id = Array.isArray(jobs) ? object(jobs[0])?.id : null;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return boardRejected;
      boardResponse = await request(`${BOARD_ORIGINS[provider]}/${board}/jobs/${id}`, "text/html");
      boardRejected = await rejectedStatus(boardResponse, "BOARD_POSTING");
    }
    if (boardRejected) return boardRejected;
    if (!boardResponse) return failed("BOARD_NETWORK");
    if (!boardResponse.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
      await boardResponse.body?.cancel(); return none("BOARD_NOT_HTML");
    }
    const html = await readBounded(boardResponse, BOARD_BYTE_LIMIT);
    if (!html) return none("BOARD_TOO_LARGE");
    const origin = BOARD_ORIGINS[provider];
    const logoUrl = provider === "ashby" ? ashbySquareLogoUrl(new TextDecoder().decode(html), board)
      : provider.startsWith("greenhouse") ? greenhouseLogoUrl(new TextDecoder().decode(html), board)
      : leverLogoUrl(new TextDecoder().decode(html), board, origin);
    if (!logoUrl) return none("LOGO_NOT_LISTED");
    stage = "LOGO";
    const logoResponse = await request(logoUrl, "image/png,image/jpeg,image/webp,image/svg+xml");
    const logoRejected = await rejectedStatus(logoResponse, "LOGO");
    if (logoRejected) return logoRejected;
    let contentType = logoResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!contentType || (!IMAGE_TYPES.has(contentType) && contentType !== "application/octet-stream")) {
      await logoResponse.body?.cancel(); return none("LOGO_TYPE_UNSUPPORTED");
    }
    const bytes = await readBounded(logoResponse, IMAGE_BYTE_LIMIT);
    if (!bytes?.byteLength) return none("LOGO_SIZE_INVALID");
    // Lever's employer S3 uploads may use octet-stream; accept only recognized raster signatures.
    if (contentType === "application/octet-stream") {
      contentType = ["image/png", "image/jpeg", "image/webp"].find((type) => rasterMatchesType(bytes, type));
      if (!contentType) return none("LOGO_TYPE_UNSUPPORTED");
    }
    if (contentType === "image/svg+xml") {
      return bytes.byteLength > STORED_LOGO_BYTE_LIMIT ? none("LOGO_TOO_LARGE_TO_STORE") : { kind: "found", asset: { bytes, contentType } };
    }
    if (!rasterMatchesType(bytes, contentType)) return none("LOGO_SIGNATURE_MISMATCH");
    stage = "THUMBNAIL";
    return await thumbnail(bytes);
  } catch (error) {
    return failed(`${stage}_${error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "TIMEOUT" : "NETWORK"}`);
  }
}

/** The logo alone, without any stored state. Kept for callers and tests that only need the asset. */
export async function loadCompanyLogo(provider: string, board: string, fetcher: typeof fetch = fetch): Promise<CompanyLogoAsset | null> {
  const result = await fetchCompanyLogo(provider, board, fetcher);
  return result.kind === "found" ? result.asset : null;
}

/** A stored or freshly read asset must still look like what the table promises before it is served. */
export function isServableLogoAsset(asset: CompanyLogoAsset): boolean {
  if (asset.bytes.byteLength === 0 || asset.bytes.byteLength > STORED_LOGO_BYTE_LIMIT) return false;
  if (asset.contentType === "image/webp") return rasterMatchesType(asset.bytes, "image/webp");
  return asset.contentType === "image/svg+xml";
}

const NO_STORE = { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" } as const;

export function companyLogoResponse(asset: CompanyLogoAsset | null): Response {
  if (!asset) return new Response(null, { status: 404, headers: NO_STORE });
  return new Response(new Uint8Array(asset.bytes), { headers: {
    "Content-Type": asset.contentType,
    "Cache-Control": `public, max-age=${LOGO_CACHE_SECONDS}, stale-while-revalidate=604800`,
    "Netlify-CDN-Cache-Control": `public, s-maxage=${LOGO_CACHE_SECONDS}, stale-while-revalidate=604800`,
    "X-Content-Type-Options": "nosniff",
    // SVGs render as images. Direct navigation downloads them, with no script or network authority.
    "Content-Disposition": "attachment",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "Referrer-Policy": "no-referrer",
  } });
}

/**
 * 200 with the image, 404 for a stable "no logo" (browsers may keep that for minutes; the CDN never does),
 * 503 for "could not tell right now" (never cached, so the next attempt asks again), 404 no-store for a bad address.
 */
export function companyLogoResolutionResponse(resolution: CompanyLogoResolution): Response {
  switch (resolution.kind) {
    case "asset": return companyLogoResponse(resolution.asset);
    case "none": return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=300", "Netlify-CDN-Cache-Control": "no-store" } });
    case "unavailable": return new Response(null, { status: 503, headers: { ...NO_STORE, "Retry-After": "5" } });
    case "invalid": return companyLogoResponse(null);
  }
}
