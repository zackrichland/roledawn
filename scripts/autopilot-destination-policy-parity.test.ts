import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { parseAutopilotDestination } from "../src/domain/application-autopilot-eligibility.ts";

let db: PGlite;
before(async () => {
  const harness = await import(new URL("./migration-harness.mjs", import.meta.url).href) as {
    createMigratedDatabase(): Promise<{ db: PGlite }>;
  };
  ({ db } = await harness.createMigratedDatabase());
});
after(async () => { await db?.close(); });

test("database and runtime accept the same concrete hosted destinations", async () => {
  const uuid = "11111111-1111-4111-8111-11111111111a";
  const valid = [
    "https://job-boards.greenhouse.io/synthetic/jobs/123", "https://JOB-BOARDS.GREENHOUSE.IO:443/synthetic/jobs/123/",
    `https://jobs.lever.co/synthetic/${uuid}`, `https://JOBS.LEVER.CO:443/synthetic/${uuid}/apply/`,
    `https://jobs.ashbyhq.com/Synthetic_Board-1/${uuid}`, `https://JOBS.ASHBYHQ.COM:443/Synthetic_Board-1/${uuid}/application/`,
  ];
  const invalid = [null, "", "https://example.invalid/job", ...valid.flatMap(url => [
    `${url}?source=test`, `${url}#application`, `${url}\n`, ` ${url}`, url.replace("https://", "http://"),
    url.replace("https://", "https://user@"), url.replace(":443", "").replace(/^(https:\/\/[^/]+)/u, "$1:8443"),
  ]), ...[
    `https://jobs.ashbyhq.com.evil.invalid/synthetic/${uuid}`,
    `https://jobs.eu.ashbyhq.com/synthetic/${uuid}`,
    `https://jobs.ashbyhq.com/synthetic/${uuid.toUpperCase()}`,
    `https://jobs.ashbyhq.com/synthetic/${uuid}/apply`,
    `https://jobs.ashbyhq.com/synthetic/${uuid}/application/extra`,
    `https://jobs.ashbyhq.com/%73ynthetic/${uuid}`,
    `https://jobs.ashbyhq.com/synthetic/../${uuid}`,
  ]];
  for (const [urls, expected] of [[valid, true], [invalid, false]] as const) {
    for (const url of urls) {
      const result = await db.query<{ supported: boolean }>("select private.is_supported_autopilot_destination($1) as supported", [url]);
      assert.equal(Boolean(parseAutopilotDestination(url)), expected, `runtime ${JSON.stringify(url)}`);
      assert.equal(result.rows[0].supported, expected, `database ${JSON.stringify(url)}`);
    }
  }
});
