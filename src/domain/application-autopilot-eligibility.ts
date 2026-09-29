export const AUTOPILOT_UNSUPPORTED_DESTINATION_COPY =
  "Apply for me supports hosted Greenhouse and Lever forms. Some forms need your help with verification. Other employers can use your prepared files.";

export type AutopilotDestination = Readonly<{
  provider: "GREENHOUSE" | "LEVER";
  boardToken: string;
  jobId: string;
  startUrl: string;
}>;

/** This is a delivery contract registry, not a list of catalog providers. */
export const ATS_DELIVERY_CAPABILITIES = Object.freeze({
  GREENHOUSE: { status: "DELIVERY_IMPLEMENTED", release: "greenhouse-embed-us/2026-09-28", region: "US", liveEmployerAccepted: false },
  LEVER: { status: "DELIVERY_IMPLEMENTED", release: "lever-hosted-global/2026-09-16", region: "GLOBAL", liveEmployerAccepted: false },
  ASHBY: { status: "PREPARATION_ONLY", release: null, region: "GLOBAL", liveEmployerAccepted: false },
} as const);

export function parseLeverAutopilotDestination(destinationUrl: string | null | undefined): AutopilotDestination | null {
  if (typeof destinationUrl !== "string" || !/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/[a-z0-9_-]+\/[a-f0-9-]+(?:\/apply)?\/?$/u.test(destinationUrl)) return null;
  let url: URL;
  try { url = new URL(destinationUrl); } catch { return null; }
  const match = /^\/([a-z0-9_-]+)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/apply)?\/?$/u.exec(url.pathname);
  if (url.origin !== "https://jobs.lever.co" || url.username || url.password || !match || url.search || url.hash) return null;
  return Object.freeze({ provider: "LEVER", boardToken: match[1], jobId: match[2], startUrl: `${url.origin}/${match[1]}/${match[2]}/apply` });
}

export function parseAutopilotDestination(destinationUrl: string | null | undefined): AutopilotDestination | null {
  const greenhouse = parseGreenhouseAutopilotDestination(destinationUrl);
  return greenhouse ? Object.freeze({ provider: "GREENHOUSE", ...greenhouse }) : parseLeverAutopilotDestination(destinationUrl);
}

/** Keep candidate eligibility and the browser's final destination guard identical. */
export function parseGreenhouseAutopilotDestination(destinationUrl: string | null | undefined): Readonly<{
  boardToken: string;
  jobId: string;
  startUrl: string;
}> | null {
  if (typeof destinationUrl !== "string" || !/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/[a-z0-9_-]+\/jobs\/\d+\/?$/u.test(destinationUrl)) return null;
  let url: URL;
  try { url = new URL(destinationUrl); } catch { return null; }
  const match = /^\/([a-z0-9_-]+)\/jobs\/(\d+)\/?$/u.exec(url.pathname);
  if (url.origin !== "https://job-boards.greenhouse.io" || url.username || url.password || !match || url.search || url.hash) return null;
  return Object.freeze({ boardToken: match[1], jobId: match[2], startUrl: `${url.origin}/${match[1]}/jobs/${match[2]}` });
}
