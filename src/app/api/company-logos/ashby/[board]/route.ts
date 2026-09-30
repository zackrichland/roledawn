import { companyLogoResponse, loadAshbyCompanyLogo } from "@/server/opportunities/ashby-company-logo";

// Cache successful public images via response headers, never transient misses in Next's route cache.
// The .png path also avoids the authenticated-page proxy.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Readonly<{ params: Promise<{ board: string }> }>) {
  const { board } = await context.params;
  return companyLogoResponse(board.endsWith(".png") ? await loadAshbyCompanyLogo(board.slice(0, -4)) : null);
}
