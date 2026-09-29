import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HomeView } from "@/components/home/HomeView";
import { presentHomeApplication } from "@/domain/home-presentation";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import { loadHomeDataForRequest } from "@/server/home/home-data";

const description = "Every application RoleDawn is working on, in one queue.";

/** The tab shows how many applications need you, even while you're elsewhere. */
export async function generateMetadata(): Promise<Metadata> {
  const actor = readSupabasePublicConfig() ? await getOptionalActor() : null;
  if (!actor) return { title: "Home", description };
  const data = await loadHomeDataForRequest(actor);
  const needsYou = data.applications.filter((application) => presentHomeApplication(application).needsYou).length;
  return { title: needsYou ? `(${needsYou}) Needs you` : "Home", description };
}

export default async function DashboardPage() {
  if (!readSupabasePublicConfig()) {
    return (
      <main className="setup-page">
        <section className="setup-card" aria-labelledby="setup-heading">
          <span className="setup-card__eyebrow">Setup required</span>
          <h1 id="setup-heading">Connect RoleDawn to Supabase.</h1>
          <p>Add the public Supabase URL and publishable key, then reload.</p>
        </section>
      </main>
    );
  }
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/dashboard");
  return <HomeView data={await loadHomeDataForRequest(actor)} />;
}
