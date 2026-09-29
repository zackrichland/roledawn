import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ApplicationWritingPolicyBundle } from "../../domain/application-writing-policy.ts";

const DOCUMENTS = ["evidence.md", "resume.md", "cover-letter.md", "voice.md", "quality.md"] as const;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Read once per draft, so editing owned policy files affects the next generation. */
export async function loadApplicationWritingPolicy(directory = resolve(process.cwd(), "policies/application-writing")): Promise<ApplicationWritingPolicyBundle> {
  try {
    const root = await realpath(directory);
    async function read(name: string): Promise<string> {
      const path = await realpath(resolve(root, name));
      if (!path.startsWith(`${root}${sep}`)) throw new Error();
      const text = await readFile(path, "utf8");
      if (!text.trim() || Buffer.byteLength(text) > 32_768 || text.includes("\u0000")) throw new Error();
      return text;
    }
    const manifest = JSON.parse(await read("manifest.json")) as Record<string, unknown>;
    if (manifest.schemaVersion !== 1 || typeof manifest.release !== "string"
      || !/^[A-Za-z][A-Za-z0-9._/-]{1,119}$/u.test(manifest.release)
      || Object.keys(manifest).some(key => !["schemaVersion", "release", "documents"].includes(key))
      || JSON.stringify(manifest.documents) !== JSON.stringify(DOCUMENTS)) throw new Error();
    const texts = await Promise.all(DOCUMENTS.map(read));
    const instructions = texts.map((text, index) => `Owned writing policy: ${DOCUMENTS[index]}\n${text.trim()}`).join("\n\n");
    if (Buffer.byteLength(instructions) > 65_536) throw new Error();
    const documents = Object.freeze(DOCUMENTS.map((name, index) => Object.freeze({ name, sha256: digest(texts[index]) })));
    return Object.freeze({
      instructions,
      provenance: Object.freeze({ release: manifest.release, documents, sha256: digest(JSON.stringify({ release: manifest.release, documents })) }),
    });
  } catch { throw new Error("APPLICATION_WRITING_POLICY_LOAD_FAILED"); }
}
