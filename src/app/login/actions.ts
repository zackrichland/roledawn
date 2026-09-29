"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeAuthNextPath } from "@/server/auth/auth-redirect-policy";
import { isHostedGoogleProviderEnabled } from "@/server/auth/google-oauth";
import { readLocalTestLoginDecision } from "@/server/auth/local-test-login";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { getSingleAccountEntryPath, readSingleAccountConfig } from "@/server/auth/single-account-policy";

export type MagicLinkActionState = Readonly<{
  status: "idle" | "sent" | "error";
  message: string;
}>;

export type LocalTestLoginActionState = Readonly<{
  status: "idle" | "error";
  message: string;
}>;

export type GoogleOAuthActionState = Readonly<{
  status: "idle" | "error";
  message: string;
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (
    email.length === 0 ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email)
  ) {
    return null;
  }

  return email;
}

function parseAppBaseUrl(value: string | null | undefined): URL | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      return null;
    }

    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function getAppBaseUrl(): Promise<URL | null> {
  const configured = parseAppBaseUrl(process.env.APP_BASE_URL?.trim());

  if (configured || process.env.NODE_ENV === "production") {
    return configured;
  }

  const origin = (await headers()).get("origin");
  const localOrigin = parseAppBaseUrl(origin);

  if (
    localOrigin &&
    (localOrigin.hostname === "127.0.0.1" ||
      localOrigin.hostname === "localhost")
  ) {
    return localOrigin;
  }

  return new URL("http://127.0.0.1:3001");
}

export async function requestMagicLink(
  _previousState: MagicLinkActionState,
  formData: FormData,
): Promise<MagicLinkActionState> {
  if (readSingleAccountConfig()) redirect(getSingleAccountEntryPath(formData.get("next")));
  const email = normalizeEmail(formData.get("email"));

  if (!email) {
    return {
      status: "error",
      message: "Enter a valid email address.",
    };
  }

  const appBaseUrl = await getAppBaseUrl();

  if (!appBaseUrl) {
    return {
      status: "error",
      message: "Sign-in is not configured yet. Try again shortly.",
    };
  }

  const callbackUrl = new URL("/auth/confirm", appBaseUrl);
  callbackUrl.searchParams.set(
    "next",
    getSafeAuthNextPath(formData.get("next")),
  );

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    return {
      status: "error",
      message: "We could not send a sign-in link. Please try again.",
    };
  }

  return {
    status: "sent",
    message: "Check your email for a one-time sign-in link.",
  };
}

export async function signInWithGoogle(
  _previousState: GoogleOAuthActionState,
  formData: FormData,
): Promise<GoogleOAuthActionState> {
  if (readSingleAccountConfig()) redirect(getSingleAccountEntryPath(formData.get("next")));
  const appBaseUrl = await getAppBaseUrl();

  if (!appBaseUrl) {
    return {
      status: "error",
      message: "Google sign-in is not configured yet. Use the email sign-in link instead.",
    };
  }

  if (!(await isHostedGoogleProviderEnabled())) {
    return {
      status: "error",
      message: "Google sign-in is not available for this project yet. Use the email sign-in link instead.",
    };
  }

  const callbackUrl = new URL("/auth/confirm", appBaseUrl);
  callbackUrl.searchParams.set(
    "next",
    getSafeAuthNextPath(formData.get("next")),
  );

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });

  if (error || !data.url) {
    return {
      status: "error",
      message: "Google sign-in is not available for this project yet. Use the email sign-in link instead.",
    };
  }

  redirect(data.url);
}

/**
 * Development-only shortcut around email delivery. It still establishes a
 * normal Supabase session and enters the same auth.uid()/RLS path as magic-link
 * sign-in. No actor ID or email is accepted from the browser.
 */
export async function signInAsLocalTestUser(
  previousState: LocalTestLoginActionState,
  formData: FormData,
): Promise<LocalTestLoginActionState> {
  if (readSingleAccountConfig()) redirect(getSingleAccountEntryPath(formData.get("next")));
  void previousState;
  const decision = await readLocalTestLoginDecision();
  if (!decision.allowed) {
    return {
      status: "error",
      message: "The database test candidate is not available in this environment.",
    };
  }

  try {
    const displayName = process.env.LOCAL_TEST_USER_DISPLAY_NAME?.trim()
      .replace(/\s+/gu, " ")
      .slice(0, 120) || "RoleDawn Test Candidate";
    const admin = createSupabaseAdminClient("local-test-login/0.1");
    const generated = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: decision.email,
      options: {
        data: { display_name: displayName },
      },
    });
    const tokenHash = generated.data.properties?.hashed_token;
    if (generated.error || !tokenHash) {
      throw new Error("LOCAL_TEST_LINK_GENERATION_FAILED");
    }

    const supabase = await createSupabaseServerClient();
    const verified = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });
    const userId = verified.data.user?.id;
    if (verified.error || !userId) {
      throw new Error("LOCAL_TEST_SESSION_FAILED");
    }

    await bootstrapPersonalWorkspace(
      supabase,
      { userId, email: verified.data.user?.email ?? decision.email },
      displayName,
    );
  } catch {
    return {
      status: "error",
      message: "The database test candidate could not sign in. Check the local server configuration.",
    };
  }

  redirect(getSafeAuthNextPath(formData.get("next")));
}
