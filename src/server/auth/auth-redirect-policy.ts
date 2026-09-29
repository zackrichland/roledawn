const DEFAULT_AUTH_DESTINATION = "/dashboard";

/** Use the configured public origin, not a reverse proxy's internal deploy URL. */
export function getAuthRedirectOrigin(requestUrl: string, environment: { NODE_ENV?: string; APP_BASE_URL?: string }): string {
  const configured = environment.APP_BASE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.username || url.password || (url.protocol !== "https:" && !(environment.NODE_ENV !== "production" && url.protocol === "http:"))) {
      throw new Error("AUTH_REDIRECT_ORIGIN_INVALID");
    }
    return url.origin;
  }
  if (environment.NODE_ENV === "production") throw new Error("AUTH_REDIRECT_ORIGIN_REQUIRED");
  return new URL(requestUrl).origin;
}

/**
 * Keep post-auth navigation inside this application. The value is always
 * treated as untrusted because it may come from a query string or form field.
 */
export function getSafeAuthNextPath(
  value: unknown,
  fallback = DEFAULT_AUTH_DESTINATION,
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return fallback;
  }

  try {
    const resolved = new URL(value, "https://roledawn.invalid");

    if (resolved.origin !== "https://roledawn.invalid") {
      return fallback;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
