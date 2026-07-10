# Vocasa

[![CI](https://github.com/kendrixjw/vocasa/actions/workflows/ci.yml/badge.svg)](https://github.com/kendrixjw/vocasa/actions/workflows/ci.yml)

Voice-first home-sketching for homeowners. Say *"make a 15 by 20 living room"* or
*"put a sofa against the north wall"* and it appears — labeled, measured, and
editable by hand. Not a CAD tool: the goal is a friendly picture you can share,
not a blueprint.

The single most important rule: **the AI generates structured operations (JSON),
never images.** Every dimension is imperial, stored internally in inches.

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **HTML5 Canvas 2D** custom renderer — no Fabric/Konva
- **Tailwind** for chrome only (the canvas is hand-drawn)
- **Anthropic API** (`claude-opus-4-8`) for voice/text parsing and design assist — proxied server-side
- **Web Speech API** for in-browser voice capture
- **Supabase** (auth + Postgres, Row Level Security) for persistence
- **Vercel AI Gateway** (`ai` SDK) for premium image-to-image redesign renders
- **Stripe** for metered render credits (packs + subscription tiers)
- **jsPDF** for PDF export

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000.

### Environment

| Variable | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Voice/text commands, design assist, decor suggestions | **Server-side only** — never shipped to the client |
| `NEXT_PUBLIC_SUPABASE_URL` | Save/load, dashboard | Public; RLS enforces access |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Save/load, dashboard | Public; anon key is safe to ship |
| `VERCEL_OIDC_TOKEN` / `AI_GATEWAY_API_KEY` | Premium redesign renders | AI Gateway auth; OIDC token comes from `vercel env pull` |
| `SUPABASE_SERVICE_ROLE_KEY` | Redesign billing webhook | **Server-side only** — lets the Stripe webhook credit any account; bypasses RLS |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Buying render credits | Server-side; Price IDs for the packs/tiers (see `.env.local.example`) |

The app **degrades gracefully**: with no Supabase keys it runs in local-only mode
(`/editor/local`, no save); without an Anthropic key the command bar and assist
report a clear error but hand editing still works.

### Supabase setup

1. Create a Supabase project.
2. Run the migrations in [`supabase/migrations/`](supabase/migrations/) in order:
   `0001_plans.sql` (the `plans` table, owner-only RLS, `updated_at` trigger,
   owner index), `0002_sharing.sql` (the `share_token` column + comments +
   token-scoped RPCs for read-only sharing), then `0003_renders.sql` and
   `0004_billing.sql` if you're enabling premium renders (render credits/history
   + tamper-proof credit accounting, and Stripe billing tables).
3. Add your dev/prod origin to the Auth redirect URLs (e.g. `http://localhost:3000`).
4. Sign in is passwordless **magic link** (email OTP).

## Using it

- **Speak or type** a command in the top bar: *"make a 12 by 12 bedroom with a
  queen bed against the north wall and a door on the east wall."* One utterance can
  become several operations, applied as a single undo step.
- **Design assist** (✨) gives plain-English feedback and can propose changes you
  **preview on the canvas and Apply or Discard** — never auto-committed.
- **Decor suggestions** turn a style direction (*"warm mid-century modern"*) —
  optionally with a reference photo — into a text scheme: a palette of hex
  swatches, materials, and furnishing ideas with **honest Google Shopping search
  links**. Text only, **no image renders**, and never fabricated product URLs.
- **Redesign renders** (Premium ✨) turn a real photo of a room or yard into a
  restyled, photorealistic **concept image** via the Design (room) or Landscaping
  (yard) module. Renders are inspirational — **not to scale, not editable** — and
  kept visibly distinct from your precise plan. Metered: the first 2 renders per
  module are free, then each costs a credit (buy packs or a monthly plan).
- **By hand:** draw walls, drag/rotate/resize furniture, place doors/windows. Rooms
  auto-detect from enclosed walls with live square footage. Everything undoes
  (Ctrl/Cmd+Z).
- **Save** is automatic (~2s debounce) plus Ctrl/Cmd+S; your plans show as
  thumbnails on the dashboard.
- **Share** exports a clean PNG or PDF.

## Architecture

Model / View / Controller with a strict command pattern.

```
lib/
  viewport.ts            world (inches, Y-up) <-> screen (px) transforms
  editor.ts              the engine: doc, history, viewport, tools, selection, single render() path
  history.ts             Command interface + undo/redo stacks
  commands.ts            concrete reversible commands (Add/Delete/Transform/… + ApplyAIBatch)
  model/                 semantic entities: wall, room, furniture, opening, document
  rooms/                 auto-room detection (planar face traversal) + name-preserving sync
  furniture/             data-driven furniture library + snapping
  tools/                 select / draw-wall / place-furniture / place-opening state machines
  ai/
    ops.ts               the AI op vocabulary + validateOps (untrusted-input guard, clamps)
    scene.ts, snapshot.ts  scene indexing + compact context sent to the model
    prompt.ts            system prompts (parse + assist)
    resolver.ts          symbolic anchors/refs -> concrete geometry -> ApplyAIBatch
    client.ts, assist.ts client orchestration (parse / design assist)
  voice/speech.ts        Web Speech API wrapper (mic = just a transcript source)
  persistence/           serialize/load, Supabase CRUD, thumbnails
  export/exportPlan.ts   PNG / PDF rendering
  supabase/              browser + server clients, session hook, config
app/
  page.tsx               dashboard / auth gate / local-mode fallback
  editor/[id]/page.tsx   the editor bound to a plan
  api/parse, api/assist  server-side Anthropic proxies
  api/decor              decor-scheme proxy (plan + style [+ photo] -> palette/materials/items)
  api/redesign           premium image-to-image renders via AI Gateway (authed, metered)
  api/billing/*          Stripe checkout / webhook / portal for render credits
lib/
  billing/               Stripe client, product catalog, checkout helper
  supabase/admin.ts      service-role client (webhook only) — bypasses RLS, server-only
components/CanvasStage.tsx  the React shell (sizing, input routing, HUD, all controls)
proxy.ts                 refreshes the Supabase session cookie (Next 16 proxy convention)
```

### AI pipeline

```
mic / text -> transcript -> /api/parse (Claude) -> JSON ops
           -> validateOps (reject off-schema, clamp sizes)
           -> resolveBatch (resolve refs/anchors against real geometry, on a clone)
           -> ApplyAIBatch (one undo step) -> render -> plain-English confirmation
```

AI output is **untrusted**: validated against a fixed schema, sizes clamped, never
`eval`'d. If any reference is ambiguous or missing, the whole batch becomes a
one-line clarifying question instead of a wrong guess.

## Scripts

```bash
npm run dev     # dev server
npm run build   # production build (also runs tsc)
npm test        # node --test (unit tests for viewport, model, rooms, AI ops/resolver, persistence)
```

Browser-only surfaces (voice capture, canvas export, thumbnails) are verified
manually; everything else has unit coverage.

## Scope (v1)

In: multiple floors, imperial units, voice + hand editing, save/load, PNG/PDF/DXF
export, dimensions/annotations, photo input (photo → editable plan), share links +
comments, AI decor suggestions, and premium redesign renders (paid, metered).
Out (deliberately): DWG, 3D, arcs/splines — this is a consumer tool, not a
blueprint editor. Redesign renders stay clearly separate: inspirational images,
never editable or to-scale geometry.
