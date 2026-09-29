/**
 * Read-only Gmail access for employer verification codes (D-106). RoleDawn
 * asks only for `gmail.readonly`, searches only Greenhouse's verification
 * emails while a send is waiting, and returns a code only when exactly one
 * unambiguous code is present. Email content is untrusted data: it is parsed
 * with fixed patterns and never shown to a model.
 */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_MAILBOX_CALLBACK_PATH = "/api/mailbox/google/callback";

type Fetch = typeof fetch;
type Environment = Readonly<Record<string, string | undefined>>;
export type GoogleMailboxConfig = Readonly<{ clientId: string; clientSecret: string; redirectUri: string }>;
export type MailboxCodeQuery = Readonly<{ since: number; employerHint?: string | null; exclude?: ReadonlySet<string>; signal?: AbortSignal }>;
export type MailboxCodeReader = Readonly<{ findCode(query: MailboxCodeQuery): Promise<string | null> }>;

export function readGoogleMailboxConfig(environment: Environment = process.env): GoogleMailboxConfig | null {
  const clientId = environment.GOOGLE_MAILBOX_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_MAILBOX_CLIENT_SECRET?.trim();
  const base = environment.APP_BASE_URL?.trim();
  if (!clientId || !clientSecret || !base) return null;
  return Object.freeze({ clientId, clientSecret, redirectUri: new URL(GOOGLE_MAILBOX_CALLBACK_PATH, base).href });
}

export function googleMailboxAuthorizationUrl(config: GoogleMailboxConfig, input: Readonly<{ state: string; loginHint?: string | null }>): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  // Offline access with a fresh consent returns the refresh token the worker needs.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.href;
}

function signalFor(signal?: AbortSignal, ms = 10_000): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}
async function tokenRequest(body: Record<string, string>, fetchImpl: Fetch, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: signalFor(signal),
    });
  } catch { throw new Error("MAILBOX_PROVIDER_UNAVAILABLE"); }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(data.error === "invalid_grant" ? "MAILBOX_TOKEN_REVOKED" : "MAILBOX_PROVIDER_REJECTED");
  return data;
}

export async function exchangeGoogleMailboxCode(config: GoogleMailboxConfig, code: string, fetchImpl: Fetch = fetch): Promise<Readonly<{ refreshToken: string; accessToken: string; scopes: readonly string[] }>> {
  const data = await tokenRequest({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" }, fetchImpl);
  const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/u).filter(Boolean) : [];
  if (typeof data.refresh_token !== "string" || typeof data.access_token !== "string") throw new Error("MAILBOX_REFRESH_TOKEN_MISSING");
  if (!scopes.includes(GMAIL_READONLY_SCOPE)) throw new Error("MAILBOX_SCOPE_MISSING");
  return Object.freeze({ refreshToken: data.refresh_token, accessToken: data.access_token, scopes: Object.freeze(scopes) });
}

export async function refreshGoogleMailboxAccess(config: GoogleMailboxConfig, refreshToken: string, fetchImpl: Fetch = fetch, signal?: AbortSignal): Promise<Readonly<{ token: string; expiresAt: number }>> {
  const data = await tokenRequest({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" }, fetchImpl, signal);
  if (typeof data.access_token !== "string") throw new Error("MAILBOX_PROVIDER_REJECTED");
  const seconds = typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 3_000;
  return Object.freeze({ token: data.access_token, expiresAt: Date.now() + seconds * 1_000 });
}

async function gmailGet(accessToken: string, path: string, fetchImpl: Fetch, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: signalFor(signal) });
  } catch { throw new Error("MAILBOX_PROVIDER_UNAVAILABLE"); }
  if (response.status === 401) throw new Error("MAILBOX_ACCESS_EXPIRED");
  if (response.status === 403) {
    // Gmail also answers 403 for rate limits. Only a missing permission turns the mailbox off.
    const body = await response.text().catch(() => "");
    throw new Error(/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/u.test(body) ? "MAILBOX_SCOPE_MISSING" : "MAILBOX_PROVIDER_BUSY");
  }
  if (!response.ok) throw new Error("MAILBOX_PROVIDER_REJECTED");
  return await response.json() as Record<string, unknown>;
}

export async function googleMailboxAddress(accessToken: string, fetchImpl: Fetch = fetch): Promise<string> {
  const profile = await gmailGet(accessToken, "profile", fetchImpl);
  if (typeof profile.emailAddress !== "string" || !profile.emailAddress.includes("@")) throw new Error("MAILBOX_PROVIDER_REJECTED");
  return profile.emailAddress.toLowerCase();
}

export async function revokeGoogleMailboxToken(token: string, fetchImpl: Fetch = fetch): Promise<void> {
  await fetchImpl("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

export function mailboxHtmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|tr|li|td|th|table|h[1-6])\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">").replace(/&quot;/giu, "\"").replace(/&#0*39;|&apos;/giu, "'")
    .replace(/&#(\d{1,6});/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/giu, "&")
    .replace(/[ \t ]+/gu, " ")
    .replace(/ *\n */gu, "\n");
}

const SUBJECT = /^\s*security code for your application to\s+(.+?)\s*$/iu;
const LABELLED_CODE = /(?:security|verification)\s+code[^:\n]{0,60}:\s*([A-Za-z0-9]{8})(?![A-Za-z0-9])/giu;
const BARE_CODE = /^[A-Za-z0-9]{8}$/u;

function senderDomain(from: string): string | null {
  const address = /<\s*([^<>\s]+@[^<>\s]+)\s*>/u.exec(from)?.[1] ?? (/^\s*([^<>\s]+@[^<>\s]+)\s*$/u.exec(from)?.[1] ?? null);
  return address ? address.slice(address.lastIndexOf("@") + 1).toLowerCase() : null;
}
function fromGreenhouse(from: string): boolean {
  const domain = senderDomain(from);
  return Boolean(domain && ["greenhouse-mail.io", "greenhouse.io"].some((root) => domain === root || domain.endsWith(`.${root}`)));
}

/**
 * Greenhouse's application code email: sender on a Greenhouse mail domain,
 * subject "Security code for your application to <Company>", and the code
 * after "…security code field on your application:" (or alone on a line).
 * Anything ambiguous returns null and the candidate is asked instead.
 */
export function extractGreenhouseSecurityCode(message: Readonly<{ from: string; subject: string; text: string }>): string | null {
  if (!fromGreenhouse(message.from) || !SUBJECT.test(message.subject)) return null;
  const labelled = [...new Set([...message.text.matchAll(LABELLED_CODE)].map((match) => match[1]))];
  if (labelled.length) return labelled.length === 1 ? labelled[0] : null;
  // A bare line: an ordinary 8-letter word ("Security") is never a code.
  const bare = [...new Set(message.text.split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => BARE_CODE.test(line) && (/\d/u.test(line) || line === line.toUpperCase())))];
  return bare.length === 1 ? bare[0] : null;
}

export function greenhouseCodeEmployer(subject: string): string | null {
  return SUBJECT.exec(subject)?.[1] ?? null;
}

type GmailPart = Readonly<{ mimeType?: string; body?: Readonly<{ data?: string }>; parts?: readonly GmailPart[]; headers?: readonly Readonly<{ name: string; value: string }>[] }>;
export type GmailMessage = Readonly<{ id?: string; internalDate?: string; payload?: GmailPart }>;

export function readGmailMessage(message: GmailMessage): Readonly<{ from: string; subject: string; text: string; receivedAt: number }> {
  const plain: string[] = []; const html: string[] = [];
  const visit = (part: GmailPart | undefined, depth: number) => {
    if (!part || depth > 8) return;
    const data = part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
    if (part.mimeType === "text/plain" && data) plain.push(data);
    if (part.mimeType === "text/html" && data) html.push(data);
    for (const child of part.parts ?? []) visit(child, depth + 1);
  };
  visit(message.payload, 0);
  const header = (name: string) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
  const text = [plain.join("\n"), html.length ? mailboxHtmlToText(html.join("\n")) : ""].filter(Boolean).join("\n");
  return Object.freeze({ from: header("from"), subject: header("subject"), text, receivedAt: Number(message.internalDate ?? 0) });
}

const normalizeEmployer = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gu, "");
/**
 * The subject names the company ("Motive Technologies"); the hint is the job
 * board's token ("gomotive"). They match when either contains the other, or
 * the company's first distinctive word appears in the token.
 */
export function employerMatches(subjectEmployer: string | null, hint: string | null | undefined): boolean {
  if (!subjectEmployer || !hint) return false;
  const company = normalizeEmployer(subjectEmployer); const token = normalizeEmployer(hint);
  if (!company || !token) return false;
  if (company === token || company.includes(token) || token.includes(company)) return true;
  const first = normalizeEmployer(subjectEmployer.trim().split(/\s+/u)[0] ?? "");
  return first.length >= 4 && token.includes(first);
}

/** Newest matching code received after `since`; the employer named in the subject is preferred. */
export async function findGreenhouseSecurityCode(input: MailboxCodeQuery & Readonly<{ accessToken: string; fetch?: Fetch }>): Promise<string | null> {
  const fetchImpl = input.fetch ?? fetch;
  const query = encodeURIComponent("from:(greenhouse-mail.io OR greenhouse.io) subject:\"security code\" newer_than:1d");
  const list = await gmailGet(input.accessToken, `messages?q=${query}&maxResults=10`, fetchImpl, input.signal);
  const ids = Array.isArray(list.messages) ? list.messages.map((item) => (item as { id?: unknown }).id).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9]{1,64}$/u.test(id)) : [];
  const found: { code: string; receivedAt: number; matches: boolean }[] = [];
  for (const id of ids.slice(0, 10)) {
    const message = readGmailMessage(await gmailGet(input.accessToken, `messages/${id}?format=full`, fetchImpl, input.signal) as GmailMessage);
    if (!Number.isFinite(message.receivedAt) || message.receivedAt < input.since) continue;
    const code = extractGreenhouseSecurityCode(message);
    if (!code || input.exclude?.has(code)) continue;
    found.push({ code, receivedAt: message.receivedAt, matches: employerMatches(greenhouseCodeEmployer(message.subject), input.employerHint) });
  }
  // With a known employer, only its own emails count, so two overlapping sends
  // can never swap codes; an unmatched email is left for the candidate.
  const pool = input.employerHint ? found.filter((item) => item.matches) : found;
  return pool.sort((left, right) => right.receivedAt - left.receivedAt)[0]?.code ?? null;
}

/** One connected mailbox for one delivery run; the access token is reused while valid. */
export function createGoogleMailboxReader(input: Readonly<{ config: GoogleMailboxConfig; refreshToken: string; fetch?: Fetch }>): MailboxCodeReader {
  const fetchImpl = input.fetch ?? fetch;
  let access: Readonly<{ token: string; expiresAt: number }> | null = null;
  return Object.freeze({
    async findCode(query: MailboxCodeQuery) {
      if (!access || access.expiresAt < Date.now() + 60_000) access = await refreshGoogleMailboxAccess(input.config, input.refreshToken, fetchImpl, query.signal);
      try { return await findGreenhouseSecurityCode({ ...query, accessToken: access.token, fetch: fetchImpl }); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "MAILBOX_ACCESS_EXPIRED") throw error;
        access = await refreshGoogleMailboxAccess(input.config, input.refreshToken, fetchImpl, query.signal);
        return findGreenhouseSecurityCode({ ...query, accessToken: access.token, fetch: fetchImpl });
      }
    },
  });
}
