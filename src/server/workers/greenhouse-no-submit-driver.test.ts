import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { chromium, type Page } from "playwright-core";

import type { CandidateFactKey } from "../../domain/candidate-profile.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import { createGreenhouseNoSubmitDriver } from "./greenhouse-no-submit-driver.ts";

const IDS = Object.freeze({
  workspace: "10000000-0000-4000-8000-000000000001",
  candidate: "20000000-0000-4000-8000-000000000002",
  application: "30000000-0000-4000-8000-000000000003",
  revision: "40000000-0000-4000-8000-000000000004",
  fill: "50000000-0000-4000-8000-000000000005",
  session: "60000000-0000-4000-8000-000000000006",
});

const binding = Object.freeze({
  workspaceId: IDS.workspace,
  candidateId: IDS.candidate,
  applicationId: IDS.application,
  revisionId: IDS.revision,
  fillAttemptId: IDS.fill,
  computerSessionId: IDS.session,
});

function findChrome(): string | null {
  const configured = process.env.ROLEDAWN_CHROME_PATH?.trim();
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// Optional look-alike questions. Keyword matching once filled several of these
// with the candidate's own email, phone, name or location.
const TRAP_FIELDS = Object.freeze([
  ["referral_email", '<label>Referral email <input name="referral_email" type="email"></label>'],
  ["referred_by", '<label>Who referred you (email)? <input name="referred_by" type="email"></label>'],
  ["referrer_name", '<label>Full name of referrer <input name="referrer_name"></label>'],
  ["emergency_phone", '<label>Emergency contact phone <input name="emergency_phone" type="tel"></label>'],
  ["previous_employer_phone", '<label>Previous employer phone <input name="previous_employer_phone" type="tel"></label>'],
  ["salary", '<label>Please state your salary expectations <input name="salary"></label>'],
  ["company_website", '<label>Company website <input name="company_website" type="url"></label>'],
  ["org", '<label>Current company <input name="org"></label>'],
  ["manager_name", '<label>Manager\'s name <input name="manager_name"></label>'],
  ["preferred_first_name", '<label>Preferred first name <input name="preferred_first_name"></label>'],
  ["middle_name", '<label>Middle name <input name="middle_name"></label>'],
  ["school_city", '<label>School city/state <input name="school_city"></label>'],
  ["birth_country", '<label>Country of birth <select name="birth_country"><option value="">Choose one</option><option value="US">United States</option></select></label>'],
] as const);

function fixtureHtml(
  includeUnknownRequired: boolean,
  includeRequiredSensitive: boolean,
  includeWorkAuthorization: boolean,
  includeTraps = false,
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Greenhouse-style fixture</title></head>
<body><main><h1>Product Engineer</h1>
  <form action="/submit" method="post" enctype="multipart/form-data">
    <label>First name <input name="first_name" autocomplete="given-name" aria-required="true"></label>
    <label>Last name <input name="last_name" autocomplete="family-name" aria-required="true"></label>
    <label>Full legal name <input name="full_name" autocomplete="name"></label>
    <label>Email <input name="email" type="email" autocomplete="email" aria-required="true"></label>
    <label>Phone <input name="phone" type="tel" autocomplete="tel" required></label>
    <label>LinkedIn <input name="linkedin_url" type="url"></label>
    <label>Website <input name="website_url" type="url"></label>
    <label>City <input name="city" autocomplete="address-level2"></label>
    <label>State or region <input name="region" autocomplete="address-level1"></label>
    <label>Country <select name="country" autocomplete="country" required>
      <option value="">Choose one</option><option value="US">United States</option>
    </select></label>
    <label>Résumé <input name="resume" type="file" accept="application/pdf" required></label>
    <label>Cover letter <input name="cover_letter" type="file" accept="application/pdf"></label>
    <label>Gender (optional) <select name="gender"><option value="">Prefer not to answer</option><option value="male">Male</option></select></label>
    <label>Optional note <textarea name="note"></textarea></label>
    ${includeTraps ? TRAP_FIELDS.map(([, html]) => html).join("\n    ") : ""}
    ${includeUnknownRequired ? '<label>Why this company? <textarea name="why_company" required></textarea></label>' : ""}
    ${includeRequiredSensitive ? '<label>Are you a United States citizen? <select name="citizenship" required><option value="">Choose one</option><option value="yes">Yes</option><option value="no">No</option></select></label>' : ""}
    ${includeWorkAuthorization ? `<fieldset>
      <legend>Are you legally authorized to work in the United States?</legend>
      <label><input name="work_authorization" type="radio" value="yes" required> Yes</label>
      <label><input name="work_authorization" type="radio" value="no"> No</label>
    </fieldset>
    <label>Will you now or in the future require sponsorship to work in the United States?
      <select name="sponsorship" aria-required="true"><option value="">Choose one</option><option value="yes">Yes</option><option value="no">No</option></select>
    </label>` : ""}
    <button type="submit">Submit application</button>
  </form>
</main></body></html>`;
}

async function startFixture(): Promise<Readonly<{
  baseUrl: string;
  submitCount: () => number;
  close: () => Promise<void>;
}>> {
  let submits = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/job") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixtureHtml(
        url.searchParams.get("unknown") === "1",
        url.searchParams.get("requiredSensitive") === "1",
        url.searchParams.get("workAuthorization") === "1",
        url.searchParams.get("traps") === "1",
      ));
      return;
    }
    if (url.pathname === "/submit") {
      submits += 1;
      response.writeHead(409, { "content-type": "text/plain" });
      response.end("Submission must never be reached.");
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind TCP.");
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}`,
    submitCount: () => submits,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  });
}

function executionPackage(
  destinationUrl: string,
  omittedFactKey: CandidateFactKey | null = null,
): ApplicationFillExecutionPackage {
  const resumeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const coverBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32]);
  const facts = [
    { factVersionId: "b0000000-0000-4000-8000-00000000000b", factKey: "identity.given_name", value: "Zack", valueHash: "5".repeat(64) },
    { factVersionId: "c0000000-0000-4000-8000-00000000000c", factKey: "identity.family_name", value: "Richland", valueHash: "6".repeat(64) },
    { factVersionId: IDS.workspace, factKey: "identity.legal_name", value: "Zack Richland", valueHash: "a".repeat(64) },
    { factVersionId: IDS.candidate, factKey: "contact.application_email", value: "zack@example.com", valueHash: "b".repeat(64) },
    { factVersionId: IDS.application, factKey: "contact.phone", value: "+12025550123", valueHash: "c".repeat(64) },
    { factVersionId: IDS.revision, factKey: "contact.linkedin_url", value: "https://linkedin.com/in/zack", valueHash: "d".repeat(64) },
    { factVersionId: IDS.fill, factKey: "contact.website_url", value: "https://example.com", valueHash: "e".repeat(64) },
    { factVersionId: IDS.session, factKey: "location.city", value: "Washington", valueHash: "f".repeat(64) },
    { factVersionId: "70000000-0000-4000-8000-000000000007", factKey: "location.region", value: "DC", valueHash: "1".repeat(64) },
    { factVersionId: "80000000-0000-4000-8000-000000000008", factKey: "location.country_code", value: "US", valueHash: "2".repeat(64) },
    { factVersionId: "d0000000-0000-4000-8000-00000000000d", factKey: "work_authorization.us.authorized", value: "Yes", valueHash: "7".repeat(64) },
    { factVersionId: "e0000000-0000-4000-8000-00000000000e", factKey: "work_authorization.us.sponsorship_required", value: "No", valueHash: "8".repeat(64) },
  ] satisfies ApplicationFillExecutionPackage["facts"];
  return Object.freeze({
    schemaRelease: "application-fill-execution-package/1" as const,
    authorityScope: "FILL_ONLY_NO_SUBMIT" as const,
    binding,
    destinationUrl,
    facts: Object.freeze(facts.filter((fact) => fact.factKey !== omittedFactKey)),
    artifacts: Object.freeze([
      {
        artifactVersionId: "90000000-0000-4000-8000-000000000009",
        variant: "RESUME_PDF" as const,
        filename: "resume.pdf",
        mediaType: "application/pdf",
        byteSize: resumeBytes.byteLength,
        sha256: "3".repeat(64),
        bytes: resumeBytes,
      },
      {
        artifactVersionId: "a0000000-0000-4000-8000-00000000000a",
        variant: "COVER_LETTER_PDF" as const,
        filename: "cover-letter.pdf",
        mediaType: "application/pdf",
        byteSize: coverBytes.byteLength,
        sha256: "4".repeat(64),
        bytes: coverBytes,
      },
    ]),
    submitAuthorized: false as const,
  });
}

async function evaluateValue(page: Page, selector: string): Promise<string> {
  return page.locator(selector).inputValue();
}

const chromePath = findChrome();

test("real Chromium fills only exact standard values and authorized files, then stops before submit", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    let uploadedBytes = 0;
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: (_handle, byteCount) => {
        uploadedBytes += byteCount;
      },
    });
    const result = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });

    assert.equal(result.kind, "FILLED_TO_REVIEW");
    // A bare "Website" label is not clearly personal; it is left empty.
    assert.equal(result.filledFieldCount, 9);
    assert.equal(result.uploadedArtifactCount, 2);
    assert.equal(result.blockedFieldCount, 1);
    assert.match(result.readbackHash ?? "", /^[0-9a-f]{64}$/u);
    assert.equal(await evaluateValue(page, 'input[name="first_name"]'), "Zack");
    assert.equal(await evaluateValue(page, 'input[name="last_name"]'), "Richland");
    assert.equal(await evaluateValue(page, 'input[name="full_name"]'), "Zack Richland");
    assert.equal(await evaluateValue(page, 'input[name="email"]'), "zack@example.com");
    assert.equal(await evaluateValue(page, 'input[name="website_url"]'), "");
    assert.equal(await evaluateValue(page, 'input[name="region"]'), "DC");
    assert.equal(await evaluateValue(page, 'select[name="country"]'), "US");
    assert.equal(await evaluateValue(page, 'select[name="gender"]'), "");
    assert.equal(await page.locator('input[name="resume"]').evaluate((element) =>
      (element as HTMLInputElement).files?.[0]?.name ?? null
    ), "resume.pdf");
    assert.equal(await page.locator('input[name="cover_letter"]').evaluate((element) =>
      (element as HTMLInputElement).files?.[0]?.name ?? null
    ), "cover-letter.pdf");
    assert.equal(uploadedBytes, 12);
    assert.equal(await page.getByRole("button", { name: "Submit application" }).isDisabled(), true);

    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await page.waitForTimeout(100);
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("look-alike referral, emergency, employer, salary and name-variant questions stay empty", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job?traps=1`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const driver = createGreenhouseNoSubmitDriver({ resolvePage: () => page, recordUpload: () => undefined });
    const result = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });
    assert.equal(result.kind, "FILLED_TO_REVIEW");
    assert.equal(result.filledFieldCount, 9);
    assert.equal(await evaluateValue(page, 'input[name="email"]'), "zack@example.com");
    assert.equal(await evaluateValue(page, 'input[name="phone"]'), "+12025550123");
    for (const [name] of TRAP_FIELDS) {
      assert.equal(await page.locator(`[name="${name}"]`).inputValue(), "", name);
    }
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("unknown required questions trigger takeover before candidate values are disclosed", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job?unknown=1`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: () => undefined,
    });
    const result = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });
    assert.deepEqual(result, {
      kind: "TAKEOVER",
      reasonCode: "APPLICATION_FILL_UNKNOWN_REQUIRED_FIELD_TAKEOVER",
      readbackHash: null,
      filledFieldCount: 0,
      uploadedArtifactCount: 0,
      blockedFieldCount: 1,
    });
    assert.equal(await evaluateValue(page, 'input[name="full_name"]'), "");
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("aria-required fields with missing reviewed facts trigger takeover before any disclosure", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    let uploadedBytes = 0;
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: (_handle, byteCount) => {
        uploadedBytes += byteCount;
      },
    });
    const result = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl, "contact.application_email"),
      submitAuthorized: false,
    });
    assert.deepEqual(result, {
      kind: "TAKEOVER",
      reasonCode: "APPLICATION_FILL_REQUIRED_VALUE_MISSING_TAKEOVER",
      readbackHash: null,
      filledFieldCount: 0,
      uploadedArtifactCount: 0,
      blockedFieldCount: 1,
    });
    assert.equal(await evaluateValue(page, 'input[name="first_name"]'), "");
    assert.equal(await evaluateValue(page, 'input[name="last_name"]'), "");
    assert.equal(await evaluateValue(page, 'input[name="full_name"]'), "");
    assert.equal(await evaluateValue(page, 'input[name="email"]'), "");
    assert.equal(await page.locator('input[name="resume"]').evaluate((element) =>
      (element as HTMLInputElement).files?.length ?? 0
    ), 0);
    assert.equal(uploadedBytes, 0);
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("candidate-attested work authorization fills deterministic yes/no radio and select controls", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job?workAuthorization=1`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: () => undefined,
    });
    const result = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });
    assert.equal(result.kind, "FILLED_TO_REVIEW");
    assert.equal(result.filledFieldCount, 11);
    assert.equal(await page.locator('input[name="work_authorization"][value="yes"]').isChecked(), true);
    assert.equal(await page.locator('input[name="work_authorization"][value="no"]').isChecked(), false);
    assert.equal(await evaluateValue(page, 'select[name="sponsorship"]'), "no");
    assert.equal(await page.getByRole("button", { name: "Submit application" }).isDisabled(), true);
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("required sensitive questions trigger takeover before candidate values are disclosed", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job?requiredSensitive=1`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: () => undefined,
    });
    const result = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });
    assert.deepEqual(result, {
      kind: "TAKEOVER",
      reasonCode: "APPLICATION_FILL_SENSITIVE_LEGAL_TAKEOVER",
      readbackHash: null,
      filledFieldCount: 0,
      uploadedArtifactCount: 0,
      blockedFieldCount: 1,
    });
    assert.equal(await evaluateValue(page, 'input[name="full_name"]'), "");
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("continues the same guarded page after the candidate answers a protected required question", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job?requiredSensitive=1`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: () => undefined,
    });
    const first = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });
    assert.equal(first.kind, "TAKEOVER");

    // This is the candidate's action in the live browser, not an agent guess.
    await page.locator('select[name="citizenship"]').selectOption("yes");
    const continued = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });

    assert.equal(continued.kind, "FILLED_TO_REVIEW");
    assert.equal(await evaluateValue(page, 'select[name="citizenship"]'), "yes");
    assert.equal(await evaluateValue(page, 'input[name="full_name"]'), "Zack Richland");
    assert.equal(await page.getByRole("button", { name: "Submit application" }).isDisabled(), true);
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await page.waitForTimeout(100);
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("continues after a candidate answers an unknown required prompt without overwriting it", {
  skip: chromePath === null,
}, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ executablePath: chromePath ?? undefined, headless: true });
  try {
    const page = await browser.newPage();
    const startUrl = `${fixture.baseUrl}/job?unknown=1`;
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    const driver = createGreenhouseNoSubmitDriver({
      resolvePage: () => page,
      recordUpload: () => undefined,
    });
    const first = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });
    assert.equal(first.kind, "TAKEOVER");

    await page.locator('textarea[name="why_company"]').fill("Candidate-written answer");
    const continued = await driver.fillToPreSubmitReview({
      runtimeHandle: Object.freeze({ test: true }),
      binding,
      startUrl,
      executionPackage: executionPackage(startUrl),
      submitAuthorized: false,
    });

    assert.equal(continued.kind, "FILLED_TO_REVIEW");
    assert.equal(await evaluateValue(page, 'textarea[name="why_company"]'), "Candidate-written answer");
    assert.equal(fixture.submitCount(), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
