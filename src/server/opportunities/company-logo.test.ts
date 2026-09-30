import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createDeflate, crc32 } from "node:zlib";
import sharp from "sharp";

import { companyLogoSource } from "../../domain/company-logo.ts";
import { ashbySquareLogoUrl, greenhouseLogoUrl, leverLogoUrl, companyLogoResponse, loadCompanyLogo } from "./company-logo.ts";

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
      assert.equal(options?.redirect, "error");
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
    assert.equal(options?.redirect, "error");
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
