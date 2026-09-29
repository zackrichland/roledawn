import { createHash, timingSafeEqual } from "node:crypto";

type Environment = Readonly<{ [key: string]: string | undefined; ROLEDAWN_TEST_ACCESS_KEY?: string }>;

/**
 * The shared test workspace opens a new session only for a visitor holding its
 * private access key. An unset or short key keeps new sessions closed; a
 * visitor who is already signed in is unaffected.
 */
export function singleAccountAccessKeyMatches(provided: unknown, environment: Environment = process.env): boolean {
  const expected = environment.ROLEDAWN_TEST_ACCESS_KEY?.trim() ?? "";
  if (expected.length < 32 || typeof provided !== "string" || provided.length === 0 || provided.length > 256) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
