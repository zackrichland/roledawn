import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationWritingPolicy } from "./application-writing-policy-loader.ts";

test("owned policies are profession neutral, immutable in a run, and content hashed", async () => {
  const policy = await loadApplicationWritingPolicy();
  assert.doesNotMatch(policy.instructions, /Zack|Richland|\bFDE\b|Forward Deployed|\bAWS\b|Human Touch/u);
  assert.match(policy.instructions, /education, service, projects/u);
  assert.equal(policy.provenance.documents.length, 5);
  assert.match(policy.provenance.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(policy.provenance.documents));
});

test("editing a policy changes the next generation digest without changing other policy documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roledawn-writing-"));
  try {
    await cp("policies/application-writing", directory, { recursive: true });
    const before = await loadApplicationWritingPolicy(directory);
    const path = join(directory, "voice.md");
    await writeFile(path, `${await readFile(path, "utf8")}\nKeep the closing direct.\n`);
    const after = await loadApplicationWritingPolicy(directory);
    assert.notEqual(before.provenance.sha256, after.provenance.sha256);
    assert.notEqual(before.instructions, after.instructions);
    assert.deepEqual(before.provenance.documents.filter(item => item.name !== "voice.md"), after.provenance.documents.filter(item => item.name !== "voice.md"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("oversized, malformed, and escaping policy files fail closed with a fixed error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roledawn-writing-invalid-"));
  try {
    await cp("policies/application-writing", directory, { recursive: true });
    await writeFile(join(directory, "voice.md"), "x".repeat(32769));
    await assert.rejects(loadApplicationWritingPolicy(directory), { message: "APPLICATION_WRITING_POLICY_LOAD_FAILED" });
    await rm(join(directory, "voice.md"));
    await symlink(join(process.cwd(), "README.md"), join(directory, "voice.md"));
    await assert.rejects(loadApplicationWritingPolicy(directory), { message: "APPLICATION_WRITING_POLICY_LOAD_FAILED" });
    await writeFile(join(directory, "manifest.json"), '{"documents":["../../private"]}');
    await assert.rejects(loadApplicationWritingPolicy(directory), { message: "APPLICATION_WRITING_POLICY_LOAD_FAILED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
