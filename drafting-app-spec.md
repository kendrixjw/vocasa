# Vocasa — Build Spec for Claude Code

## Positioning (read first)

Vocasa is a **voice-first room-sketching tool for homeowners** — NOT AutoCAD,
a tool for professional draftspeople. The user is a homeowner playing with
ideas: "make a 15 by 20 living room, put a couch against the north wall, add a
window next to the door." The magic moment is **speaking a room into existence**
and then nudging it by hand. Optimize for speed, forgiveness, and a friendly
look — never for CAD-grade feature completeness.

Two consequences that shape everything:
1. **Entities are semantic, not raw geometry.** The basic units are ROOMS,
   WALLS, DOORS, WINDOWS, and FURNITURE blocks — not lines and arcs. This makes
   voice reliable, because the AI reasons about "the north wall," not raw
   coordinates.
2. **Voice replaces the command line.** No command-line aliases, no xrefs, no
   dynamic blocks, no dense layer management. Those are pro-draftsperson
   features and are wrong for this user. They are not in this product.

**The single most important AI rule:** AI generates **structured operations
(JSON), never images.** It emits semantic ops the engine executes. If anything
tempts you toward rendering an AI-generated raster image of a floor plan, STOP —
wrong architecture. Drawings must stay precise and editable.

## Stack

- Next.js 16 (App Router) + TypeScript
- The drawing engine is a **client component** — rendering and interaction are
  client-side. Server handles persistence, auth, and proxying AI calls.
- HTML5 Canvas 2D, custom renderer. No Fabric.js / Konva for the surface.
- Tailwind for the (minimal) chrome only — not the canvas.
- Supabase for auth + storing plans.
- Anthropic API for voice-command parsing and design assist (returns JSON only).
- Deploy: Vercel.
- **Units: imperial by default** (feet + inches). Store everything internally in
  a single base unit (inches) and format for display.

## Hard scope for v1

**Semantic entities:** room, wall (with thickness), door, window, furniture
block, text label.
**Voice → drawing (the hero):** speak rooms, walls, doors, windows, furniture
into existence with dimensions; move/resize by voice.
**Manual creation + editing:** draw walls by clicking; drag/rotate/resize
furniture; drag walls; delete. Voice is primary, manual is the fallback/refine.
**Auto-rooms:** when walls enclose a space, detect it as a room, label it,
show square footage live.
**Furniture library:** a starter set of ~20 common blocks (sofa, loveseat,
bed, nightstand, dining table, chairs, fridge, stove, sink, toilet, tub,
vanity, desk, bookshelf, TV stand, rug, plant, etc.) placeable by voice or by
dragging from a palette.
**Smart snapping (no jargon):** walls snap to each other and to 90°/45°;
furniture snaps to walls and to alignment guides. No OSNAP terminology shown to
the user — it just behaves.
**Viewport:** pan, zoom-to-cursor, fit-to-extents.
**Design assist:** "how does this look?" → AI suggestions on layout/circulation
and simple decor/color ideas (assist, not autopilot; preview-then-accept).
**Persistence:** save/load plans to Supabase.
**Export:** PNG and PDF (homeowners want to share a picture, not a CAD file).

## Explicitly OUT of scope for v1

Command line + aliases, xrefs, dynamic blocks, freeze/thaw/isolate layer
management, dimensions/annotation tooling, trim/extend/offset/fillet, arrays,
DXF/DWG import-export, multi-floor, 3D, raw arc/spline drawing, photo input.
(Photo-sketch and room-scan inputs are a strong v2 — see roadmap — but voice is
the v1 hero; don't split focus.)

## Architecture

Separate **model**, **view**, **controller** cleanly.

### Coordinate system
- **World space** in inches. Entities store world coords only.
- **Screen space** in pixels.
- Viewport transform `{ originX, originY, scale }`; route ALL conversions
  through `worldToScreen` / `screenToWorld`. Zoom around the cursor.

### Semantic entity model
Plain serializable objects. Geometry derives from semantic fields.
```ts
type Wall   = { id; type:'wall'; a:Point; b:Point; thickness:number };       // inches
type Room   = { id; type:'room'; wallIds:string[]; name:string };            // derived polygon + area
type Door   = { id; type:'door'; wallId:string; offset:number; width:number; swing:'in'|'out'|'left'|'right' };
type Window = { id; type:'window'; wallId:string; offset:number; width:number };
type Furn   = { id; type:'furniture'; kind:string; position:Point; rotation:number; w:number; h:number };
type Label  = { id; type:'label'; position:Point; text:string; size:number };
```
Doors/windows are anchored TO a wall by offset, so moving the wall moves them.
Rooms are derived from enclosing walls; compute polygon + square footage on
change. Keep behavior (draw, hit-test, snap-points, bbox) in per-type helpers,
not on the objects, so they stay serializable.

### Rendering
Single `render()`: clear → grid → rooms (filled tint + name + sqft) → walls →
doors/windows → furniture → labels → overlays (selection, drag guides, snap
marker, in-progress entity). `requestAnimationFrame`; re-render on any change.
Line widths in screen px (divide by scale) so strokes stay crisp at any zoom.
Make it look friendly: soft grid, rounded furniture icons, readable labels —
this is a consumer tool, not a blueprint.

### Tool state machine
One active tool at a time, exposing `onMouseDown/Move/Up`, `onKeyDown`. ESC
cancels to the select/idle tool. Tools: select/drag, draw-wall, place-furniture.

### Command pattern (undo/redo)
Every mutation is a command with `do()`/`undo()`. AddEntity, DeleteEntities,
TransformEntities, EditWall, PlaceFurniture, ApplyAIBatch. Model mutates ONLY
inside commands. Voice and manual edits both go through this — so AI actions
undo like anything else.

### Smart snapping
On move, gather candidates: wall endpoints, wall faces (for furniture),
90°/45° angle locks, alignment with other furniture edges/centers, grid.
Pick nearest within ~10 screen px. Show a subtle marker/guide. Snapped point
overrides raw cursor for the active tool. Linear scan is fine for v1.

## Voice pipeline (THE HERO — build it early, see phase order)

Flow: mic → transcript → AI parse → ops → commands → render → spoken/printed
confirmation.

1. **Capture:** Web Speech API for v1 (free, in-browser). Allow Whisper API as
   an upgrade path. Show the live transcript.
2. **Parse:** send transcript + a compact snapshot of current state (rooms,
   walls with compass orientation, furniture, selection, cursor) to the
   Anthropic API. System prompt teaches the op vocabulary and the entity schema
   and instructs the model to return ONLY a JSON array of ops:
```json
[
  { "op":"createRoom", "name":"living room", "width":180, "height":240, "at":"cursor" },
  { "op":"placeFurniture", "kind":"sofa", "against":"north wall", "room":"living room" },
  { "op":"addDoor", "wall":"south", "width":36 },
  { "op":"move", "target":"sofa", "to":"northeast corner" }
]
```
   (Dimensions in inches; convert "15 feet" → 180.) Support relational language
   like "against the north wall," "next to the door," "in the corner" — resolve
   these server-/client-side against actual geometry.
3. **Validate:** parse JSON, reject anything off-schema, clamp sizes to sane
   ranges, NEVER eval. Resolve relational refs to concrete coordinates.
4. **Apply:** wrap as a single ApplyAIBatch command (one undo step), render,
   and confirm in plain English ("Added a 15×20 living room with a sofa on the
   north wall."). If a reference is ambiguous, ask a one-line clarifying
   question instead of guessing wildly.

Design the op vocabulary first and test the parser with typed text before
wiring the mic — the mic is just a transcript source.

## Furniture library

Ship ~20 blocks as simple data: `{ kind, defaultW, defaultH, icon }` with a
clean vector icon each and sensible default real-world dimensions (a queen bed
is 60×80in, etc.). Voice places by `kind`; a drag-out palette is the manual
path. Keep it extensible (data-driven) so adding blocks later is trivial.

## Design assist

"How does this look?" / "suggest a layout" → send current plan JSON + a system
prompt loaded with practical principles (circulation/clearances, furniture
spacing, focal points, natural light from windows, balance, simple
color/material harmony). Returns either textual suggestions or a proposed op
batch the user previews and accepts/rejects. **Assist, not autopilot** — never
auto-commit; always preview.

## Data / persistence schema (Supabase)

```sql
create table plans (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users not null,
  name text not null,
  data jsonb not null,   -- { version:1, entities:[], viewport:{}, units:'imperial' }
  thumbnail text,        -- optional data URL for the dashboard
  updated_at timestamptz default now()
);
-- RLS: owner = auth.uid() for all ops
```
Autosave debounced ~2s + manual Save. Version the JSON.

## Brand assets (apply from Phase 1)

Brand files live in `public/brand/`:
- `vocasa-lockup.png` — full logo (mark + wordmark + tagline). Use on the
  landing/home page as the hero brand element.
- `vocasa-icon.svg` — the app icon mark (navy tile). Use as the favicon /
  browser-tab icon and PWA icon. Wire it via the Next.js App Router metadata
  (`icons` in the root layout metadata or an `app/icon.svg`), so it appears in
  the tab corner. Prefer the SVG; generate PNG fallbacks only if needed.
- `vocasa-mark.svg` — the bare navy mark on transparent. Use small, next to
  the "Vocasa" name in the top-left corner of the app header/nav on light
  backgrounds.

Brand color: navy `#1B2A4A` (mark) with gradient `#2C4270 → #131F3B` (icon
tile). Use the navy as the primary brand color in the chrome. Tagline text is
"the voice-powered drafting app".

## UI layout (keep it dead simple — consumer, not pro)

- Big mic button, always visible — the primary action.
- Left: small furniture palette (icons) + a draw-wall button.
- Right: light Properties panel for the current selection (size, rotation,
  name) — plain language, feet/inches.
- Bottom: live transcript + status (cursor coords in ft-in, current room sqft).
- Center: the canvas, friendly styling, fills the space.
- A "Suggest" button for design assist. A Share/Export button (PNG/PDF).
- No layer panel, no command line, no dense toolbars.

## Build order — STOP after each phase for testing

1. **Canvas + viewport.** Full-window canvas, soft grid, pan, zoom-to-cursor,
   fit-to-extents, live ft-in coordinate readout. Lock the coordinate
   transforms down here.
2. **Wall entity + draw-wall tool + render loop + undo/redo.** Click to draw
   walls with thickness; 90°/45° snapping; walls auto-join at endpoints.
3. **Auto-rooms.** Detect enclosed wall loops → room polygon, editable name,
   live square footage.
4. **Furniture library + place/drag/rotate/resize + furniture↔wall snapping.**
5. **Doors & windows** anchored to walls (move the wall, they follow).
6. **AI op bridge.** Define the op vocabulary; implement parse→validate→
   ApplyAIBatch using TYPED text input. Test thoroughly before the mic.
7. **Voice capture** (Web Speech API) feeding the op bridge — the hero feature
   now live end to end.
8. **Design assist** (suggestions + preview-accept).
9. **Save/load to Supabase** + autosave + dashboard thumbnails.
10. **PNG/PDF export + share.**

## v1 acceptance criteria

- I can say "make a 15 by 20 living room" and it appears, labeled, with sqft.
- I can say "put a sofa against the north wall" and "add a door on the south
  wall" and both land correctly and stay attached when I move the wall.
- I can drag/rotate furniture and nudge walls by hand; everything undoes.
- Rooms auto-detect and show square footage as I edit.
- I can save a plan, reload, and load it back identically.
- I can export a clean PNG/PDF to share.
- Voice handles relational phrases ("next to," "in the corner," "north wall").

## Notes / gotchas

- Floating point: snap by screen-pixel threshold, never `===` on points.
- Doors/windows store an offset along their wall, not absolute coords.
- One `render()` path; never draw from event handlers directly.
- AI output is untrusted: validate, clamp, never eval; one ApplyAIBatch = one
  undo step.
- Version the JSON so future schema changes don't break saved plans.

## Photo input — v2 phases (specified now so v1 doesn't block them)

Photo upload is a core part of the product vision: users upload a picture and
Vocasa turns it into an editable floorplan. It is deliberately sequenced AFTER
the v1 voice hero, but it is NOT optional — build v1 so these phases slot in
cleanly. The AI-op bridge from Phase 6 is reused: photos, like voice, produce
the SAME op JSON (createRoom, addWall, placeFurniture...), which is why the
core engine must exist first.

**Phase 16 — Hand-sketch / existing floorplan photo → editable plan.**
Upload a photo of a hand-drawn sketch OR an existing printed floorplan. Send
as base64 to a vision-capable model with the op vocabulary from
docs/voice-parser-packet.md; the model returns ops describing the walls,
rooms, doors, windows it sees. Because a photo alone has no scale, ALWAYS ask
the user for one known dimension ("how wide is this wall / this door?") and
scale all geometry from it. Show the generated plan as a preview the user
accepts before it commits (one ApplyAIBatch = one undo step). The result is a
normal, fully editable Vocasa plan — the user can then refine it by voice or
hand.

**Phase 17 — Real-room photo → plan (scale honesty required).**
Photos of real rooms lose depth/scale; never pretend otherwise. v2 web path:
user marks ONE known reference dimension in the photo (e.g. "this door is 36
inches") and the AI estimates the room layout relative to it, clearly labeled
as an estimate the user should verify. True measured scale is the native iOS
LiDAR/RoomPlan companion path — a later, separate effort.

**Phase 18 — Bridge to the premium redesign modules.**
Once a plan exists (from voice OR photo), the user can attach room photos and
invoke the Design/Landscaping add-on modules (below) to generate restyled
concepts. Flow: photo → floorplan (editable geometry) → redesign renders
(visualization). Keep the two outputs distinct in the UI: plans are editable
and to scale; redesign renders are inspirational images.

## Premium add-on modules (separate paid features — post-core, NOT v1)

These are a DIFFERENT technical capability from the core engine. The core
produces precise, editable, to-scale geometry from cheap text-based AI calls.
These add-ons are **generative image restyling** (image-to-image): upload a
real photo, get a photorealistic re-imagined picture back. They are NOT to
scale and NOT editable geometry — they're aspirational visualization. Each
render is a paid image-model API call (real per-use COGS), so they must be
metered (credits or capped tiers), never unlimited-flat, and priced to cover
cost + margin.

- **Design module (room redesign):** upload a photo of a real room → AI returns
  restyled photorealistic concepts (paint, furniture, decor, materials).
- **Landscaping module (yard redesign):** upload a photo of a yard/exterior →
  AI returns restyled landscape concepts (plants, hardscape, paths, furniture);
  ideally climate/hardiness-zone aware for plant realism.

Pricing note (validate against real COGS): market consumer rate is ~$0.14–0.30
per render, ~$14–29/mo capped tiers, or credit packs (~$9/30, $19/100). Give
2–3 free renders per module as the hook; consider a discounted bundle of both
modules since competitors bundle interior + exterior together.

## LATER roadmap — NOT v1

In rough priority for THIS audience:
- **Style-reference photo** feeding decor suggestions.
- **Richer decor:** paint colors, materials, mood boards, shopping links.
- **Multi-room / whole-floor** plans and multiple floors.
- **Dimensions & annotations** with AI smart-spacing (clean overlap auto-fix).
- **Share/collaborate:** send a read-only link; comments.
- **Export upgrades:** DXF for anyone who wants to hand a pro a real file.
- **Performance at scale (web levers, not "multi-core"):** spatial index
  (quadtree), OffscreenCanvas + Web Workers, dirty-region redraw, WebGL only if
  Canvas2D stops keeping up.
