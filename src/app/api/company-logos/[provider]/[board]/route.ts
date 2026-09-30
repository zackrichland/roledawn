import { companyLogoResponse, loadCompanyLogo } from "@/server/opportunities/company-logo";

// Cache successful public images via response headers, never transient misses in Next's route cache.
// The .png path also avoids the authenticated-page proxy.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Readonly<{ params: Promise<{ provider: string; board: string }> }>) {
  const { provider, board } = await context.params;
  return companyLogoResponse(board.endsWith(".png") ? await loadCompanyLogo(provider, board.slice(0, -4)) : null);
}
