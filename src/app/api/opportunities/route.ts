import { getOptionalActor } from "@/server/auth/session";
import { searchOpportunityCatalog } from "@/server/opportunities/catalog";
import { decodeCatalogCursor } from "@/server/opportunities/catalog-cursor";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export async function GET(request: Request) {
  const actor = await getOptionalActor();
  if (!actor) return Response.json({ error: "Sign in to browse jobs." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") ?? "";
  if (cursor && !decodeCatalogCursor(cursor)) {
    return Response.json({ error: "Reload the job list to continue." }, { status: 400, headers });
  }
  try {
    const catalog = await searchOpportunityCatalog(actor, {
      query: params.get("q") ?? "", location: params.get("location") ?? "",
      workMode: params.get("workMode") ?? "", employmentType: params.get("employmentType") ?? "",
      savedOnly: params.get("saved") === "true", cursor,
    });
    return Response.json(catalog, { headers });
  } catch {
    return Response.json({ error: "More jobs could not be loaded. Try again." }, { status: 503, headers });
  }
}
