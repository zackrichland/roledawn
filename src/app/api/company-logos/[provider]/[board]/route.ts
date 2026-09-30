import { after } from "next/server";

import { companyLogoResolutionResponse } from "@/server/opportunities/company-logo";
import { companyLogoResolver } from "@/server/opportunities/company-logo-cache";

// Successful images are cached via response headers and in public.employer_logos, never in Next's route cache.
// The .png path also avoids the authenticated-page proxy.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Readonly<{ params: Promise<{ provider: string; board: string }> }>) {
  const { provider, board } = await context.params;
  if (!board.endsWith(".png")) return companyLogoResolutionResponse({ kind: "invalid" });
  // A stored logo is served first; a stale one is revalidated after the response.
  const resolution = await companyLogoResolver().resolve(provider, board.slice(0, -4), { defer: (task) => after(task) });
  return companyLogoResolutionResponse(resolution);
}
