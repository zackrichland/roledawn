import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthenticatedActor = Readonly<{
  userId: string;
  email: string | null;
}>;

export const getOptionalActor = cache(
  async (): Promise<AuthenticatedActor | null> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    const userId = claims?.sub;

    if (
      error ||
      !claims ||
      typeof userId !== "string" ||
      userId.length === 0
    ) {
      return null;
    }

    const email = claims.email;

    return Object.freeze({
      userId,
      email: typeof email === "string" ? email : null,
    });
  },
);

export async function requireActor(): Promise<AuthenticatedActor> {
  const actor = await getOptionalActor();

  if (!actor) {
    redirect("/login");
  }

  return actor;
}
