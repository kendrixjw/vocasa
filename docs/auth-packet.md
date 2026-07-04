# Phase 9 Build Packet — Vocasa Auth

Read this fully before writing code. This implements Phase 9 (Auth) from
docs/spec.md. Build ONLY auth in this pass — do not start Phase 10.

Vocasa uses Supabase Auth with email/password. The structure below mirrors a
proven production setup and bakes in three lessons already learned the hard
way on a prior project. Do not deviate from them.

## Scope

Signup, login, logout, forgot password, reset password, and middleware
gating. No email-verification gate for v1 (send the confirmation email, but
do not block login on it). No OAuth, no passkeys yet — those are post-launch.

Access model: the landing page and a demo-mode canvas are public.
Saving/loading plans requires login. Middleware enforces this.

## File structure

- `src/app/(auth)/login/page.tsx` — email + password form, link to signup and
  forgot-password.
- `src/app/(auth)/signup/page.tsx` — email + password + confirm password.
  On success, sign the user in and route to the app.
- `src/app/(auth)/forgot-password/page.tsx` — email field; calls
  `supabase.auth.resetPasswordForEmail(email, { redirectTo })`. Show a
  "check your inbox" state after sending.
- `src/app/reset-password/page.tsx` — sets the new password (see hash-token
  rule below). NOTE: deliberately OUTSIDE the (auth) group, at a stable
  top-level route, because Supabase emails link to it directly.
- `middleware.ts` — session refresh via @supabase/ssr + route gating.
- Reuse the existing client at `src/lib/supabase.ts`; add a server client
  helper if needed for @supabase/ssr patterns.

Use `@supabase/ssr` for all session handling so server components, route
handlers, and middleware share one session model.

## LESSON 1 — PUBLIC_ROUTES must include /reset-password

The middleware must allow these routes without authentication:

```ts
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',   // REQUIRED — without this the reset flow breaks
  '/privacy',
  '/terms',
]
```

Why: the reset link lands an UNAUTHENTICATED user on /reset-password. If the
middleware redirects unauthenticated users to /login before the page runs,
the recovery token is never processed and the flow dead-ends. This exact bug
shipped once before. Do not repeat it.

## LESSON 2 — reset-password must consume the URL hash token FIRST

Supabase reset emails link to:
`/reset-password#access_token=...&refresh_token=...&type=recovery`

The tokens are in the URL FRAGMENT (client-side only). The page must, in a
client component, BEFORE any auth-state check or redirect logic:

```ts
useEffect(() => {
  const hashParams = new URLSearchParams(window.location.hash.substring(1))
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  const type = hashParams.get('type')

  if (type === 'recovery' && accessToken) {
    supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || '',
    }).then(({ error }) => {
      if (error) {
        // show: link invalid or expired, offer to resend
      } else {
        // show the new-password form
      }
    })
  } else {
    // no recovery token: show invalid-link state, do NOT bounce to /login
  }
}, [])
```

After the user submits the new password, call
`supabase.auth.updateUser({ password })`, then route to the app signed in.

## LESSON 3 — redirectTo must exactly match the Supabase allow-list

In forgot-password, the `redirectTo` must be an absolute URL that EXACTLY
matches an entry in the Supabase dashboard's Redirect URLs list:

```ts
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
})
```

Add `NEXT_PUBLIC_SITE_URL` to .env.local and .env.example
(`http://localhost:3000` in dev). After writing the code, print a dashboard
checklist for me:
1. Supabase → Authentication → URL Configuration: set the Site URL and add
   `http://localhost:3000/reset-password` plus the production equivalents.
2. Supabase → Project Settings → Authentication → SMTP: note that custom
   SMTP (e.g. Resend: smtp.resend.com, port 465) must be configured before
   real users — the default Supabase mailer is low-limit and unreliable.
These are dashboard tasks I will do manually; do not attempt them yourself.

## Middleware behavior

- Refresh the Supabase session on every request per @supabase/ssr docs.
- If the path is not in PUBLIC_ROUTES and there is no session, redirect to
  `/login?next=<original-path>` and honor `next` after login.
- The canvas/demo route stays public; API routes for plans (Phase 10) will
  require a session — structure the matcher so that's easy to add.

## UI requirements

- Style with Tailwind to match the app chrome: brand navy #1B2A4A, clean and
  minimal, consistent with the existing header. Vocasa mark
  (public/brand/vocasa-mark.svg) small at the top of each auth card.
- Friendly consumer copy, not enterprise-speak ("Welcome back", "Forgot your
  password? No problem.").
- Show inline field errors from Supabase (wrong password, user exists,
  weak password) in plain English. Disable submit buttons while pending.
- ASCII-safe text only in these pages — no smart quotes or special Unicode
  (hydration errors from special characters in auth pages happened before).

## Acceptance tests (walk me through verifying all of these)

1. Sign up with a new email → lands in the app signed in.
2. Log out → protected routes redirect to /login; landing + demo still work.
3. Log in → returns to the `next` path if present.
4. Forgot password → email arrives → link opens /reset-password (NOT
   bounced to /login) → set new password → signed in.
5. Reset link opened twice / expired → clear error state with a resend path.
6. Wrong password on login → inline error, no crash.
7. `npm run build` passes with no errors.
