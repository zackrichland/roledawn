import assert from "node:assert/strict";
import test from "node:test";

import { parseSupportedJobReference } from "../server/ingestion/job-reference.ts";
import {
  COMPANY_LOGO_RETRY_DELAYS_MS, INITIAL_COMPANY_LOGO_LOAD, companyLogoAttemptSource, companyLogoIdentity, companyLogoRetryDelay,
  companyLogoSource, isCompanyLogoBoardSlug, nextCompanyLogoLoad, type CompanyLogoLoad, type CompanyLogoLoadEvent,
} from "./company-logo.ts";

const uuid = "8a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const source = (provider: string, board: string) => `/api/company-logos/${provider}/${board}.png?v=thumbnail-1`;

test("every posting URL shape RoleDawn can ingest names its employer's board, before and after canonicalization", () => {
  const shapes: readonly (readonly [string, string])[] = [
    // Ashby: posting, application form, tracking and ashby_jid query strings, mixed-case slug, trailing slash.
    [`https://jobs.ashbyhq.com/Example/${uuid}`, source("ashby", "example")],
    [`https://jobs.ashbyhq.com/Example/${uuid}/application`, source("ashby", "example")],
    [`https://jobs.ashbyhq.com/Example/${uuid}/application?utm_source=x&ashby_jid=${uuid}`, source("ashby", "example")],
    [`https://jobs.ashbyhq.com/Example/${uuid}/`, source("ashby", "example")],
    // Lever: posting, apply form, EU host.
    [`https://jobs.lever.co/Example/${uuid}`, source("lever", "example")],
    [`https://jobs.lever.co/Example/${uuid}/apply?lever-source=x`, source("lever", "example")],
    [`https://jobs.eu.lever.co/Example/${uuid}/apply`, source("lever-eu", "example")],
    // Greenhouse: current and legacy hosts, EU twins, gh_jid and gh_src query strings.
    ["https://job-boards.greenhouse.io/Example/jobs/123456", source("greenhouse", "example")],
    ["https://boards.greenhouse.io/Example/jobs/123456?gh_src=abc", source("greenhouse", "example")],
    ["https://job-boards.eu.greenhouse.io/Example/jobs/123456", source("greenhouse-eu", "example")],
    ["https://boards.eu.greenhouse.io/Example/jobs/123456?gh_jid=123456", source("greenhouse-eu", "example")],
    // Tenant keys ingestion accepts (TENANT_KEY_PATTERN allows dots).
    [`https://jobs.ashbyhq.com/example.co/${uuid}`, source("ashby", "example.co")],
    ["https://job-boards.greenhouse.io/example_co-2/jobs/1", source("greenhouse", "example_co-2")],
  ];
  for (const [url, expected] of shapes) {
    assert.equal(companyLogoSource(url), expected, url);
    // Pasted links are stored in canonical form; the logo must survive that rewrite unchanged.
    const parsed = parseSupportedJobReference(url);
    assert.ok(parsed.ok, url);
    assert.equal(companyLogoSource(parsed.value.canonicalInputUrl), expected, `canonical ${parsed.value.canonicalInputUrl}`);
  }
});

test("an Ashby application's source URL keeps the same logo source through its whole life", () => {
  // Pasted link: the intake's canonical URL. Catalog job: the job version's apply URL. Detail page: apply URL first.
  const lifecycle = [
    `https://jobs.ashbyhq.com/Example/${uuid}/application?utm_campaign=x`,
    parseSupportedJobReference(`https://jobs.ashbyhq.com/Example/${uuid}/application`).ok
      ? `https://jobs.ashbyhq.com/Example/${uuid}` : "",
    `https://jobs.ashbyhq.com/Example/${uuid}/application`,
    `https://jobs.ashbyhq.com/example/${uuid}`,
  ];
  assert.equal(new Set(lifecycle.map(companyLogoSource)).size, 1);
  assert.equal(companyLogoSource(lifecycle[0]), source("ashby", "example"));
});

test("URLs without a verifiable hosted board yield no logo instead of a guess", () => {
  for (const url of [
    null, undefined, "", "not a url",
    // Employer-hosted Greenhouse pages (absolute_url on a custom domain) carry no verifiable board: use the hosted apply URL.
    "https://careers.example.com/jobs?gh_jid=123456", `https://jobs.example.com/${uuid}?ashby_jid=${uuid}`,
    "https://job-boards.greenhouse.io/embed/job_app?for=example&token=123", "https://boards.eu.greenhouse.io/embed/job_app?for=example",
    "https://jobs.ashbyhq.com/", "https://jobs.lever.co", "https://jobs.ashbyhq.com/a..b/x",
    "https://jobs.ashbyhq.com:8443/example/1", "http://jobs.ashbyhq.com/example/1", "https://user@jobs.ashbyhq.com/example/1",
    "https://jobs.ashbyhq.com.evil.test/example/1", "https://evil.test/jobs.ashbyhq.com/example/1",
    "https://www.workday.com/example/job/1", "https://jobs.smartrecruiters.com/Example/1-role", "https://example.bamboohr.com/careers/1",
  ]) assert.equal(companyLogoSource(url), null, String(url));
});

test("dot segments are resolved by URL parsing, so a board can never be a path escape", () => {
  assert.deepEqual(companyLogoIdentity("https://jobs.ashbyhq.com/%2e%2e/x"), { provider: "ashby", board: "x" });
  assert.equal(companyLogoIdentity("https://jobs.ashbyhq.com/%2Fprivate/x"), null);
});

test("regions are separate identities", () => {
  assert.deepEqual(companyLogoIdentity("https://job-boards.greenhouse.io/acme/jobs/1"), { provider: "greenhouse", board: "acme" });
  assert.deepEqual(companyLogoIdentity("https://job-boards.eu.greenhouse.io/acme/jobs/1"), { provider: "greenhouse-eu", board: "acme" });
  assert.notEqual(companyLogoSource("https://jobs.lever.co/acme/1"), companyLogoSource("https://jobs.eu.lever.co/acme/1"));
});

test("board slugs allow what ingestion allows and nothing that could escape a path", () => {
  for (const slug of ["a", "Example", "example-co", "example_co", "example.co", "x".repeat(100)]) assert.equal(isCompanyLogoBoardSlug(slug), true, slug);
  for (const slug of ["", ".hidden", "-lead", "a/b", "a\\b", "a..b", "a b", "a%2fb", "x".repeat(101), "a?b", "a#b"]) assert.equal(isCompanyLogoBoardSlug(slug), false, slug);
});

test("a failed load is retried with growing delays and then stops; it is never permanent after one error", () => {
  const run = (events: readonly CompanyLogoLoadEvent[], from: CompanyLogoLoad = INITIAL_COMPANY_LOGO_LOAD) => events.reduce(nextCompanyLogoLoad, from);
  // One error schedules a retry instead of giving up.
  assert.deepEqual(run(["errored"]), { phase: "waiting", attempt: 0 });
  assert.deepEqual(run(["errored", "retry"]), { phase: "loading", attempt: 1 });
  // A retry that loads is shown.
  assert.deepEqual(run(["errored", "retry", "loaded"]), { phase: "loaded", attempt: 1 });
  // Retries are bounded: every delay is used once, then the initials stay.
  const attempts = COMPANY_LOGO_RETRY_DELAYS_MS.length;
  const exhausted = run(Array.from({ length: attempts }, () => ["errored", "retry"] as const).flat().concat("errored"));
  assert.deepEqual(exhausted, { phase: "failed", attempt: attempts });
  assert.deepEqual(run(["retry", "errored"], exhausted), exhausted);
  // Duplicate or late events change nothing: a shown logo stays, a scheduled retry is not doubled.
  assert.deepEqual(run(["loaded", "errored", "errored"]), { phase: "loaded", attempt: 0 });
  assert.deepEqual(run(["errored", "errored"]), { phase: "waiting", attempt: 0 });
  assert.deepEqual(run(["retry"]), INITIAL_COMPANY_LOGO_LOAD);
  // A logo that has loaded is the same object after a parent re-render or poll: no event, no change.
  const loaded = run(["loaded"]);
  assert.equal(nextCompanyLogoLoad(loaded, "loaded"), loaded);
});

test("retries use distinct URLs, growing jittered delays and a hard bound", () => {
  const base = source("ashby", "example");
  assert.equal(companyLogoAttemptSource(base, 0), base);
  assert.equal(companyLogoAttemptSource(base, 2), `${base}&r=2`);
  assert.equal(companyLogoAttemptSource("/x.png", 1), "/x.png?r=1");
  const delays = COMPANY_LOGO_RETRY_DELAYS_MS.map((_, attempt) => companyLogoRetryDelay(attempt, () => 0.5));
  assert.deepEqual(delays, [2_000, 8_000, 30_000]);
  assert.ok(delays.every((delay, index) => index === 0 || delay! > delays[index - 1]!));
  for (const random of [0, 0.999]) {
    const delay = companyLogoRetryDelay(0, () => random)!;
    assert.ok(delay >= 1_500 && delay <= 2_500, String(delay));
  }
  assert.equal(companyLogoRetryDelay(COMPANY_LOGO_RETRY_DELAYS_MS.length), null);
});
