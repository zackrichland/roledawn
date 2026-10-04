import assert from "node:assert/strict";
import test from "node:test";

import { createHostedBrowserProbeRequest, hostedProbeOriginDecision } from "./openai-hosted-browser-probe.ts";

test("hosted probe contains no candidate or submit capability and constrains network hosts", () => {
  const request = createHostedBrowserProbeRequest({
    board: "LEVER",
    publicUrl: "https://jobs.lever.co/example/job-id",
    allowedDomains: ["jobs.lever.co", "newassets.hcaptcha.com"],
  });
  assert.equal(request.environment.network.access, "restricted");
  assert.deepEqual(request.environment.network.allowed_domains, ["jobs.lever.co", "newassets.hcaptcha.com"]);
  assert.deepEqual(request.agent.tools, [{ type: "computer_use", include_screenshots: false }]);
  assert.equal("files" in request.environment, false);
  assert.equal("candidate" in request, false);
  assert.equal("submit_permission" in request, false);
  assert.match(request.input, /jobs\.lever\.co\/example\/job-id/u);
});

test("hosted probe refuses Greenhouse and unrelated or malformed destinations", () => {
  const make = (board: "LEVER" | "ASHBY", publicUrl: string, allowedDomains = ["jobs.lever.co"]) =>
    createHostedBrowserProbeRequest({ board, publicUrl, allowedDomains });
  assert.throws(() => make("GREENHOUSE" as "LEVER", "https://boards.greenhouse.io/x"), /HOSTED_PROBE_BOARD_INVALID/u);
  assert.throws(() => make("LEVER", "https://evil.example/jobs/x"), /HOSTED_PROBE_URL_INVALID/u);
  assert.throws(() => make("LEVER", "http://jobs.lever.co/x"), /HOSTED_PROBE_URL_INVALID/u);
  assert.throws(() => make("LEVER", "https://jobs.lever.co/x?email=private"), /HOSTED_PROBE_URL_INVALID/u);
  assert.throws(() => make("LEVER", "https://jobs.lever.co/"), /HOSTED_PROBE_URL_INVALID/u);
  assert.throws(() => make("ASHBY", "https://jobs.ashbyhq.com/x", ["jobs.lever.co"]), /HOSTED_PROBE_NETWORK_INVALID/u);
  assert.throws(() => make("LEVER", "https://jobs.lever.co/x", ["jobs.lever.co", "*.hcaptcha.com"]), /HOSTED_PROBE_NETWORK_INVALID/u);
});

test("origin approval needs an explicit decision and exact allowed origin", () => {
  const approval = { type: "computer_use_approval_request" as const, request_id: "req_1",
    request: { type: "browser_origin_access" as const, origin: "https://jobs.lever.co" } };
  assert.deepEqual(hostedProbeOriginDecision(approval, ["jobs.lever.co"], "approve"), {
    type: "agent.session.input.computer_use_approval_request_result", request_id: "req_1",
    response: { type: "browser_origin_access", decision: "approve" },
  });
  assert.throws(() => hostedProbeOriginDecision({ ...approval, request: { ...approval.request,
    origin: "https://jobs.lever.co.evil.example" } }, ["jobs.lever.co"], "approve"), /OUT_OF_SCOPE/u);
  assert.throws(() => hostedProbeOriginDecision({ ...approval, request: { ...approval.request,
    origin: "https://jobs.lever.co/submit" } }, ["jobs.lever.co"], "approve"), /OUT_OF_SCOPE/u);
});
