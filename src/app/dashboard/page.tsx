import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CandidateQueue } from "@/components/dashboard/CandidateQueue";
import type { AuthenticatedDashboardData } from "@/domain/dashboard-queue";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import { getQueueWorkspace } from "@/server/dashboard/queue";

export const metadata: Metadata = {
  title: "Candidate queue",
  description: "Track real job-application preparation in one persistent queue.",
};

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
  if (!actor) {
    redirect("/login?next=/dashboard");
  }

  let initialData: AuthenticatedDashboardData;
  try {
    const queue = await getQueueWorkspace(actor);
    initialData = {
      mode: "authenticated",
      actorLabel: queue.actorLabel,
      backendStatus: "available",
      applications: queue.applications,
    };
  } catch {
    initialData = {
      mode: "authenticated",
      actorLabel: actor.email?.split("@")[0] ?? "Signed-in candidate",
      backendStatus: "unavailable",
      applications: [],
    };
  }

  return <CandidateQueue initialData={initialData} />;
}
