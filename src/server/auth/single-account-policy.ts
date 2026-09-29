import { getSafeAuthNextPath } from "./auth-redirect-policy.ts";

type Environment = Readonly<{
  [key: string]: string | undefined;
  ROLEDAWN_SINGLE_ACCOUNT_MODE?: string;
  ROLEDAWN_TEST_ACCOUNT_ID?: string;
}>;

/** Temporary shared test access. The account is chosen only by server config. */
export function readSingleAccountConfig(environment: Environment = process.env): Readonly<{ userId: string }> | null {
  if (environment.ROLEDAWN_SINGLE_ACCOUNT_MODE !== "true") return null;
  const userId = environment.ROLEDAWN_TEST_ACCOUNT_ID?.trim();
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(userId)) {
    throw new Error("SINGLE_ACCOUNT_ID_REQUIRED");
  }
  return Object.freeze({ userId: userId.toLowerCase() });
}

export function singleAccountAcceptsUser(userId: string, environment: Environment = process.env): boolean {
  const config = readSingleAccountConfig(environment);
  return !config || userId === config.userId;
}

export function getSingleAccountNextPath(value: unknown): string {
  const next = getSafeAuthNextPath(value);
  const pathname = new URL(next, "https://roledawn.invalid").pathname;
  return /^\/(?:dashboard|vault|applications|search|saved|onboarding)(?:\/|$)/u.test(pathname) ? next : "/dashboard";
}

export function getSingleAccountEntryPath(next?: unknown): string {
  return `/auth/test-session?next=${encodeURIComponent(getSingleAccountNextPath(next))}`;
}
