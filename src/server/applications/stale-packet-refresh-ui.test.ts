import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const QUEUE = new URL("../dashboard/queue.ts", import.meta.url);
const ADAPTER = new URL("./preparation.ts", import.meta.url);
const ACTIONS = new URL(
  "../../app/(candidate)/applications/[applicationId]/actions.ts",
  import.meta.url,
);
const PAGE = new URL(
  "../../app/(candidate)/applications/[applicationId]/page.tsx",
  import.meta.url,
);
const CONTROL = new URL(
  "../../components/applications/ApplicationFilesRefresh.tsx",
  import.meta.url,
);

test("application detail derives one stale flag without exposing input epochs", async () => {
  const source = await readFile(QUEUE, "utf8");
  const dtoStart = source.indexOf("export type ApplicationWorkspaceDTO");
  const dtoEnd = source.indexOf("const UUID_PATTERN", dtoStart);
  const dto = source.slice(dtoStart, dtoEnd);

  assert.match(source, /select\("id, application_input_version"\)/u);
  assert.match(source, /id, input_snapshot_id, version_number/u);
  assert.match(source, /applicationInputsChanged\(/u);
  assert.match(dto, /profileChanged: boolean/u);
  assert.doesNotMatch(dto, /candidateInputVersion|snapshotInputVersion/u);
});

test("stale-only refresh is wired through the adapter, action, and page", async () => {
  const [adapter, actions, page, control] = await Promise.all([
    readFile(ADAPTER, "utf8"),
    readFile(ACTIONS, "utf8"),
    readFile(PAGE, "utf8"),
    readFile(CONTROL, "utf8"),
  ]);

  assert.match(adapter, /rpc\("refresh_stale_application_packet"/u);
  assert.match(actions, /refreshApplicationFilesAction/u);
  assert.match(page, /application\.profileChanged/u);
  assert.match(page, /\["READY", "NEEDS_USER", "FAILED_SAFE"\]/u);
  assert.match(page, /<ApplicationFilesRefresh/u);
  assert.match(page, /application\.profileChanged && application\.status === "READY"/u);
  assert.match(control, /Your profile changed/u);
  assert.match(control, /"Rewrite documents"/u);
});
