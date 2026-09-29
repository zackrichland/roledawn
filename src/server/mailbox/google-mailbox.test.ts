import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  createGoogleMailboxReader, employerMatches, extractGreenhouseSecurityCode, findGreenhouseSecurityCode, googleMailboxAuthorizationUrl,
  GMAIL_READONLY_SCOPE, mailboxHtmlToText, readGoogleMailboxConfig, readGmailMessage, type GmailMessage,
} from "./google-mailbox.ts";
import { openMailboxToken, readMailboxTokenKey, sealMailboxToken } from "./token-crypto.ts";

const FROM = "Greenhouse <no-reply@us.greenhouse-mail.io>";
const SUBJECT = "Security code for your application to Carvana";
const BODY = "Hi Zack,\n\nCopy and paste this code into the security code field on your application: X7kP2mQa\n\nThanks,\nGreenhouse";

test("mailbox tokens seal per candidate and never open for another", () => {
  const key = randomBytes(32);
  const sealed = sealMailboxToken("1//refresh-token", key, "candidate-a");
  assert.match(sealed, /^v1\./u);
  assert.equal(openMailboxToken(sealed, key, "candidate-a"), "1//refresh-token");
  assert.throws(() => openMailboxToken(sealed, key, "candidate-b"), /UNREADABLE/u);
  assert.throws(() => openMailboxToken(sealed, randomBytes(32), "candidate-a"), /UNREADABLE/u);
  assert.equal(readMailboxTokenKey({}), null);
  assert.throws(() => readMailboxTokenKey({ ROLEDAWN_MAILBOX_TOKEN_KEY: "c2hvcnQ=" }), /KEY_INVALID/u);
  assert.equal(readMailboxTokenKey({ ROLEDAWN_MAILBOX_TOKEN_KEY: key.toString("base64") })?.equals(key), true);
});

test("only Greenhouse's verification email yields a code, and only an unambiguous one", () => {
  assert.equal(extractGreenhouseSecurityCode({ from: FROM, subject: SUBJECT, text: BODY }), "X7kP2mQa");
  assert.equal(extractGreenhouseSecurityCode({ from: "no-reply@greenhouse-mail.io", subject: SUBJECT, text: "Your code:\nAB12CD34\n" }), "AB12CD34");
  // Wrong sender, wrong subject, look-alike domain.
  assert.equal(extractGreenhouseSecurityCode({ from: "attacker@example.com", subject: SUBJECT, text: BODY }), null);
  assert.equal(extractGreenhouseSecurityCode({ from: "x <no-reply@greenhouse-mail.io.evil.test>", subject: SUBJECT, text: BODY }), null);
  assert.equal(extractGreenhouseSecurityCode({ from: FROM, subject: "Your application was received", text: BODY }), null);
  // Ordinary words are not codes; two different codes are ambiguous.
  assert.equal(extractGreenhouseSecurityCode({ from: FROM, subject: SUBJECT, text: "Security\nGreenhouse\n" }), null);
  assert.equal(extractGreenhouseSecurityCode({ from: FROM, subject: SUBJECT, text: `${BODY}\nsecurity code field on your application: ZZZZ9999` }), null);
});

test("HTML-only emails are read as text", () => {
  const html = "<html><head><style>p{}</style></head><body><p>Copy and paste this code into the security code field on your application:&nbsp;<strong>Q9W8E7R6</strong></p></body></html>";
  assert.match(mailboxHtmlToText(html), /application: Q9W8E7R6/u);
  const message: GmailMessage = { internalDate: "1000", payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: FROM }, { name: "Subject", value: SUBJECT }],
    parts: [{ mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } }] } };
  const read = readGmailMessage(message);
  assert.equal(extractGreenhouseSecurityCode(read), "Q9W8E7R6");
  assert.equal(read.receivedAt, 1000);
});

function gmail(messages: Readonly<Record<string, { subject: string; text: string; at: number; from?: string }>>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "access-1", expires_in: 3600 });
    if (url.includes("/messages?")) return Response.json({ messages: Object.keys(messages).map((id) => ({ id })) });
    const id = url.split("/messages/")[1]?.split("?")[0] ?? "";
    const item = messages[id];
    return Response.json({ id, internalDate: String(item.at), payload: { mimeType: "text/plain", headers: [{ name: "From", value: item.from ?? FROM }, { name: "Subject", value: item.subject }],
      body: { data: Buffer.from(item.text).toString("base64url") } } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("the newest code for this employer since the request wins; stale or used codes are ignored", async () => {
  const { fetchImpl } = gmail({
    a1: { subject: SUBJECT, text: BODY.replace("X7kP2mQa", "OLD11111"), at: 1_000 },
    a2: { subject: "Security code for your application to GitLab", text: BODY.replace("X7kP2mQa", "GITLAB22"), at: 5_000 },
    a3: { subject: SUBJECT, text: BODY, at: 6_000 },
  });
  assert.equal(await findGreenhouseSecurityCode({ accessToken: "t", since: 2_000, employerHint: "carvana", fetch: fetchImpl }), "X7kP2mQa");
  assert.equal(await findGreenhouseSecurityCode({ accessToken: "t", since: 2_000, employerHint: "carvana", exclude: new Set(["X7kP2mQa"]), fetch: fetchImpl }), null);
  // Another employer's code is never used for this send.
  assert.equal(await findGreenhouseSecurityCode({ accessToken: "t", since: 2_000, employerHint: "someoneelse", fetch: fetchImpl }), null);
  // Board tokens that differ from the company name still match.
  const other = gmail({ b1: { subject: "Security code for your application to Motive Technologies", text: BODY, at: 9_000 } });
  assert.equal(await findGreenhouseSecurityCode({ accessToken: "t", since: 2_000, employerHint: "gomotive", fetch: other.fetchImpl }), "X7kP2mQa");
});

test("employer names match their job board tokens without cross-matching", () => {
  assert.equal(employerMatches("Carvana", "carvana"), true);
  assert.equal(employerMatches("DoorDash", "doordashusa"), true);
  assert.equal(employerMatches("Motive Technologies", "gomotive"), true);
  assert.equal(employerMatches("A24", "a24"), true);
  assert.equal(employerMatches("GitLab", "carvana"), false);
  assert.equal(employerMatches("The Trade Desk", "carvana"), false);
  assert.equal(employerMatches("Carvana", null), false);
});

test("the reader refreshes access once and asks only for read-only Gmail", async () => {
  const { fetchImpl, calls } = gmail({ c1: { subject: SUBJECT, text: BODY, at: 9_000 } });
  const config = readGoogleMailboxConfig({ GOOGLE_MAILBOX_CLIENT_ID: "client", GOOGLE_MAILBOX_CLIENT_SECRET: "secret", APP_BASE_URL: "https://roledawn.example" })!;
  const reader = createGoogleMailboxReader({ config, refreshToken: "refresh", fetch: fetchImpl });
  assert.equal(await reader.findCode({ since: 0, employerHint: "carvana" }), "X7kP2mQa");
  assert.equal(await reader.findCode({ since: 0, employerHint: "carvana" }), "X7kP2mQa");
  assert.equal(calls.filter((url) => url.startsWith("https://oauth2.googleapis.com/token")).length, 1);
  const url = new URL(googleMailboxAuthorizationUrl(config, { state: "state-1", loginHint: "zack@example.test" }));
  assert.equal(url.searchParams.get("scope"), GMAIL_READONLY_SCOPE);
  assert.equal(url.searchParams.get("redirect_uri"), "https://roledawn.example/api/mailbox/google/callback");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(readGoogleMailboxConfig({ GOOGLE_MAILBOX_CLIENT_ID: "client" }), null);
});

test("a Gmail rate limit is temporary; only a missing permission turns the mailbox off", async () => {
  const answer = (body: string): typeof fetch => async () => new Response(body, { status: 403 });
  const query = (fetchImpl: typeof fetch) => findGreenhouseSecurityCode({ accessToken: "t", since: 0, fetch: fetchImpl });
  await assert.rejects(query(answer('{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')), /MAILBOX_PROVIDER_BUSY/u);
  await assert.rejects(query(answer('{"error":{"errors":[{"reason":"insufficientPermissions"}]}}')), /MAILBOX_SCOPE_MISSING/u);
  // Both Greenhouse sender domains are searched.
  let searched = "";
  await findGreenhouseSecurityCode({ accessToken: "t", since: 0, fetch: async (url) => { searched = decodeURIComponent(String(url)); return Response.json({}); } });
  assert.match(searched, /from:\(greenhouse-mail\.io OR greenhouse\.io\)/u);
});
