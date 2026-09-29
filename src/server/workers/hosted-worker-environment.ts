// The hosted adapter reads only this allowlist. No browser-visible configuration contains worker credentials.
export const HOSTED_WORKER_ENVIRONMENT_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
  "OPENAI_API_KEY", "ROLEDAWN_FORM_DRIVER", "ROLEDAWN_AUTOPILOT_ENABLED",
  "ROLEDAWN_APPLICATION_AGENT_MODEL", "ROLEDAWN_APPLICATION_AGENT_TIMEOUT_MS", "ROLEDAWN_APPLICATION_AGENT_MAX_ACTIONS",
  "ROLEDAWN_BROWSERBASE_ENABLED", "BROWSERBASE_API_KEY", "BROWSERBASE_REGION", "BROWSERBASE_API_TIMEOUT_MS",
  "ROLEDAWN_HOSTED_WORKERS_ENABLED", "ROLEDAWN_WORKER_DISPATCH_SECRET", "URL", "APP_BASE_URL",
  // Per-task model overrides (src/server/ai/models.ts) must reach the workers too.
  "ROLEDAWN_RESEARCH_MODEL", "ROLEDAWN_DRAFTING_MODEL", "ROLEDAWN_VERIFICATION_MODEL", "ROLEDAWN_PROFILE_MODEL",
  // Read-only mailbox for employer verification codes (D-106).
  "ROLEDAWN_MAILBOX_TOKEN_KEY", "GOOGLE_MAILBOX_CLIENT_ID", "GOOGLE_MAILBOX_CLIENT_SECRET",
] as const;

export function readHostedWorkerEnvironment(read: (key: string) => string | undefined): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(HOSTED_WORKER_ENVIRONMENT_KEYS.map(key => [key, read(key)])), NODE_ENV: "production" };
}

export function hostedWorkersEnabled(environment: NodeJS.ProcessEnv, deploy: { context?: string; published?: boolean }): boolean {
  return environment.ROLEDAWN_HOSTED_WORKERS_ENABLED === "true" && deploy.context === "production" && deploy.published === true;
}

/** Netlify invokes schedules only for its published deploy, but reports
 * published=false on those invocations. The receiving background handler still
 * requires published=true and uses the permanent site URL. */
export function hostedScheduleEnabled(environment: NodeJS.ProcessEnv, deploy: { context?: string }): boolean {
  return environment.ROLEDAWN_HOSTED_WORKERS_ENABLED === "true" && deploy.context === "production";
}

export function hostedWorkerUrl(environment: NodeJS.ProcessEnv): URL {
  const target = new URL(environment.URL || environment.APP_BASE_URL || "");
  if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("HOSTED_WORKER_URL_INVALID");
  return new URL("/.netlify/functions/worker-background", target.origin);
}
