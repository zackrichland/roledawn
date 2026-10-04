import { readFile } from "node:fs/promises";
import { readHostedTraceSummaries } from "../src/server/workers/openai-hosted-browser-traces.ts";

// Private input: { sessionId, stages: { [rootTurnId]: "INSPECTION" | ... } }.
// This command only reads existing traces; it cannot create or continue a session.
try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error("HOSTED_TRACE_MANIFEST_REQUIRED");
  const bytes = await readFile(path);
  if (bytes.byteLength > 65_536) throw new Error("HOSTED_TRACE_MANIFEST_TOO_LARGE");
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      !manifest.stages || typeof manifest.stages !== "object" || Array.isArray(manifest.stages)) {
    throw new Error("HOSTED_TRACE_MANIFEST_INVALID");
  }
  const result = await readHostedTraceSummaries({ apiKey: process.env.OPENAI_API_KEY ?? "", sessionId: manifest.sessionId, stages: manifest.stages });
  console.log(JSON.stringify(result));
} catch (error) {
  // Never print a filesystem error, provider response or malformed private input.
  console.error(error instanceof Error && /^HOSTED_TRACE_[A-Z_]+$/u.test(error.message)
    ? error.message : "HOSTED_TRACE_READ_FAILED");
  process.exitCode = 1;
}
