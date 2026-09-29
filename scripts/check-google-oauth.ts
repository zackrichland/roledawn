export {};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const appBaseUrl = process.env.APP_BASE_URL?.trim();

if (!supabaseUrl || !publishableKey || !appBaseUrl) {
  console.error(
    "Google OAuth readiness needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and APP_BASE_URL.",
  );
  process.exitCode = 1;
} else {
  const settingsUrl = new URL("/auth/v1/settings", supabaseUrl);
  const response = await fetch(settingsUrl, {
    headers: { apikey: publishableKey },
  });

  if (!response.ok) {
    console.error(`Supabase Auth settings returned HTTP ${response.status}.`);
    process.exitCode = 1;
  } else {
    const settings: unknown = await response.json();
    const external =
      settings && typeof settings === "object"
        ? Reflect.get(settings, "external")
        : null;
    const enabled = Boolean(
      external &&
        typeof external === "object" &&
        Reflect.get(external, "google") === true,
    );
    const applicationCallback = new URL("/auth/confirm", appBaseUrl);
    const providerCallback = new URL("/auth/v1/callback", supabaseUrl);

    console.log(
      JSON.stringify(
        {
          applicationCallback: applicationCallback.toString(),
          googleProviderEnabled: enabled,
          providerCallback: providerCallback.toString(),
        },
        null,
        2,
      ),
    );

    if (!enabled) {
      console.error(
        "Google is disabled in hosted Supabase Auth. Complete docs/execution/google-oauth-activation.md.",
      );
      process.exitCode = 2;
    }
  }
}
