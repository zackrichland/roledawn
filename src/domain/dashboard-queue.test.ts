import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationStatusGroup,
  canPresentAsSubmitted,
  isApplicationWorkInProgress,
  isApplicationStatus,
  latestPreparationSnapshotId,
} from "./dashboard-queue.ts";

test("confirmed without a receipt is not presented as submitted", () => {
  assert.equal(canPresentAsSubmitted("CONFIRMED", false), false);
});

test("a confirmed application with a receipt can be presented as submitted", () => {
  assert.equal(canPresentAsSubmitted("CONFIRMED", true), true);
});

test("a receipt cannot make a non-confirmed application look submitted", () => {
  assert.equal(canPresentAsSubmitted("EXECUTING", true), false);
});

test("pre-submit review is a supported state without submission authority", () => {
  assert.equal(isApplicationStatus("PRE_SUBMIT_REVIEW"), true);
  assert.equal(canPresentAsSubmitted("PRE_SUBMIT_REVIEW", true), false);
});

test("queue status groups keep active work, candidate action, review, and done states distinct", () => {
  assert.equal(applicationStatusGroup("DRAFTING", "RESOLVED", false), "IN_PROGRESS");
  assert.equal(applicationStatusGroup("READY", "RESOLVED", false), "READY");
  assert.equal(applicationStatusGroup("TAKEOVER", "RESOLVED", false), "NEEDS_YOU");
  assert.equal(applicationStatusGroup("CONFIRMED", "RESOLVED", true), "DONE");
});

test("job intake state takes precedence over the application status in queue filters", () => {
  assert.equal(applicationStatusGroup("READY", "RESOLVING", false), "IN_PROGRESS");
  assert.equal(applicationStatusGroup("READY", "FAILED", false), "NEEDS_YOU");
});

test("confirmed applications need a receipt before appearing as done", () => {
  assert.equal(applicationStatusGroup("CONFIRMED", "RESOLVED", false), "NEEDS_YOU");
  assert.equal(applicationStatusGroup("CONFIRMED", "RESOLVED", true), "DONE");
});

test("automatic refresh is limited to nonterminal work", () => {
  assert.equal(isApplicationWorkInProgress("EXECUTING", "RESOLVED"), true);
  assert.equal(isApplicationWorkInProgress("READY", "RESOLVED"), false);
  assert.equal(isApplicationWorkInProgress("NEEDS_USER", "RESOLVED"), false);
  assert.equal(isApplicationWorkInProgress("READY", "PENDING"), true);
});

test("a queued retry cannot inherit an older preparation snapshot", () => {
  const runs = [
    { runKind: "PREPARATION", inputSnapshotId: null },
    { runKind: "PREPARATION", inputSnapshotId: "older-blocked-snapshot" },
  ] as const;

  assert.equal(latestPreparationSnapshotId(runs), null);
});

test("the latest preparation run binds only its own snapshot", () => {
  const runs = [
    { runKind: "OTHER", inputSnapshotId: "unrelated-snapshot" },
    { runKind: "PREPARATION", inputSnapshotId: "current-preparation-snapshot" },
    { runKind: "PREPARATION", inputSnapshotId: "older-preparation-snapshot" },
  ] as const;

  assert.equal(
    latestPreparationSnapshotId(runs),
    "current-preparation-snapshot",
  );
});
