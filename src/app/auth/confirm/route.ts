import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthRedirectOrigin, getSafeAuthNextPath } from "@/server/auth/auth-redirect-policy";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { getSingleAccountEntryPath, readSingleAccountConfig } from "@/server/auth/single-account-policy";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink"]);

function getOtpType(value: string | null): EmailOtpType | null {
  if (!value || !ALLOWED_OTP_TYPES.has(value as EmailOtpType)) {
    return null;
  }

  return value as EmailOtpType;
}

function displayNameFromMetadata(metadata: Record<string, unknown> | undefined): string {
  for (const key of ["display_name", "full_name", "name"] as const) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function finishAuthentication(
  request: NextRequest,
  next: string,
  actor: AuthenticatedActor | null,
  metadata: Record<string, unknown> | undefined,
) {
  if (!actor) {
    return NextResponse.redirect(
      getAuthErrorUrl(request, "invalid_session", next),
      303,
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    await bootstrapPersonalWorkspace(
      supabase,
      actor,
      displayNameFromMetadata(metadata),
    );
  } catch {
    return NextResponse.redirect(
      getAuthErrorUrl(request, "setup_failed", next),
      303,
    );
  }

  return NextResponse.redirect(new URL(next, getAuthRedirectOrigin(request.url, process.env)), 303);
}

function getAuthErrorUrl(
  request: NextRequest,
  reason: string,
  next: string,
): URL {
  const errorUrl = new URL("/auth/error", getAuthRedirectOrigin(request.url, process.env));
  errorUrl.searchParams.set("reason", reason);
  errorUrl.searchParams.set("next", next);
  return errorUrl;
}

export async function GET(request: NextRequest) {
  if (readSingleAccountConfig()) {
    const url = new URL(getSingleAccountEntryPath(request.nextUrl.searchParams.get("next")), getAuthRedirectOrigin(request.url, process.env));
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = getOtpType(request.nextUrl.searchParams.get("type"));
  const next = getSafeAuthNextPath(request.nextUrl.searchParams.get("next"));

  if (
    request.nextUrl.searchParams.has("error") ||
    request.nextUrl.searchParams.has("error_code")
  ) {
    return NextResponse.redirect(
      getAuthErrorUrl(request, "oauth_failed", next),
      303,
    );
  }

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.user) {
      return NextResponse.redirect(
        getAuthErrorUrl(request, "expired_link", next),
        303,
      );
    }

    return finishAuthentication(
      request,
      next,
      { userId: data.user.id, email: data.user.email ?? null },
      data.user.user_metadata,
    );
  }

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      getAuthErrorUrl(request, "invalid_link", next),
      303,
    );
  }

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error || !data.user) {
    return NextResponse.redirect(
      getAuthErrorUrl(request, "expired_link", next),
      303,
    );
  }

  return finishAuthentication(
    request,
    next,
    { userId: data.user.id, email: data.user.email ?? null },
    data.user.user_metadata,
  );
}
