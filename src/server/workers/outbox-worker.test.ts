import assert from "node:assert/strict";
import test from "node:test";

import { preparationOutboxHandlerKind } from "./outbox-worker.ts";

test("routes pasted links to resolution and both resolved job paths to one snapshot handler", () => {
  assert.equal(preparationOutboxHandlerKind("application.queued"), "JOB_RESOLVER");
  assert.equal(preparationOutboxHandlerKind("application.job_resolved"), "INPUT_SNAPSHOT");
  assert.equal(preparationOutboxHandlerKind("application.preparation_requested"), "INPUT_SNAPSHOT");
  assert.equal(preparationOutboxHandlerKind("application.drafting_requested"), null);
});
