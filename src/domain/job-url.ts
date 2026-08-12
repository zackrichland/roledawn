export type JobUrlResult =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: "JOB_URL_INVALID"; message: string }>;
    }>;

export function normalizePublicJobUrl(rawValue: string): JobUrlResult {
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    return {
      ok: false,
      error: {
        code: "JOB_URL_INVALID",
        message: "Paste a complete HTTPS job posting URL.",
      },
    };
  }

  const hostname = url.hostname.toLocaleLowerCase();
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  const isIpv6 = hostname.includes(":");
  if (
    url.protocol !== "https:" ||
    !hostname ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isIpv4 ||
    isIpv6
  ) {
    return {
      ok: false,
      error: {
        code: "JOB_URL_INVALID",
        message: "Use a public HTTPS job posting URL without embedded credentials.",
      },
    };
  }

  url.hash = "";
  return { ok: true, value: url.toString() };
}
