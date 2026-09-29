import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResumePanel } from "@/components/profile/ResumePanel";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import { getOptionalActor } from "@/server/auth/session";
import { loadResumeState } from "@/server/profile/resume-state";

export const metadata: Metadata = {
  title: "Résumé",
  description: "The résumé RoleDawn tailors for every application.",
};

export default async function ResumePage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault");
  const { vault, confirmation } = await loadResumeState(actor);
  return (
    <>
      <RouteAutoRefresh
        active={vault.status === "uploading" || confirmation?.careerProfile === "ORGANIZING"}
        cycleKey={`${vault.status}:${confirmation?.careerProfile ?? ""}:${confirmation?.approvedLines ?? 0}`}
        intervalMs={5_000}
      />
      <ResumePanel confirmation={confirmation} key={vault.document?.documentVersionId ?? vault.status} vault={vault} />
    </>
  );
}
