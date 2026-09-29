"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSingleAccountConfig } from "@/server/auth/single-account-policy";

export async function signOut(): Promise<never> {
  if (readSingleAccountConfig()) redirect("/dashboard");
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
