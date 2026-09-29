---
title: Google OAuth activation
status: blocked on external credentials
last_updated: 2026-08-18
---

# Google OAuth activation

## Current result

**Verified:** RoleDawn's server action starts Supabase Google OAuth, preserves a
safe in-app destination, exchanges the PKCE code in `/auth/confirm`, creates the
personal workspace, and resumes the requested route.

**Verified:** HireWire currently returns `external.google: false` from its
public Auth settings. The repository and local environment contain no Google
OAuth client ID or client secret. RoleDawn therefore hides the unavailable
Google button and keeps email-link sign-in working.

**External blocker:** Google must issue a Web OAuth client before Supabase can
enable the provider. Do not invent or reuse credentials from another product.

## One-time activation

1. In the [Google Auth Platform](https://console.cloud.google.com/auth/overview),
   select or create the RoleDawn Google Cloud project.
2. Configure an external audience. During founder testing, add only the founder
   Google account as a test user.
3. Request only `openid`, `userinfo.email`, and `userinfo.profile`.
4. Create a **Web application** OAuth client.
5. Add `http://127.0.0.1:3001` as the development JavaScript origin.
6. Add this exact Google redirect URI:

   ```text
   https://dxrrotrugwhquqxyoisk.supabase.co/auth/v1/callback
   ```

7. In HireWire's Supabase **Authentication > Providers > Google** screen, paste
   the new client ID and client secret, enable Google, and save.
8. In Supabase **Authentication > URL Configuration**, use
   `http://127.0.0.1:3001` as the development Site URL and allow this app
   callback:

   ```text
   http://127.0.0.1:3001/auth/confirm
   ```

9. Before deployment, repeat steps 5 and 8 for the exact HTTPS production
   origin. Do not use a broad production wildcard.

## Verification

Run:

```bash
npm run auth:check-google
```

The command must return `googleProviderEnabled: true`. Then open
`/login?next=/onboarding`, continue with Google, and verify all three outcomes:

1. Google consent returns to `/auth/confirm` without a redirect error.
2. The signed-in Auth user receives one idempotently created personal workspace
   and candidate record.
3. The browser reaches `/onboarding` with a normal cookie-backed Supabase
   session; direct candidate-table access remains governed by RLS.

Official setup reference: [Supabase Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
