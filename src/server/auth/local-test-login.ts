import "server-only";

import { headers } from "next/headers";

import {
  evaluateLocalTestLogin,
  type LocalTestLoginDecision,
} from "./local-test-login-policy.ts";

export async function readLocalTestLoginDecision(
  options: Readonly<{ allowMissingOriginForDisplay?: boolean }> = {},
): Promise<LocalTestLoginDecision> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const origin = requestHeaders.get("origin") ??
    (options.allowMissingOriginForDisplay && host
      ? `${forwardedProto ?? "http"}://${host}`
      : null);

  return evaluateLocalTestLogin(
    {
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.ENABLE_LOCAL_TEST_LOGIN,
      appBaseUrl: process.env.APP_BASE_URL,
      testUserEmail: process.env.LOCAL_TEST_USER_EMAIL,
      secretKey: process.env.SUPABASE_SECRET_KEY,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabasePublishableKey:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    {
      origin,
      host,
      forwardedHost: requestHeaders.get("x-forwarded-host"),
      forwardedProto: requestHeaders.get("x-forwarded-proto"),
    },
  );
}
