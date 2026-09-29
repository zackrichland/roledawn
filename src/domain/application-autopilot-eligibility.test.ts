import assert from "node:assert/strict";
import test from "node:test";
import { ATS_DELIVERY_CAPABILITIES, parseAutopilotDestination, parseGreenhouseAutopilotDestination } from "./application-autopilot-eligibility.ts";
import { resolveApplicationDeliveryPolicy, resolveGreenhouseDeliveryPolicy } from "../server/workers/application-delivery-browser.ts";

const accepted = [
  "https://job-boards.greenhouse.io/example/jobs/1234",
  "https://job-boards.greenhouse.io/example/jobs/1234/",
  "https://job-boards.greenhouse.io/example_2-inc/jobs/0012",
  "https://JOB-BOARDS.GREENHOUSE.IO:443/example/jobs/1234",
];
const rejected = [
  null, undefined, "", "not a URL", "http://job-boards.greenhouse.io/example/jobs/1234",
  "https://jobs.lever.co/example/1234", "https://jobs.ashbyhq.com/example/1234",
  "https://job-boards.eu.greenhouse.io/example/jobs/1234", "https://boards.greenhouse.io/example/jobs/1234",
  "https://job-boards.greenhouse.io.evil.example/example/jobs/1234",
  "https://user@job-boards.greenhouse.io/example/jobs/1234",
  "https://user:password@job-boards.greenhouse.io/example/jobs/1234",
  "https://:password@job-boards.greenhouse.io/example/jobs/1234",
  "https://job-boards.greenhouse.io:444/example/jobs/1234", "https://job-boards.greenhouse.io/Example/jobs/1234",
  "https://job-boards.greenhouse.io/example/jobs/job1234", "https://job-boards.greenhouse.io/example/jobs/1234/confirmation",
  "https://job-boards.greenhouse.io/example/jobs/1234?gh_src=referral", "https://job-boards.greenhouse.io/example/jobs/1234#application",
  "https://job-boards.greenhouse.io/example%2Fother/jobs/1234", "https://job-boards.greenhouse.io/embed/job_app?token=1234",
  "https://job-boards.greenhouse.io:0443/example/jobs/1234", "https://job-boards.greenhouse.io:/example/jobs/1234",
  "https://job-boards.greenhouse.io/other/../example/jobs/1234", " https://job-boards.greenhouse.io/example/jobs/1234",
];
test("autopilot accepts only the concrete US hosted Greenhouse route and normalizes its start URL", () => {
  for (const value of accepted) assert.ok(parseGreenhouseAutopilotDestination(value), value);
  assert.deepEqual(parseGreenhouseAutopilotDestination(accepted[1]), {
    boardToken: "example", jobId: "1234", startUrl: accepted[0],
  });
});

test("Lever delivery binds an exact tenant and UUID; Ashby remains preparation only", () => {
  const base = "https://jobs.lever.co/example/10000000-0000-4000-8000-000000000001";
  for (const url of [base, `${base}/`, `${base}/apply`, `${base}/apply/`]) {
    const destination = parseAutopilotDestination(url);
    assert.equal(destination?.provider, "LEVER");
    assert.equal(destination?.startUrl, `${base}/apply`);
    const policy = resolveApplicationDeliveryPolicy(url);
    assert.equal(policy.steps[0].submit?.request.url, `${base}/apply`);
    assert.equal(policy.receipt.url, `${base}/thanks`);
  }
  for (const url of [`${base}?source=anything`, `${base}#apply`, `${base}/thanks`, base.replace("jobs.lever.co", "jobs.eu.lever.co"), base.replace("jobs.lever.co", "jobs.lever.co.evil.example"), base.replace("https://", "https://user@"), base.replace("/example/", "/a%2fb/"), base.replace("jobs.lever.co", "jobs.ashbyhq.com")]) {
    assert.equal(parseAutopilotDestination(url), null, url);
    assert.throws(() => resolveApplicationDeliveryPolicy(url), /SITE_UNSUPPORTED/u);
  }
  assert.equal(ATS_DELIVERY_CAPABILITIES.ASHBY.status, "PREPARATION_ONLY");
});
test("autopilot rejects unsupported providers, regions, origins and route variants", () => {
  for (const value of rejected) assert.equal(parseGreenhouseAutopilotDestination(value), null, String(value));
});
test("candidate eligibility and the final browser policy cannot disagree", () => {
  for (const value of accepted) assert.equal(resolveGreenhouseDeliveryPolicy(value).destinationUrl, parseGreenhouseAutopilotDestination(value)?.startUrl);
  for (const value of rejected) if (typeof value === "string") assert.throws(() => resolveGreenhouseDeliveryPolicy(value), /DELIVERY_SITE_UNSUPPORTED/u);
});
