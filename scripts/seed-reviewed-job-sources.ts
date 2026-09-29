import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import { parseReviewedJobSourceRegistry, seedReviewedJobSources } from "../src/server/ingestion/source-registry.ts";

// Usage: seed-reviewed-job-sources.ts [registry.json | directory ...] [--apply]
// With no paths, every data/job-sources/reviewed-*.json file is used. Directory
// matches run in file-name order; each file is one registry release.
const REGISTRY_FILE = /^reviewed-.*\.json$/u;
const DEFAULT_DIRECTORY = fileURLToPath(new URL("../data/job-sources/", import.meta.url));

async function registryFiles(targets: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const target of targets.length > 0 ? targets.map(value => resolve(value)) : [DEFAULT_DIRECTORY]) {
    if ((await stat(target)).isDirectory()) {
      files.push(...(await readdir(target)).filter(name => REGISTRY_FILE.test(name)).sort().map(name => join(target, name)));
    } else {
      files.push(target);
    }
  }
  if (files.length === 0) throw new Error("SOURCE_REGISTRY_FILES_NOT_FOUND");
  return [...new Set(files)];
}

const files = await registryFiles(process.argv.slice(2).filter(arg => !arg.startsWith("--")));
// Every release is validated before any write, so one bad file cannot leave a partial seed.
const registries = await Promise.all(files.map(async file => {
  try {
    return { file: relative(process.cwd(), file), registry: parseReviewedJobSourceRegistry(JSON.parse(await readFile(file, "utf8"))) };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : "SOURCE_REGISTRY_INVALID"} (${relative(process.cwd(), file)})`, { cause: error });
  }
}));
if (!process.argv.includes("--apply")) {
  for (const { file, registry } of registries) {
    process.stdout.write(`${JSON.stringify({ mode: "REVIEW_ONLY", file, release: registry.release, sourceCount: registry.sources.length, sources: registry.sources.map(source => ({ employer: source.employerName, provider: source.provider, board: source.publicBoardUrl })) })}\n`);
  }
} else {
  const client = createSupabaseAdminClient("job-source-registry/1") as never;
  for (const { file, registry } of registries) {
    const result = await seedReviewedJobSources(client, registry);
    process.stdout.write(`${JSON.stringify({ file, ...result })}\n`);
  }
}
