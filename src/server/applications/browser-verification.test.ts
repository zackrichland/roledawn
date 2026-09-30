import assert from "node:assert/strict";
import test from "node:test";
import { applicationBrowserCheckUrl, browserCheckHtml, readApplicationBrowserChecks } from "./browser-verification.ts";

test("live view selects one exact candidate tab and rejects default, drifted or ambiguous tabs", () => {
  const destination = "https://jobs.example.test/board/job/application";
  const tab = { url: destination, debuggerFullscreenUrl: "https://www.browserbase.com/devtools/inspector?token=synthetic" };
  assert.match(applicationBrowserCheckUrl([{ ...tab, url: "about:blank" }, tab], destination), /navbar=false/u);
  for (const pages of [[], [{ ...tab, url: destination + "?other=1" }], [tab, tab], [{ ...tab, debuggerFullscreenUrl: "https://browserbase.com.evil.test/?x" }]]) {
    assert.throws(() => applicationBrowserCheckUrl(pages, destination), /TAB_UNAVAILABLE/u);
  }
  const html = browserCheckHtml(tab.debuggerFullscreenUrl + '&x="<');
  assert.match(html, /sandbox="allow-scripts allow-same-origin"/u);
  assert.match(html, /&amp;x=&quot;&lt;/u);
  assert.doesNotMatch(html, /allow-top-navigation|allow-popups/u);
});

test("candidate reader returns only live non-secret metadata", async () => {
  const owned = { autopilot_id: "synthetic-send", application_id: "synthetic-application", expires_at: new Date(Date.now()+60_000).toISOString(), provider_session_ref: "must-not-leak" };
  const client = { async rpc() { return { data: [owned, { ...owned, expires_at: new Date(0).toISOString() }], error: null }; } };
  assert.deepEqual(await readApplicationBrowserChecks(client), [{ autopilotId: owned.autopilot_id, applicationId: owned.application_id, expiresAt: owned.expires_at }]);
});
