import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { JobsView } from "@/components/jobs/JobsView";
import { getOptionalActor } from "@/server/auth/session";
import { readCatalogRefreshStats, searchOpportunityCatalog } from "@/server/opportunities/catalog";
import { jobListItemFromCatalog } from "@/server/opportunities/jobs-view";

export const metadata: Metadata = {
  title: "Saved jobs",
  description: "Jobs you bookmarked to apply to later.",
};

export default async function SavedJobsPage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/saved");
  const [catalog, stats] = await Promise.all([
    searchOpportunityCatalog(actor, { query: "", location: "", workMode: "", employmentType: "", savedOnly: true, cursor: "" }).catch(() => null),
    readCatalogRefreshStats(actor).catch(() => null),
  ]);
  return (
    <JobsView
      items={catalog?.items.map((item) => jobListItemFromCatalog(item)) ?? []}
      mode="SAVED"
      nextCursor={catalog?.nextCursor ?? null}
      query=""
      totalOpen={stats?.openJobCount ?? null}
      unavailable={!catalog}
    />
  );
}
