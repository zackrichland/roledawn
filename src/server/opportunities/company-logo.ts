import sharp from "sharp";

import { isCompanyLogoBoardSlug, isCompanyLogoProvider, type CompanyLogoProvider } from "../../domain/company-logo.ts";

const BOARD_BYTE_LIMIT = 1_000_000;
// Employer-uploaded PNGs can exceed 256 KB (Coder's observed square logo is 495 KB).
const IMAGE_BYTE_LIMIT = 1_000_000;
const LOGO_CACHE_SECONDS = 86_400;
const IMAGE_PIXEL_LIMIT = 80_000_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const ASHBY_LOGO_PATH = new RegExp(`^/api/images/org-theme-logo/(${UUID})/${UUID}/${UUID}\\.(?:png|jpe?g|webp|svg)$`, "iu");
const LEVER_LOGO_PATH = new RegExp(`^/${UUID}-[0-9]{10,16}\\.(?:png|jpe?g|webp|svg)$`, "iu");
const GREENHOUSE_LOGO_PATH = /^\/external_greenhouse_job_boards\/logos\/[0-9]{3}\/[0-9]{3}\/[0-9]{3}\/original\/[A-Za-z0-9_-][A-Za-z0-9_.%-]{0,199}\.(?:png|jpe?g|webp|svg)$/iu;
const BOARD_ORIGINS: Readonly<Record<CompanyLogoProvider, string>> = {
  ashby: "https://jobs.ashbyhq.com", greenhouse: "https://job-boards.greenhouse.io", lever: "https://jobs.lever.co",
};

export type CompanyLogoAsset = Readonly<{ bytes: Uint8Array; contentType: string }>;

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
    if (url.origin !== "https://s8-recruiting.cdn.greenhouse.io" || url.username || url.password || url.hash
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
export function leverLogoUrl(html: string, board: string): string | null {
  // Ignore text examples inside comments/scripts before looking at the observed hosted-board markup.
  const markup = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/giu, "");
  const identity = Array.from(markup.matchAll(/<meta\b[^>]*>/giu))
    .filter(([tag]) => quotedAttribute(tag, "property") === "og:url");
  if (identity.length !== 1 || quotedAttribute(identity[0][0], "content")?.toLowerCase() !== `https://jobs.lever.co/${board.toLowerCase()}`) return null;
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

/** Public assets only: no candidate data, cookies, authorization, redirects or arbitrary hosts. */
export async function loadCompanyLogo(provider: string, board: string, fetcher: typeof fetch = fetch): Promise<CompanyLogoAsset | null> {
  if (!isCompanyLogoProvider(provider) || !isCompanyLogoBoardSlug(board)) return null;
  const request = (url: string, accept: string) => fetcher(url, {
    headers: { accept }, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    // Cache the bounded final route response, not fetch's unbounded clone of the upstream body.
    signal: AbortSignal.timeout(5_000), cache: "no-store",
  });
  try {
    const boardResponse = await request(`${BOARD_ORIGINS[provider]}/${board}`, "text/html");
    if (!boardResponse.ok || !boardResponse.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
      await boardResponse.body?.cancel(); return null;
    }
    const html = await readBounded(boardResponse, BOARD_BYTE_LIMIT);
    if (!html) return null;
    const parseLogo = provider === "ashby" ? ashbySquareLogoUrl : provider === "greenhouse" ? greenhouseLogoUrl : leverLogoUrl;
    const logoUrl = parseLogo(new TextDecoder().decode(html), board);
    if (!logoUrl) return null;
    const logoResponse = await request(logoUrl, "image/png,image/jpeg,image/webp,image/svg+xml");
    let contentType = logoResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!logoResponse.ok || !contentType || (!IMAGE_TYPES.has(contentType) && contentType !== "application/octet-stream")) {
      await logoResponse.body?.cancel(); return null;
    }
    const bytes = await readBounded(logoResponse, IMAGE_BYTE_LIMIT);
    if (!bytes?.byteLength) return null;
    // Lever's employer S3 uploads may use octet-stream; accept only recognized raster signatures.
    if (contentType === "application/octet-stream") {
      contentType = ["image/png", "image/jpeg", "image/webp"].find((type) => rasterMatchesType(bytes, type));
      if (!contentType) return null;
    }
    if (contentType === "image/svg+xml") return { bytes, contentType };
    if (!rasterMatchesType(bytes, contentType)) return null;
    // Employer-uploaded rasters can be enormous despite a small compressed body.
    // Decode once on the server; the cached browser asset stays at most 96 px per side.
    // Local Netlify deploys include sharp's WASM fallback on Linux; allow a bounded cold-start margin.
    const thumbnail = await sharp(bytes, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "warning", animated: false })
      .rotate().resize({ width: 96, height: 96, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).timeout({ seconds: 8 }).toBuffer();
    return { bytes: thumbnail, contentType: "image/webp" };
  } catch {
    return null;
  }
}

export function companyLogoResponse(asset: CompanyLogoAsset | null): Response {
  if (!asset) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" } });
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
