import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  deleteResumeAction,
  saveResumeReviewAction,
  uploadResumeAction,
} from "@/app/vault/actions";
import { signOut } from "@/app/dashboard/sign-out-action";
import { CareerVault } from "@/components/vault/CareerVault";
import type { CareerVaultViewModel } from "@/domain/career-vault";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import { CareerVaultError, getCareerVault } from "@/server/vault/career-vault";

export const metadata: Metadata = {
  title: "Career Vault",
  description: "Upload and review the résumé source used for future application drafts.",
};

export default async function VaultPage() {
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
  if (!actor) redirect("/login?next=/vault");

  let initialData: CareerVaultViewModel;
  try {
    initialData = await getCareerVault(actor);
  } catch (error) {
    initialData = {
      actorLabel: actor.email?.split("@")[0] ?? "Signed-in candidate",
      status: "error",
      recoveryKind: null,
      document: null,
      deletionTarget: null,
      errorMessage:
        error instanceof CareerVaultError
          ? error.message
          : "The Career Vault could not be loaded. Try again shortly.",
    };
  }

  return (
    <CareerVault
      deleteAction={deleteResumeAction}
      initialData={initialData}
      saveReviewAction={saveResumeReviewAction}
      signOutAction={signOut}
      uploadAction={uploadResumeAction}
    />
  );
}
