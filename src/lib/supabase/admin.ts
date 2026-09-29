import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types.ts";
import { requireSupabasePublicConfig } from "./config.ts";

export function createSupabaseAdminClient(
  runtime = "preparation-worker/0.1",
  environment: NodeJS.ProcessEnv = process.env,
) {
  const { url } = requireSupabasePublicConfig(environment);
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY_REQUIRED");

  return createClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { "x-roledawn-runtime": runtime } },
  });
}
