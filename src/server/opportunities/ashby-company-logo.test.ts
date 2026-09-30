import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createDeflate, crc32 } from "node:zlib";
import sharp from "sharp";

import { companyLogoSource } from "../../domain/company-logo.ts";
import { ashbySquareLogoUrl, companyLogoResponse, loadAshbyCompanyLogo } from "./ashby-company-logo.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const imageUrl = `https://app.ashbyhq.com/api/images/org-theme-logo/${organizationId}/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png`;
function boardHtml(logo = imageUrl, slug = "Example", id = organizationId): string {
  return `<script nonce="public-board">\nwindow.__appData = ${JSON.stringify({ organization: { organizationId: id, hostedJobsPageSlug: slug, theme: { logoSquareImageUrl: logo } } })};\n</script>`;
}

test("logos use the stored Ashby board identity, without guessed company domains or tracking query strings", () => {
  assert.equal(companyLogoSource("https://jobs.ashbyhq.com/Example/abc?utm_source=anything"), "/api/company-logos/ashby/example.png?v=thumbnail-1");
  for (const url of [null, "https://jobs.ashbyhq.com.evil.test/Example/abc", "http://jobs.ashbyhq.com/Example/abc", "https://user:pass@jobs.ashbyhq.com/Example/abc", "https://jobs.ashbyhq.com/%2Fprivate/abc", "https://jobs.lever.co/example/abc"]) {
    assert.equal(companyLogoSource(url), null);
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
  const asset = await loadAshbyCompanyLogo("example", fetcher);
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
  assert.equal(await loadAshbyCompanyLogo("../private", (async () => { calls++; throw new Error(); }) as typeof fetch), null);
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
    assert.equal(await loadAshbyCompanyLogo("example", fetcher), null);
  }
  assert.equal(await loadAshbyCompanyLogo("example", (async () => new Response("x".repeat(1_000_001), { headers: { "content-type": "text/html" } })) as typeof fetch), null);
  assert.equal(await loadAshbyCompanyLogo("example", (async () => { throw new Error("unavailable"); }) as typeof fetch), null);
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
  const asset = await loadAshbyCompanyLogo("example", fetcher);
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
  assert.equal(await loadAshbyCompanyLogo("example", fetcher), null);
});
