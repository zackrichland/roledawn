import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { AcceptanceFailure } from "./milestone-zero-acceptance-lib.ts";
import {
  cleanupOpportunityCatalogAcceptance,
  requireOpportunityCatalogAcceptanceConfig,
  requireOpportunityCatalogCleanupAcknowledgement,
  validateOpportunityCatalogCleanupRecord,
} from "./opportunity-catalog-acceptance-lib.ts";

const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");

async function loadCleanupRecord(recordPath: string) {
  const resolvedPath = resolve(recordPath);
  const allowedDirectory = await realpath(ARTIFACT_DIRECTORY);
  const parentDirectory = await realpath(dirname(resolvedPath));
  if (parentDirectory !== allowedDirectory) {
    throw new AcceptanceFailure("CLEANUP_RECORD_OUTSIDE_ACCEPTANCE_DIRECTORY");
  }

  const stats = await lstat(resolvedPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new AcceptanceFailure("CLEANUP_RECORD_FILE_INVALID");
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new AcceptanceFailure("CLEANUP_RECORD_PERMISSIONS_UNSAFE");
  }

  const parsed = validateOpportunityCatalogCleanupRecord(
    JSON.parse(await readFile(resolvedPath, "utf8")),
  );
  if (basename(resolvedPath) !== `opportunity-${parsed.runId}-cleanup.json`) {
    throw new AcceptanceFailure("CLEANUP_RECORD_FILENAME_MISMATCH");
  }
  return parsed;
}

const recordPath = process.argv[2];
if (!recordPath) {
  throw new AcceptanceFailure(
    "USAGE: npm run acceptance:opportunity:cleanup -- artifacts/acceptance/opportunity-<run>-cleanup.json",
  );
}

requireOpportunityCatalogCleanupAcknowledgement();
const config = requireOpportunityCatalogAcceptanceConfig();
const record = await loadCleanupRecord(recordPath);
if (record.projectRef !== config.expectedProjectRef) {
  throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
}

const failures = await cleanupOpportunityCatalogAcceptance(config, record);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Opportunity-catalog acceptance cleanup complete.\n");
}
