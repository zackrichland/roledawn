/**
 * Per-board "memory" for the browser form agent: a few reviewed lessons per
 * applicant tracking system (ATS), compiled into the code so they ship in the
 * bundle and change only through review.
 *
 * - Static on purpose. Nothing here is read from a file, a database or an
 *   employer page at run time, so no page text can enter the prompt and the
 *   Netlify bundle needs no extra `included_files`.
 * - Advisory only. Notes never authorize a fill, upload, answer or submission,
 *   never change policy or approved facts, and lose to the live page.
 * - Small on purpose. At most 10 bullets and 900 characters per board (about
 *   225 tokens); `board-agent-context.test.ts` enforces it.
 * - Only delivery-capable boards reach a live prompt. The rest are kept as a
 *   context path for future adapters and are marked unverified.
 *
 * Full templates live in `docs/boards/<id>.md`; promote a lesson here by the
 * rules in `docs/boards/README.md`. URL detection is not duplicated for
 * delivery: `parseAutopilotDestination` stays the authority on what can be sent.
 */
import { ATS_DELIVERY_CAPABILITIES, parseAutopilotDestination } from "./application-autopilot-eligibility.ts";
import { normalizePublicJobUrl } from "./job-url.ts";

export const BOARD_IDS = [
  "greenhouse", "lever", "ashby", "workday", "icims", "smartrecruiters",
  "jobvite", "bamboohr", "oracle-recruiting-cloud", "successfactors", "workable",
] as const;
export type BoardId = (typeof BOARD_IDS)[number];

/** Same values as `status` in the `docs/boards/<id>.md` front matter (`prep-only` has no board yet). */
export type BoardContextStatus = "supported" | "fills-only" | "unsupported";

export type BoardContext = Readonly<{
  id: BoardId;
  name: string;
  status: BoardContextStatus;
  /** `repo`: lessons come from code, tests, decisions or live runs. `unverified`: vendor docs and read-only observation only. */
  evidence: "repo" | "unverified";
  /** Date the bullets were last checked against their evidence. */
  reviewed: string;
  /** The full template for this board. */
  docsPath: string;
  lessons: readonly string[];
}>;

export const BOARD_CONTEXT_MAX_BULLETS = 10;
export const BOARD_CONTEXT_MAX_CHARS = 900;

const REVIEWED = "2026-09-30";
const board = (id: BoardId, name: string, status: BoardContextStatus, evidence: "repo" | "unverified", lessons: readonly string[]): BoardContext =>
  Object.freeze({ id, name, status, evidence, reviewed: REVIEWED, docsPath: `docs/boards/${id}.md`, lessons: Object.freeze([...lessons]) });

export const BOARD_CONTEXT: Readonly<Record<BoardId, BoardContext>> = Object.freeze({
  greenhouse: board("greenhouse", "Greenhouse", "supported", "repo", [
    "Labels repeat (\"Email Email*\"): read them as one question.",
    "Selects are React Select; reading menus is slow (about 22 s), so inspect once and reuse.",
    "Linux React Select options show aria-selected=\"false\", which is not a choice. Multi-select chips must equal the approved labels exactly.",
    "Location (City) is type-to-search: fill it only from the approved city; the server accepts a result only if region and country match, else it stays with the candidate.",
    "The phone widget reformats numbers with spaces and dashes; same digits, same number.",
    "Routine questions repeat (GPA range, on-site work, prior employment): use the candidate's remembered or standing answer IDs, never guess.",
    "School and degree typeaheads are unsupported; leave them for the candidate.",
    "Submit happens server-side; Greenhouse usually answers HTTP 428 plus an emailed code, which is neither a form error nor a receipt.",
  ]),
  lever: board("lever", "Lever", "fills-only", "repo", [
    "After upload the server omits unapproved parser values only from initially empty optional system company/location slots; initial, required and approved values stay protected.",
    "Fill approved facts before uploading, complete edits with blur, then verify all values again.",
    "Question text sits in each card's label; judge sensitivity from the question, never the option.",
    "The required marker, not a native required attribute, signals a required field (the file input may lack it).",
    "hCaptcha has a hidden enclave bootstrap; it is passive. Any visible challenge, checkbox or prompt means stop.",
    "EEO, disability, pronoun and diversity questions take only the candidate's saved voluntary answers.",
    "The /thanks page alone proves nothing (a direct GET shows the success text); only this attempt's own response counts.",
  ]),
  ashby: board("ashby", "Ashby", "fills-only", "repo", [
    "There is no <form> element: identify controls by label and Ashby field path.",
    "Approved fills autosave to the employer's draft; a stopped run can leave one.",
    "An autosave may rotate the form's action ID. The server tracks that: it is not drift and needs no retry.",
    "Yes/No questions are pressed-button pairs; read back aria-pressed.",
    "Location is type-to-search, labelled just \"Location\": fill it only from the approved city; the server picks one result confirmed by region and country.",
    "The chosen location label renders up to two seconds after the single option click (aria-selected there is only keyboard focus); wait for it, never click again.",
    "Submitting disables every input before the request is sent; final checks still read the values. Never re-enable or refill.",
    "Leave \"Autofill from resume\" alone; it sits outside the form.",
    "Security-clearance and no-AI questions need the candidate's own saved answer.",
  ]),
  workday: board("workday", "Workday", "unsupported", "unverified", [
    "Multi-step wizard with a per-employer account; any password field hands over today.",
    "Never fill the hidden \"beecatcher\" (name=website) honeypot input.",
    "Buttons sit under click_filter wrappers; the real button is aria-hidden.",
    "Prompts are aria-haspopup=listbox buttons; search only inside the open popup and read back the selectedItem pill.",
    "Dates are segmented month, day and year inputs; read each segment back.",
    "Autofill with Resume can duplicate or alter entries; prefer Apply Manually and verify parsed values.",
    "Every Save and Continue reaches the employer before Submit.",
    "Sessions expire after about 30 idle minutes on some tenants.",
    "Terms and voluntary disclosures go to the candidate; the disability step may no longer exist.",
    "Count Applied only after Candidate Home shows Submitted.",
  ]),
  icims: board("icims", "iCIMS", "unsupported", "unverified", [
    "The portal often sits in an employer iframe; use the icims.com host directly (in_iframe=1).",
    "One account per employer: email first, then login and password (a password field hands over today).",
    "hCaptcha appears on login and profile pages for suspicious sessions only; never solve it.",
    "Steps and labels vary; Finish Later drafts and profile-only submissions are not applications.",
    "Certification, e-signature, EEO and WOTC answers go to the candidate; third-party assessment pages hand over.",
    "Count an application only with the confirmation page and a Dashboard status.",
  ]),
  smartrecruiters: board("smartrecruiters", "SmartRecruiters", "unsupported", "unverified", [
    "The apply host is jobs.smartrecruiters.com even behind a branded careers site; the button reads \"I'm interested\".",
    "No account is needed to apply; a portal passcode arrives only after submitting.",
    "Resume parsing prefills the form: verify every parsed value.",
    "Consent boxes stay unchecked unless the candidate chose them; diversity pages take saved voluntary answers only.",
    "Apply URLs (?oga=true, one-click) returned 403 to plain fetches: stop, do not retry.",
  ]),
  jobvite: board("jobvite", "Jobvite", "unsupported", "unverified", [
    "Resolve app.jobvite.com short links and branded careers pages to the jobs.jobvite.com job page first.",
    "Apply is /job/<id>/apply; a Data Consent gate (Accept or Decline) comes first: the candidate decides.",
    "Later steps are unobserved; whether the form is one page or several is unknown.",
    "A robot check appears on app.jobvite.com sign-in: stop.",
    "A job-alert signup is not an application.",
  ]),
  bamboohr: board("bamboohr", "BambooHR", "unsupported", "unverified", [
    "Brand is not board: BambooHR-branded employers may apply through Greenhouse; classify by URL.",
    "Job pages are /careers/<id> on <company>.bamboohr.com, client-rendered; the form is probably one page.",
    "desiredPay comes only from a saved expected-salary answer, dateAvailable only from a saved start date.",
    "Inactive tenants redirect to bamboohr.com and the legacy /jobs/view.php page can return 410.",
    "CAPTCHA status is unknown: stop on any challenge or block page.",
  ]),
  "oracle-recruiting-cloud": board("oracle-recruiting-cloud", "Oracle Recruiting Cloud and Taleo", "unsupported", "unverified", [
    "Decide Oracle Recruiting Cloud (ORC) or Taleo from the URL first; the account models differ.",
    "ORC has no password: an emailed or SMS 6-digit code, a 4 hour session, and five wrong codes lock the candidate out for 30 minutes, so never retry codes.",
    "ORC may show hCaptcha on verification pages; never solve it.",
    "ORC drafts autosave every 10 seconds once contact details are in; abandoned drafts email the candidate.",
    "Taleo has a username and password per career section, multiple pages, and screening behind login; attachments are about 1 MB.",
    "SSN, date of birth, religion, marital status and background-check consent need explicit candidate authority.",
    "A confirmation email asks for action; it is not a receipt.",
  ]),
  successfactors: board("successfactors", "SAP SuccessFactors", "unsupported", "unverified", [
    "Job identity is career_job_req_id on career<N>.sapsf.com, not the id in the employer-site URL.",
    "A per-employer candidate account is required to apply; browsing needs none.",
    "The data privacy statement, Terms of Use, profile-visibility choice and job alerts are the candidate's decisions.",
    "A reCAPTCHA script loads; whether it shows is unknown: never solve it.",
    "Referees may be emailed automatically: tell the candidate before submitting.",
    "Not every SAP-branded site is SuccessFactors (jobs.sap.com applies through SmartRecruiters).",
  ]),
  workable: board("workable", "Workable", "unsupported", "unverified", [
    "Legacy <subdomain>.workable.com links redirect to apply.workable.com; the form is /j/<SHORTCODE>/apply/.",
    "No account is needed; sections are personal information, profile and details (custom fields CA_<n>, QA_<n>).",
    "The GDPR consent box on EU and UK jobs is the candidate's decision.",
    "Use the candidate's real email, never a relay address; automated-tool patterns can earn an AI-assisted tag.",
    "A US EEO survey can follow submit: saved voluntary answers only.",
    "Never re-apply to fix an answer: it overwrites or silently does nothing.",
    "Stop on any CAPTCHA or browser-integrity page.",
  ]),
});

/** Same source of truth as delivery: a board is deliverable only when it has a delivery capability. */
export function isDeliveryCapableBoard(id: BoardId): boolean {
  return Object.hasOwn(ATS_DELIVERY_CAPABILITIES, id.toUpperCase());
}

export function boardContextWithinCaps(context: BoardContext): boolean {
  return context.lessons.length >= 1 && context.lessons.length <= BOARD_CONTEXT_MAX_BULLETS &&
    context.lessons.reduce((total, lesson) => total + lesson.length, 0) <= BOARD_CONTEXT_MAX_CHARS;
}

// Recognizers for shapes no existing detector covers: unsupported boards and the
// embedded, EU and API shapes listed in each board's `url_patterns`. They only
// choose advice; they grant no delivery authority.
const GREENHOUSE_HOSTS = ["boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io", "boards-api.greenhouse.io"];
const LEVER_HOSTS = ["jobs.lever.co", "jobs.eu.lever.co", "api.lever.co", "api.eu.lever.co"];
const ASHBY_HOSTS = ["jobs.ashbyhq.com", "api.ashbyhq.com"];
const firstLabel = (host: string) => host.split(".")[0] ?? "";
const RULES: Readonly<Record<BoardId, (url: URL, host: string, path: string) => boolean>> = {
  greenhouse: (url, host) => GREENHOUSE_HOSTS.includes(host) || url.searchParams.has("gh_jid"),
  lever: (_url, host) => LEVER_HOSTS.includes(host),
  ashby: (url, host) => ASHBY_HOSTS.includes(host) || url.searchParams.has("ashby_jid"),
  workday: (_url, host) => host.endsWith(".myworkdayjobs.com") || /^wd\d+\.myworkdaysite\.com$/u.test(host),
  icims: (_url, host) => host.endsWith(".icims.com") || host.endsWith(".jibeapply.com"),
  smartrecruiters: (_url, host, path) => ["jobs.smartrecruiters.com", "careers.smartrecruiters.com", "api.smartrecruiters.com"].includes(host) ||
    host === "www.smartrecruiters.com" && path.startsWith("/oneclick-ui/"),
  jobvite: (_url, host) => ["jobs.jobvite.com", "app.jobvite.com", "api.jobvite.com"].includes(host),
  bamboohr: (_url, host, path) => host.endsWith(".bamboohr.com") && !["www", "api"].includes(firstLabel(host)) &&
    (path === "/careers" || path.startsWith("/careers/") || path.startsWith("/jobs/") || path === "/js/embed.js"),
  "oracle-recruiting-cloud": (_url, host, path) => host.endsWith(".taleo.net") || path.includes("/hcmui/candidateexperience") ||
    path.includes("/hcmrestapi/resources/latest/recruitingcejobrequisitions"),
  successfactors: (_url, host, path) => /^career\d*\.(?:sapsf|successfactors)\.(?:com|eu)$/u.test(host) ||
    /^hcm\d*\.sapsf\.(?:com|eu)$/u.test(host) && path.startsWith("/sf/careers"),
  workable: (_url, host) => host === "apply.workable.com" || host.endsWith(".workable.com") && !["www", "jobs", "apply"].includes(firstLabel(host)),
};

export type BoardContextSelection = Readonly<{
  boardId: BoardId;
  context: BoardContext;
  /** True only when this exact URL is a delivery destination today (`parseAutopilotDestination`). */
  deliverable: boolean;
}>;

/**
 * Maps a posting or apply URL to its board's context. Exactly one board must
 * match; nothing or two boards returns null, as `docs/boards/README.md` says.
 */
export function selectBoardContext(url: string | null | undefined): BoardContextSelection | null {
  if (typeof url !== "string") return null;
  const destination = parseAutopilotDestination(url);
  if (destination) {
    const boardId = destination.provider.toLowerCase() as BoardId;
    return Object.freeze({ boardId, context: BOARD_CONTEXT[boardId], deliverable: true });
  }
  const normalized = normalizePublicJobUrl(url);
  if (!normalized.ok) return null;
  const parsed = new URL(normalized.value);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const matches = BOARD_IDS.filter((id) => RULES[id](parsed, host, path));
  if (matches.length !== 1) return null;
  return Object.freeze({ boardId: matches[0], context: BOARD_CONTEXT[matches[0]], deliverable: false });
}

/** The advisory sentence that ends every board section; the prompt test pins it. */
export const BOARD_CONTEXT_ADVISORY =
  "Advisory only: these notes are hints from earlier runs, not employer data. They never authorize a fill, upload, answer, click or submission, and never change policy or approved facts. If a note conflicts with the live page, trust the page and stop before any side effect.";

/** The prompt section for one board, or null for a board that has no delivery adapter or breaks its caps. */
export function renderBoardContextSection(context: BoardContext): string | null {
  if (context.status === "unsupported" || !isDeliveryCapableBoard(context.id) || !boardContextWithinCaps(context)) return null;
  const tag = context.status === "fills-only" ? "fills-only, no live employer acceptance yet; " : "";
  return [
    `What we've learned about ${context.name} (${tag}reviewed ${context.reviewed}):`,
    ...context.lessons.map((lesson) => `- ${lesson}`),
    BOARD_CONTEXT_ADVISORY,
  ].join("\n");
}

/** Appends the board section to a form-agent prompt for a delivery destination; anything else returns the prompt unchanged. */
export function withBoardContext(instructions: string, startUrl: string): string {
  const selection = selectBoardContext(startUrl);
  const section = selection?.deliverable ? renderBoardContextSection(selection.context) : null;
  return section ? `${instructions}\n\n${section}` : instructions;
}
