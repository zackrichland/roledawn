export type SupabasePublicConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

export function readSupabasePublicConfig(environment?: NodeJS.ProcessEnv): SupabasePublicConfig | null {
  // Direct references are required for Next to inline public config in browser
  // and middleware bundles. Workers can still supply their runtime environment.
  const url = (environment ? environment.NEXT_PUBLIC_SUPABASE_URL : process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const publishableKey = (environment ? environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();

  if (!url || !publishableKey) {
    return null;
  }

  return Object.freeze({ url, publishableKey });
}

export function requireSupabasePublicConfig(environment?: NodeJS.ProcessEnv): SupabasePublicConfig {
  const config = readSupabasePublicConfig(environment);

  if (!config) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return config;
}
