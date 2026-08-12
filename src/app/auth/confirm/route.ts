import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink"]);

function getSafeNextPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n\0]/.test(value)
  ) {
    return "/";
  }

  return value;
}

function getOtpType(value: string | null): EmailOtpType | null {
  if (!value || !ALLOWED_OTP_TYPES.has(value as EmailOtpType)) {
    return null;
  }

  return value as EmailOtpType;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = getOtpType(request.nextUrl.searchParams.get("type"));
  const next = getSafeNextPath(request.nextUrl.searchParams.get("next"));

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL("/auth/error?reason=expired_link", request.url),
        303,
      );
    }

    return NextResponse.redirect(new URL(next, request.url), 303);
  }

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL("/auth/error?reason=invalid_link", request.url),
      303,
    );
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return NextResponse.redirect(
      new URL("/auth/error?reason=expired_link", request.url),
      303,
    );
  }

  return NextResponse.redirect(new URL(next, request.url), 303);
}
