import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./run-local-stack.ts", import.meta.url),
  "utf8",
);

test("owns the worker process directly so retained browser cleanup is awaited", () => {
  assert.match(
    source,
    /start\("worker", process\.execPath, \[/u,
  );
  assert.match(source, /"scripts\/run-worker-service\.ts"/u);
  assert.doesNotMatch(
    source,
    /start\("worker", npmCommand, \["run", "worker:service"\]\)/u,
  );
});
