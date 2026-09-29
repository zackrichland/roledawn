import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InterviewChat } from "@/components/profile/InterviewChat";
import { getOptionalActor } from "@/server/auth/session";
import { getActiveInterview } from "@/server/candidate/interview";
import { getCandidateKnowledge } from "@/server/candidate/knowledge";

export const metadata: Metadata = {
  title: "Interview",
  description: "A short conversation that turns your work into stories you approve.",
};

export default async function InterviewPage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault/interview");
  const [knowledge, interview] = await Promise.all([getCandidateKnowledge(actor), getActiveInterview().catch(() => null)]);
  const roles = (knowledge.career.profile?.content.positions ?? []).map((position) => ({
    positionKey: position.positionKey, title: position.title, organization: position.organization,
  }));
  const view = interview && interview.status !== "ABANDONED" ? {
    sessionId: interview.sessionId,
    status: interview.status,
    turnCount: interview.turnCount,
    focusPositionKey: interview.state.focusPositionKey,
    coveredPositionKeys: interview.state.coveredPositionKeys,
    turns: interview.turns.map((turn) => ({ sequenceNumber: turn.sequenceNumber, speaker: turn.speaker, content: turn.content })),
  } : null;
  return (
    <InterviewChat
      key={view ? `${view.sessionId}:${view.status}` : "none"}
      roles={roles}
      view={view}
      waitingStories={knowledge.stories.filter((story) => story.disposition === "PROPOSED").length}
    />
  );
}
