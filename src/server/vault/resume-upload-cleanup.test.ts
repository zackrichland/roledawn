import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupResumeUploadReservation,
  ResumeUploadCleanupFailure,
} from "./resume-upload-cleanup.ts";

test("storage failure preserves the reservation for recovery", async () => {
  let cancellationCalls = 0;

  await assert.rejects(
    cleanupResumeUploadReservation({
      storagePath: "workspace/candidate/resumes/document/version.pdf",
      removeStorageObject: async () => ({ error: new Error("remove failed") }),
      cancelReservation: async () => {
        cancellationCalls += 1;
        return { data: [{ cancelled: true }], error: null };
      },
    }),
    (error: unknown) =>
      error instanceof ResumeUploadCleanupFailure && error.operation === "storage",
  );

  assert.equal(cancellationCalls, 0);
});

test("reservation failure is surfaced after Storage deletion", async () => {
  const operations: string[] = [];

  await assert.rejects(
    cleanupResumeUploadReservation({
      storagePath: "workspace/candidate/resumes/document/version.pdf",
      removeStorageObject: async () => {
        operations.push("storage");
        return { data: [], error: null };
      },
      cancelReservation: async () => {
        operations.push("reservation");
        return { data: null, error: new Error("cancel failed") };
      },
    }),
    (error: unknown) =>
      error instanceof ResumeUploadCleanupFailure && error.operation === "reservation",
  );

  assert.deepEqual(operations, ["storage", "reservation"]);
});

test("missing Storage path skips deletion and still cancels", async () => {
  let removalCalls = 0;
  let cancellationCalls = 0;

  await cleanupResumeUploadReservation({
    storagePath: null,
    removeStorageObject: async () => {
      removalCalls += 1;
      return { data: [], error: null };
    },
    cancelReservation: async () => {
      cancellationCalls += 1;
      return { data: [{ cancelled: true }], error: null };
    },
  });

  assert.equal(removalCalls, 0);
  assert.equal(cancellationCalls, 1);
});

test("cleanup requires an explicit cancelled response", async () => {
  await assert.rejects(
    cleanupResumeUploadReservation({
      storagePath: null,
      removeStorageObject: async () => ({ data: [], error: null }),
      cancelReservation: async () => ({ data: [], error: null }),
    }),
    (error: unknown) =>
      error instanceof ResumeUploadCleanupFailure && error.operation === "reservation",
  );
});

test("successful cleanup completes in Storage-first order", async () => {
  const operations: string[] = [];

  await cleanupResumeUploadReservation({
    storagePath: "workspace/candidate/resumes/document/version.pdf",
    removeStorageObject: async () => {
      operations.push("storage");
      return { data: [], error: null };
    },
    cancelReservation: async () => {
      operations.push("reservation");
      return { data: [{ cancelled: true }], error: null };
    },
  });

  assert.deepEqual(operations, ["storage", "reservation"]);
});
