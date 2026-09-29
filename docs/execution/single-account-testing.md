---
title: Temporary single-account testing
last_updated: 2026-09-17
status: deployed; hosted acceptance verified
---

# Temporary single-account testing

The founder requested that every visit automatically open the same existing test account, with authentication and account switching hidden. This deliberately makes the shared test workspace accessible to anyone with the application URL while enabled. It does not create a fresh user per visit or use a service credential for candidate data reads and writes.

## Implementation

- `ROLEDAWN_SINGLE_ACCOUNT_MODE=true` enables the temporary path; `ROLEDAWN_TEST_ACCOUNT_ID` selects exactly one existing Auth user. The hosted and local values point to the existing `roledawn-test@local.invalid` account.
- `/login` opens `/auth/test-session`. The route reuses a matching session; otherwise it resolves the pinned existing test user, creates and verifies a server-side token, and writes ordinary Supabase session cookies. It checks the user ID at every step, never accepts an identity from the URL, and returns private, uncached responses.
- The central actor check rejects sessions for other users. Magic-link, Google, local-login actions and callbacks redirect to the fixed account before exchanging credentials. Account and sign-out controls are hidden, including onboarding. The sign-out action cannot revoke the shared account's sessions while this mode is enabled.
- No database schema, candidate facts, preferences, application authority, rate limits, worker secrets or RLS policies change. Authentication failure stops with an unavailable response; there is no fallback account or replacement workspace.

## Restore authentication

Set `ROLEDAWN_SINGLE_ACCOUNT_MODE=false` in the production environment and local configuration, then deploy/restart. Existing login code and account controls return. Already issued Supabase sessions remain normal valid sessions; revoke the shared test account's sessions as well if previously granted access must end immediately. Do not use the shared test mode for a private multi-user launch.

## Verification

**Verified 2026-09-17:** deployed as `6aac0737dc0c574d6bb5d2b1` at [RoleDawn](https://roledawn.netlify.app/dashboard). All 19 auth tests passed, including ten fixed-account cases. TypeScript, targeted lint and the production build passed.

An independent HTTP session verified the fixed Auth user and existing active candidate through normal RLS. Browser-supplied identity input was ignored; an existing session was reused without new cookies; authentication-loop destinations fell back to Applications; old callback paths could not exchange another account's credentials. Session responses were private and uncached. Netlify preserves incoming query parameters on redirects, so acceptance checked the destination origin/path and independently verified the resulting identity. No generated auth token is placed in those query parameters.

Reloading the existing hosted login tab automatically opened Applications with the existing role preferences and two application records. No Account menu, sign-out control, or login form remained. Auto-apply was still Off. The HTTP proof is retained privately under `artifacts/acceptance/single-account-20260917/http-proof.json`.

The change is limited to app authentication and environment configuration; it did not enable auto-apply or submit an application.
