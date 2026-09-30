import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createDeflate, crc32 } from "node:zlib";
import sharp from "sharp";

import { companyLogoSource } from "../../domain/company-logo.ts";
import {
  ashbySquareLogoUrl, greenhouseLogoUrl, leverLogoUrl, companyLogoResolutionResponse, companyLogoResponse, fetchCompanyLogo, loadCompanyLogo,
} from "./company-logo.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const imageUrl = `https://app.ashbyhq.com/api/images/org-theme-logo/${organizationId}/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png`;
function boardHtml(logo = imageUrl, slug = "Example", id = organizationId): string {
  return `<script nonce="public-board">\nwindow.__appData = ${JSON.stringify({ organization: { organizationId: id, hostedJobsPageSlug: slug, theme: { logoSquareImageUrl: logo } } })};\n</script>`;
}
const greenhouseImageUrl = "https://s8-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/040/300/original/employer-logo.png?1744052732";
const leverImageUrl = `https://lever-client-logos.s3.amazonaws.com/${organizationId}-1548201154787.png`;
function greenhouseBoardHtml(logo: string | null = greenhouseImageUrl, slug = "example"): string {
  return `<script>window.__remixContext = ${JSON.stringify({ state: { loaderData: { root: {
    urlToken: slug, boardConfiguration: { logo: { href: "https://example.test/jobs", url: logo },
      banner: { url: "https://recruiting.cdn.greenhouse.io/job_board_renderer/job_board_configurations/banners/000/000/729/original/Header.png?1742397631" } },
  } } } })};</script>`;
}
function leverBoardHtml(logo = leverImageUrl, slug = "example"): string {
  return `<head><meta property="og:url" content="https://jobs.lever.co/${slug}" />
    <meta property="og:image" content="https://example.test/social-preview.png" /></head>
    <header><a href="https://example.test/jobs" class="main-header-logo"><img alt="Example logo" src="${logo}"></a></header>
    <footer><img alt="Lever logo" src="/img/lever-logo-refresh.svg" class="footer-logo"></footer>`;
}

test("logos use stored ATS board identities, without guessed company domains or tracking query strings", () => {
  assert.equal(companyLogoSource("https://jobs.ashbyhq.com/Example/abc?utm_source=anything"), "/api/company-logos/ashby/example.png?v=thumbnail-1");
  assert.equal(companyLogoSource("https://jobs.lever.co/Example/abc/apply?source=value"), "/api/company-logos/lever/example.png?v=thumbnail-1");
  for (const host of ["job-boards.greenhouse.io", "boards.greenhouse.io"]) {
    assert.equal(companyLogoSource(`https://${host}/Example/jobs/123?gh_src=value`), "/api/company-logos/greenhouse/example.png?v=thumbnail-1");
  }
  for (const url of [null, "https://jobs.ashbyhq.com.evil.test/Example/abc", "http://jobs.ashbyhq.com/Example/abc", "https://user:pass@jobs.ashbyhq.com/Example/abc", "https://jobs.ashbyhq.com/%2Fprivate/abc", "https://jobs.lever.co.evil.test/example/abc", "https://job-boards.greenhouse.io.evil.test/example/jobs/123", "https://company.test/jobs/123", "https://job-boards.greenhouse.io/embed/job_app?for=example&token=123"]) {
    assert.equal(companyLogoSource(url), null);
  }
});

test("Greenhouse uses the matching board's explicit employer logo, never a banner or guessed favicon", () => {
  assert.equal(greenhouseLogoUrl(greenhouseBoardHtml(), "example"), greenhouseImageUrl);
  assert.equal(greenhouseLogoUrl(greenhouseBoardHtml(null), "example"), null);
  assert.equal(greenhouseLogoUrl(greenhouseBoardHtml(), "another-employer"), null);
  assert.equal(greenhouseLogoUrl('<script>window.__remixContext = runCode();</script>', "example"), null);
  for (const url of [
    greenhouseImageUrl.replace("s8-recruiting.cdn.greenhouse.io", "s8-recruiting.cdn.greenhouse.io.evil.test"),
    greenhouseImageUrl.replace("https:", "http:"), greenhouseImageUrl.replace("logos", "banners"),
    greenhouseImageUrl.replace("original/employer-logo", "original/%2e%2e/employer-logo"),
    greenhouseImageUrl + "&token=private", greenhouseImageUrl + "#fragment",
    "https://evil.test/logo.png", "https://s8-recruiting.cdn.greenhouse.io/favicon.ico",
  ]) assert.equal(greenhouseLogoUrl(greenhouseBoardHtml(url), "example"), null);
});

test("Lever selects only the employer-header image on the matching board and excludes platform footer branding", () => {
  assert.equal(leverLogoUrl(leverBoardHtml(), "example"), leverImageUrl);
  const regionalImage = leverImageUrl.replace("s3.amazonaws.com", "s3.us-west-2.amazonaws.com");
  assert.equal(leverLogoUrl(leverBoardHtml(regionalImage), "example"), regionalImage);
  assert.equal(leverLogoUrl(leverBoardHtml(), "another-employer"), null);
  assert.equal(leverLogoUrl(leverBoardHtml().replace(/<header>[\s\S]*?<\/header>/u, ""), "example"), null);
  assert.equal(leverLogoUrl(leverBoardHtml().replace('class="main-header-logo"', 'class="not-main-header-logo"'), "example"), null);
  assert.equal(leverLogoUrl(leverBoardHtml().replace("https://jobs.lever.co/example", "https://jobs.lever.co.evil.test/example"), "example"), null);
  for (const url of [
    "/img/lever-logo-refresh.svg", leverImageUrl.replace("logos", "uploads"),
    leverImageUrl.replace("s3.amazonaws.com", "s3.amazonaws.com.evil.test"),
    leverImageUrl.replace("https:", "http:"), leverImageUrl + "?token=value", leverImageUrl + "#fragment",
    leverImageUrl.replace(`${organizationId}-`, `private/${organizationId}-`),
  ]) assert.equal(leverLogoUrl(leverBoardHtml(url), "example"), null);
});

test("all providers fetch only their exact board and approved public asset, with no forwarded private context", async () => {
  for (const [provider, origin, html, expectedImage] of [
    ["ashby", "https://jobs.ashbyhq.com", boardHtml(), imageUrl],
    ["greenhouse", "https://job-boards.greenhouse.io", greenhouseBoardHtml(), greenhouseImageUrl],
    ["lever", "https://jobs.lever.co", leverBoardHtml(), leverImageUrl],
  ]) {
    const requested: string[] = [];
    const asset = await loadCompanyLogo(provider, "example", (async (url, options) => {
      requested.push(String(url));
      assert.equal(options?.redirect, "manual");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.referrerPolicy, "no-referrer");
      assert.equal(options?.cache, "no-store");
      assert.deepEqual(Object.keys(options?.headers ?? {}), ["accept"]);
      return requested.length === 1 ? new Response(html, { headers: { "content-type": "text/html" } })
        : new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { "content-type": "image/svg+xml" } });
    }) as typeof fetch);
    assert.ok(asset, provider);
    assert.deepEqual(requested, [`${origin}/example`, expectedImage]);
  }
});

test("missing Greenhouse logos stop after the board read; invalid providers never fetch", async () => {
  const requested: string[] = [];
  const fetcher = (async (url) => {
    requested.push(String(url));
    return new Response(greenhouseBoardHtml(null), { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  assert.equal(await loadCompanyLogo("greenhouse", "example", fetcher), null);
  assert.deepEqual(requested, ["https://job-boards.greenhouse.io/example"]);
  assert.equal(await loadCompanyLogo("evil.test", "example", fetcher), null);
  assert.equal(requested.length, 1);
});

test("Lever's octet-stream uploads require a raster signature and are normalized before serving", async () => {
  const png = await sharp({ create: { width: 240, height: 80, channels: 3, background: "#112233" } }).png().toBuffer();
  for (const [body, expected] of [[new Uint8Array(png), true], [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), false], [new TextEncoder().encode("<html>not an image</html>"), false]] as const) {
    const asset = await loadCompanyLogo("lever", "example", (async (url) => String(url).includes("jobs.lever.co")
      ? new Response(leverBoardHtml(), { headers: { "content-type": "text/html" } })
      : new Response(body, { headers: { "content-type": "application/octet-stream" } })) as typeof fetch);
    assert.equal(!!asset, expected);
    if (asset) {
      assert.equal(asset.contentType, "image/webp");
      const metadata = await sharp(asset.bytes).metadata();
      assert.deepEqual([metadata.width, metadata.height], [96, 32]);
    }
  }
});

test("logo metadata is bound to the requested board, organization and exact public image service", () => {
  assert.equal(ashbySquareLogoUrl(boardHtml(), "example"), imageUrl);
  assert.equal(ashbySquareLogoUrl(boardHtml(), "another-company"), null);
  assert.equal(ashbySquareLogoUrl(boardHtml(imageUrl, "example", "99999999-9999-4999-8999-999999999999"), "example"), null);
  for (const url of ["https://evil.test/logo.png", "http://app.ashbyhq.com/logo.png", imageUrl + "?token=value", imageUrl.replace("org-theme-logo", "private-uploads"), imageUrl.replace("app.ashbyhq.com", "app.ashbyhq.com.evil.test")]) {
    assert.equal(ashbySquareLogoUrl(boardHtml(url), "example"), null);
  }
  assert.equal(ashbySquareLogoUrl('<script>window.__appData = runCode();\n</script>', "example"), null);
});

test("the logo proxy forwards no private context and caches only the bounded final asset", async () => {
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  const fetcher = (async (input, options) => {
    requests.push({ url: String(input), options });
    return String(input).includes("jobs.ashbyhq.com")
      ? new Response(boardHtml(), { headers: { "content-type": "text/html; charset=utf-8" } })
      : new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { "content-type": "image/svg+xml" } });
  }) as typeof fetch;
  const asset = await loadCompanyLogo("ashby", "example", fetcher);
  assert.ok(asset);
  assert.deepEqual(requests.map((request) => request.url), ["https://jobs.ashbyhq.com/example", imageUrl]);
  for (const { options } of requests) {
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.referrerPolicy, "no-referrer");
    assert.equal(options?.cache, "no-store");
    assert.deepEqual(Object.keys(options?.headers ?? {}), ["accept"]);
  }
  const response = companyLogoResponse(asset);
  assert.equal(response.headers.get("content-type"), "image/svg+xml");
  assert.equal(response.headers.get("content-disposition"), "attachment");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'.*sandbox/u);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control") ?? "", /public, max-age=86400/u);
  assert.match(response.headers.get("netlify-cdn-cache-control") ?? "", /public, s-maxage=86400/u);
});

test("invalid boards, unexpected assets, oversized responses and network errors fall back to initials", async () => {
  let calls = 0;
  assert.equal(await loadCompanyLogo("ashby", "../private", (async () => { calls++; throw new Error(); }) as typeof fetch), null);
  assert.equal(calls, 0);
  const outcomes = [
    new Response("<html>unexpected</html>", { headers: { "content-type": "text/html" } }),
    new Response("x".repeat(1_000_001), { headers: { "content-type": "image/png" } }),
    new Response("short", { headers: { "content-type": "image/png", "content-length": "1100000" } }),
    new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { "content-type": "image/png" } }),
  ];
  for (const image of outcomes) {
    const fetcher = (async (url) => String(url).includes("jobs.ashbyhq.com")
      ? new Response(boardHtml(), { headers: { "content-type": "text/html" } }) : image) as typeof fetch;
    assert.equal(await loadCompanyLogo("ashby", "example", fetcher), null);
  }
  assert.equal(await loadCompanyLogo("ashby", "example", (async () => new Response("x".repeat(1_000_001), { headers: { "content-type": "text/html" } })) as typeof fetch), null);
  assert.equal(await loadCompanyLogo("ashby", "example", (async () => { throw new Error("unavailable"); }) as typeof fetch), null);
  assert.equal(companyLogoResponse(null).status, 404);
  assert.equal(companyLogoResponse(null).headers.get("cache-control"), "no-store");
  assert.equal(companyLogoResponse(null).headers.get("netlify-cdn-cache-control"), "no-store");
});

test("a large employer-uploaded raster becomes an aspect-preserving thumbnail", async () => {
  const bytes = await sharp({ create: { width: 1000, height: 200, channels: 3, background: "#112233" } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(bytes.byteLength > 256_000 && bytes.byteLength < 1_000_000);
  const fetcher = (async (url) => String(url).includes("jobs.ashbyhq.com")
    ? new Response(boardHtml(), { headers: { "content-type": "text/html" } })
    // WASM sharp can return a SharedArrayBuffer-backed Buffer; HTTP bodies use ordinary buffers.
    : new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } })) as typeof fetch;
  const asset = await loadCompanyLogo("ashby", "example", fetcher);
  assert.ok(asset);
  assert.equal(asset.contentType, "image/webp");
  assert.ok(asset.bytes.byteLength < 10_000);
  const metadata = await sharp(asset.bytes).metadata();
  assert.equal(metadata.width, 96);
  assert.equal(metadata.height, 19);
  assert.equal((await companyLogoResponse(asset).arrayBuffer()).byteLength, asset.bytes.byteLength);
});

test("compressed rasters above 80 megapixels are rejected before pixel decoding", async () => {
  // Build a valid 81 MP monochrome PNG as a stream, without allocating its decoded pixels.
  const deflater = createDeflate();
  const compressed = (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of deflater) chunks.push(chunk);
    return Buffer.concat(chunks);
  })();
  const scanline = Buffer.alloc(9001);
  for (let row = 0; row < 9000; row++) if (!deflater.write(scanline)) await once(deflater, "drain");
  deflater.end();
  function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const payload = Buffer.concat([Buffer.from(type), data]);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(payload));
    return Buffer.concat([length, payload, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(9000, 0); header.writeUInt32BE(9000, 4); header[8] = 8;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", await compressed), chunk("IEND", Buffer.alloc(0))]);
  assert.ok(png.length < 1_000_000);
  const metadata = await sharp(png, { limitInputPixels: 81_000_000 }).metadata();
  assert.equal(metadata.width! * metadata.height!, 81_000_000);
  const fetcher = (async (url) => String(url).includes("jobs.ashbyhq.com")
    ? new Response(boardHtml(), { headers: { "content-type": "text/html" } })
    : new Response(png, { headers: { "content-type": "image/png" } })) as typeof fetch;
  assert.equal(await loadCompanyLogo("ashby", "example", fetcher), null);
});

const boardHtmlResponse = () => new Response(boardHtml(), { headers: { "content-type": "text/html" } });
const pngBytes = new Uint8Array(await sharp({ create: { width: 200, height: 100, channels: 3, background: "#224466" } }).png().toBuffer());

test("a stable answer is 'none' and a transient failure is 'error', so only answers can be remembered", async () => {
  const board = (respond: (url: string) => Response | Promise<Response>) => fetchCompanyLogo("ashby", "example", (async (url) => respond(String(url))) as typeof fetch);
  const asImage = (init: ConstructorParameters<typeof Response>) => (url: string) => url.includes("jobs.ashbyhq.com") ? boardHtmlResponse() : new Response(...init);
  const cases: readonly (readonly [string, Parameters<typeof board>[0], "none" | "error", string])[] = [
    // The board itself.
    ["board 404", () => new Response("", { status: 404 }), "none", "BOARD_HTTP_404"],
    ["board 410", () => new Response("", { status: 410 }), "none", "BOARD_HTTP_410"],
    ["board moved", () => new Response("", { status: 301, headers: { location: "https://elsewhere.test/" } }), "none", "BOARD_HTTP_301"],
    ["board throttled", () => new Response("", { status: 429 }), "error", "BOARD_HTTP_429"],
    ["board upstream error", () => new Response("", { status: 503 }), "error", "BOARD_HTTP_503"],
    ["board forbidden", () => new Response("", { status: 403 }), "error", "BOARD_HTTP_403"],
    ["board is not html", () => new Response("{}", { headers: { "content-type": "application/json" } }), "none", "BOARD_NOT_HTML"],
    ["board too large", () => new Response("x".repeat(1_000_001), { headers: { "content-type": "text/html" } }), "none", "BOARD_TOO_LARGE"],
    ["board lists no logo", () => new Response("<html></html>", { headers: { "content-type": "text/html" } }), "none", "LOGO_NOT_LISTED"],
    ["board unreachable", () => { throw new TypeError("fetch failed"); }, "error", "BOARD_NETWORK"],
    ["board timeout", () => { throw new DOMException("timed out", "TimeoutError"); }, "error", "BOARD_TIMEOUT"],
    // The logo it names.
    ["logo 404", asImage(["", { status: 404 }]), "none", "LOGO_HTTP_404"],
    ["logo throttled", asImage(["", { status: 429 }]), "error", "LOGO_HTTP_429"],
    ["logo upstream error", asImage(["", { status: 502 }]), "error", "LOGO_HTTP_502"],
    ["logo is html", asImage(["<html/>", { headers: { "content-type": "text/html" } }]), "none", "LOGO_TYPE_UNSUPPORTED"],
    ["logo is not the type it claims", asImage(["<svg/>", { headers: { "content-type": "image/png" } }]), "none", "LOGO_SIGNATURE_MISMATCH"],
    ["logo is corrupt", asImage([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), { headers: { "content-type": "image/png" } }]), "none", "IMAGE_INVALID"],
    ["oversized svg", asImage([`<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(262_200)}</svg>`, { headers: { "content-type": "image/svg+xml" } }]), "none", "LOGO_TOO_LARGE_TO_STORE"],
    ["logo network failure", (url) => { if (url.includes("jobs.ashbyhq.com")) return boardHtmlResponse(); throw new TypeError("fetch failed"); }, "error", "LOGO_NETWORK"],
  ];
  for (const [label, respond, kind, reason] of cases) {
    const result = await board(respond);
    assert.deepEqual([result.kind, "reason" in result ? result.reason : null], [kind, reason], label);
  }
  // The old contract (asset or null) could not tell "no logo" from "try again": both were null, both a no-store 404.
  assert.equal(await loadCompanyLogo("ashby", "example", (async () => new Response("", { status: 404 })) as typeof fetch), null);
  assert.equal(await loadCompanyLogo("ashby", "example", (async () => new Response("", { status: 503 })) as typeof fetch), null);
  const found = await board((url) => url.includes("jobs.ashbyhq.com") ? boardHtmlResponse() : new Response(pngBytes, { headers: { "content-type": "image/png" } }));
  assert.equal(found.kind, "found");
  assert.equal(await loadCompanyLogo("ashby", "../private"), null);
  assert.equal((await fetchCompanyLogo("ashby", "../private")).kind, "none");
});

test("a redirect is never followed and is a stable answer, not a network error", async () => {
  const requested: string[] = [];
  const result = await fetchCompanyLogo("lever", "example", (async (url, options) => {
    requested.push(String(url));
    assert.equal(options?.redirect, "manual");
    return new Response("", { status: 302, headers: { location: "https://evil.test/logo.png" } });
  }) as typeof fetch);
  assert.deepEqual(result, { kind: "none", reason: "BOARD_HTTP_302" });
  assert.deepEqual(requested, ["https://jobs.lever.co/example"]);
});

test("EU boards are read from their own EU host with the same exact-origin rules, and their slugs stay separate", async () => {
  for (const [provider, origin, html, image] of [
    ["greenhouse-eu", "https://job-boards.eu.greenhouse.io", greenhouseBoardHtml(), greenhouseImageUrl],
    ["lever-eu", "https://jobs.eu.lever.co", leverBoardHtml().replace("https://jobs.lever.co/", "https://jobs.eu.lever.co/"), leverImageUrl],
  ] as const) {
    const requested: string[] = [];
    const result = await fetchCompanyLogo(provider, "example", (async (url) => {
      requested.push(String(url));
      return requested.length === 1 ? new Response(html, { headers: { "content-type": "text/html" } })
        : new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { "content-type": "image/svg+xml" } });
    }) as typeof fetch);
    assert.equal(result.kind, "found", provider);
    assert.deepEqual(requested, [`${origin}/example`, image], provider);
  }
  // A US Lever page is not accepted as an EU board's identity (og:url must name the EU host).
  assert.equal(leverLogoUrl(leverBoardHtml(), "example", "https://jobs.eu.lever.co"), null);
});

test("a board with a dotted slug is fetched by that exact slug", async () => {
  const requested: string[] = [];
  await fetchCompanyLogo("greenhouse", "acme.co", (async (url) => { requested.push(String(url)); return new Response("", { status: 404 }); }) as typeof fetch);
  assert.deepEqual(requested, ["https://job-boards.greenhouse.io/acme.co"]);
  assert.equal((await fetchCompanyLogo("greenhouse", "a..b")).kind, "none");
});

test("responses: found logos are cached hard, 'none' briefly in browsers only, 'unavailable' never", () => {
  const none = companyLogoResolutionResponse({ kind: "none" });
  assert.equal(none.status, 404);
  assert.equal(none.headers.get("cache-control"), "public, max-age=300");
  assert.equal(none.headers.get("netlify-cdn-cache-control"), "no-store");
  const unavailable = companyLogoResolutionResponse({ kind: "unavailable" });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.equal(unavailable.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal(unavailable.headers.get("retry-after"), "5");
  const invalid = companyLogoResolutionResponse({ kind: "invalid" });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const asset = companyLogoResolutionResponse({ kind: "asset", asset: { bytes: pngBytes, contentType: "image/webp" } });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control") ?? "", /public, max-age=86400/u);
});
