import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(process.cwd());
const skippedDirectories = new Set([".git", ".next", "node_modules"]);

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name)
        ? []
        : markdownFiles(join(directory, entry.name));
    }
    return entry.isFile() && extname(entry.name) === ".md"
      ? [join(directory, entry.name)]
      : [];
  });
}

const failures = [];
for (const file of markdownFiles(root)) {
  const source = readFileSync(file, "utf8");
  const links = source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z\d+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }

    const pathOnly = decodeURIComponent(rawTarget.split("#", 1)[0]);
    const target = resolve(dirname(file), pathOnly);
    if (!existsSync(target) || (!statSync(target).isFile() && !statSync(target).isDirectory())) {
      failures.push(`${file.slice(root.length + 1)} -> ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Broken local Markdown links:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Local Markdown links resolve.\n");
}
