import "server-only";

import { requireSupabasePublicConfig } from "@/lib/supabase/config";
import { hasEnabledGoogleProvider } from "@/server/auth/google-oauth-policy";

export async function isHostedGoogleProviderEnabled(): Promise<boolean> {
  try {
    const { publishableKey, url } = requireSupabasePublicConfig();
    const settingsUrl = new URL("/auth/v1/settings", url);
    const response = await fetch(settingsUrl, {
      cache: "no-store",
      headers: { apikey: publishableKey },
    });

    if (!response.ok) {
      return false;
    }

    return hasEnabledGoogleProvider(await response.json());
  } catch {
    return false;
  }
}
