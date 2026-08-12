export type LocalTestLoginEnvironment = Readonly<{
  nodeEnv: string | undefined;
  enabled: string | undefined;
  appBaseUrl: string | undefined;
  testUserEmail: string | undefined;
  secretKey: string | undefined;
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
}>;

export type LocalTestLoginRequest = Readonly<{
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
}>;

export type LocalTestLoginDecision =
  | Readonly<{ allowed: true; email: string }>
  | Readonly<{ allowed: false }>;

const TEST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.invalid$/i;

function isLoopbackHostname(value: string): boolean {
  return value === "127.0.0.1" || value === "localhost";
}

function isLoopbackHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      isLoopbackHostname(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(value: string | null): boolean {
  if (!value) return false;

  try {
    return isLoopbackHostname(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

/**
 * Authorizes bypassing email delivery—not Supabase Auth. Every successful path
 * still creates a normal Supabase session and exercises auth.uid(), RLS, and
 * tenant bootstrap. The production and non-loopback paths fail closed.
 */
export function evaluateLocalTestLogin(
  environment: LocalTestLoginEnvironment,
  request: LocalTestLoginRequest,
): LocalTestLoginDecision {
  const email = environment.testUserEmail?.trim().toLowerCase() ?? "";
  const forwardedHostIsSafe = request.forwardedHost
    ? isLoopbackHost(request.forwardedHost)
    : true;
  const forwardedProtoIsSafe = request.forwardedProto
    ? request.forwardedProto === "http"
    : true;

  if (
    environment.nodeEnv !== "development" ||
    environment.enabled !== "true" ||
    !isLoopbackHttpUrl(environment.appBaseUrl) ||
    !TEST_EMAIL_PATTERN.test(email) ||
    !environment.secretKey?.trim() ||
    !environment.supabaseUrl?.trim() ||
    !environment.supabasePublishableKey?.trim() ||
    !isLoopbackHttpUrl(request.origin) ||
    !isLoopbackHost(request.host) ||
    !forwardedHostIsSafe ||
    !forwardedProtoIsSafe
  ) {
    return { allowed: false };
  }

  return { allowed: true, email };
}
