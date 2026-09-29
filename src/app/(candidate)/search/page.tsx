import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { JobsSkeleton, JobsView } from "@/components/jobs/JobsView";
import { normalizeOpportunityQuery } from "@/domain/opportunity-catalog";
import { getOptionalActor, type AuthenticatedActor } from "@/server/auth/session";
import { readCatalogRefreshStats, searchOpportunityCatalog } from "@/server/opportunities/catalog";
import { jobListItemFromCatalog, loadForYouJobs } from "@/server/opportunities/jobs-view";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Open roles ranked for you. Read one, then apply in a click.",
};

type SearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

async function JobsContent({ actor, query }: Readonly<{ actor: AuthenticatedActor; query: string }>) {
  const stats = readCatalogRefreshStats(actor).catch(() => null);
  if (query) {
    const catalog = await searchOpportunityCatalog(actor, {
      query, location: "", workMode: "", employmentType: "", savedOnly: false, cursor: "",
    }).catch(() => null);
    return (
      <JobsView
        items={catalog?.items.map((item) => jobListItemFromCatalog(item)) ?? []}
        mode="SEARCH"
        nextCursor={catalog?.nextCursor ?? null}
        query={query}
        totalOpen={(await stats)?.openJobCount ?? null}
        unavailable={!catalog}
      />
    );
  }
  const [forYou, resolvedStats] = await Promise.all([loadForYouJobs(actor, 40), stats]);
  return (
    <JobsView
      items={forYou?.items ?? []}
      mode="FOR_YOU"
      query=""
      totalOpen={resolvedStats?.openJobCount ?? null}
      unavailable={!forYou}
    />
  );
}

export default async function JobsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/search");
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] ?? "" : params.q ?? "";
  const query = normalizeOpportunityQuery(raw);
  return (
    <Suspense fallback={<JobsSkeleton mode={query ? "SEARCH" : "FOR_YOU"} />} key={query}>
      <JobsContent actor={actor} query={query} />
    </Suspense>
  );
}
