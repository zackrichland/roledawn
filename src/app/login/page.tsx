import { LoginForm } from "@/app/login/LoginForm";
import { redirect } from "next/navigation";
import { getSingleAccountEntryPath, readSingleAccountConfig } from "@/server/auth/single-account-policy";
import { getSafeAuthNextPath } from "@/server/auth/auth-redirect-policy";
import { isHostedGoogleProviderEnabled } from "@/server/auth/google-oauth";
import { readLocalTestLoginDecision } from "@/server/auth/local-test-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = getSafeAuthNextPath(
    Array.isArray(next) ? next[0] : next,
  );
  if (readSingleAccountConfig()) redirect(getSingleAccountEntryPath(nextPath));
  const decision = await readLocalTestLoginDecision({
    allowMissingOriginForDisplay: true,
  });
  const googleSignInAvailable = await isHostedGoogleProviderEnabled();
  return (
    <LoginForm
      googleSignInAvailable={googleSignInAvailable}
      localTestLoginAvailable={decision.allowed}
      nextPath={nextPath}
    />
  );
}
