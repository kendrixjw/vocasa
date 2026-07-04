# Phase 6 Build Packet — Voice / Text Command Parser

This is the brain of the product: it turns a homeowner's words into structured
operations the engine executes. Build and test this with **typed text** before
wiring the microphone (Phase 7). The mic is just a transcript source; this packet
is the hard, valuable part.

Architecture recap: the AI never computes exact coordinates and never emits
images. It emits **symbolic operations** referencing things like "the north wall"
or "the sofa." Your client-side **resolver** turns those symbols into real
coordinates against the current scene. The AI is good at intent; your code is
good at arithmetic. Keep that division.

---

## 1. The context snapshot (what you send the model every call)

Send a compact JSON snapshot of the current scene alongside the user's words, so
the model can resolve references. Round all coords to integers (inches).

```json
{
  "units": "inches",
  "cursor": { "x": 120, "y": 60 },
  "selection": ["furn_3"],
  "rooms": [
    {
      "id": "room_1",
      "name": "living room",
      "bounds": { "x": 0, "y": 0, "w": 180, "h": 240 },
      "walls": { "north": "wall_1", "east": "wall_2", "south": "wall_3", "west": "wall_4" }
    }
  ],
  "walls":     [ { "id": "wall_1", "orientation": "north", "a": {"x":0,"y":0}, "b": {"x":180,"y":0} } ],
  "doors":     [ { "id": "door_1", "wall": "wall_3", "width": 36 } ],
  "windows":   [],
  "furniture": [ { "id": "furn_3", "kind": "sofa", "position": {"x":90,"y":18}, "rotation": 0 } ]
}
```

Keep it lean — only what's needed to resolve references. For large scenes you can
omit faraway entities, but always include everything named in the user's sentence
if you can detect it.

---

## 2. Output: the operation schema (what the model returns)

The model returns **ONLY** a JSON array of ops. No prose, no markdown fences.

```ts
type Op =
  | { op: 'createRoom';     name: string; width: number; height: number; anchor?: Anchor }
  | { op: 'addWall';        from: PointOrAnchor; to: PointOrAnchor; thickness?: number }
  | { op: 'addDoor';        wall: Ref; width?: number; along?: Along; swing?: 'in'|'out'|'left'|'right' }
  | { op: 'addWindow';      wall: Ref; width?: number; along?: Along }
  | { op: 'placeFurniture'; kind: string; anchor: Anchor; rotation?: number; width?: number; height?: number }
  | { op: 'move';           target: Ref; to: Anchor }
  | { op: 'resize';         target: Ref; width?: number; height?: number }
  | { op: 'rotate';         target: Ref; degrees: number }
  | { op: 'delete';         target: Ref }
  | { op: 'rename';         target: Ref; name: string }
  | { op: 'clarify';        question: string };   // when genuinely ambiguous

type Along = 'center' | 'left' | 'right' | number;   // number = inches from wall start

type Anchor =
  | { at: 'cursor' }
  | { room: string; against: 'north'|'south'|'east'|'west'|'center' }
  | { corner: 'northeast'|'northwest'|'southeast'|'southwest'; room?: string }
  | { nextTo: Ref; side: 'left'|'right'|'above'|'below' }
  | { x: number; y: number };                         // absolute, only if user is explicit

type Ref =
  | { id: string }
  | { kind: string; room?: string }                   // "the sofa", "the sofa in the bedroom"
  | { selection: true }                               // "it", "this", "the selected one"
  | { last: true }                                    // "it" right after creating something
  | { wallOf: string; side: 'north'|'south'|'east'|'west' };  // "the north wall of the living room"

type PointOrAnchor = { x: number; y: number } | Anchor;
```

---

## 3. THE SYSTEM PROMPT (paste this into the API call, fill the snapshot)

> You convert a homeowner's spoken instruction into structured operations for
> Vocasa, a 2D home-sketching app. Output **ONLY** a JSON array of operations — no prose, no
> explanation, no markdown code fences. If you truly cannot proceed, output a
> single `clarify` operation.
>
> You think in a simple home-design vocabulary: rooms, walls, doors, windows, and
> furniture. **Every dimension you output is in INCHES.** Convert the user's
> words: feet → inches (× 12); "15 by 20" means 15 ft × 20 ft → width 180,
> height 240. When the user omits a size, use sensible real-world defaults:
> interior door 32, entry door 36, window 36, sofa 84×36, loveseat 60×36, queen
> bed 60×80, king bed 76×80, twin bed 38×75, nightstand 24×18, dining table
> 72×40, dining chair 18×18, desk 48×24, fridge 36×30, range 30×26, kitchen sink
> 30×22, toilet 28×20, tub 60×30, vanity 36×21, bookshelf 36×12, TV stand 60×16,
> coffee table 48×24, area rug 96×60.
>
> You receive the current scene as JSON context: rooms (each with a name, bounds,
> and named walls north/east/south/west), walls, doors, windows, furniture, the
> cursor position, and the current selection. Use it to resolve references like
> "the living room," "the north wall," "the sofa," "it" (= the selection), "there"
> (= the cursor), or "it" right after you created something (= last).
>
> Allowed operations and their fields are defined by the schema you were given
> (createRoom, addWall, addDoor, addWindow, placeFurniture, move, resize, rotate,
> delete, rename, clarify). Allowed anchors and references are defined there too.
>
> Rules:
> - Output a JSON array, even for a single operation.
> - **Prefer symbolic anchors and references over raw coordinates.** The app
>   resolves anchors to exact positions. Only output absolute `{x, y}` when the
>   user states an explicit position.
> - Use the fewest operations that satisfy the request. A sentence can become
>   several ops ("a 12×12 bedroom with a bed and a door" = createRoom +
>   placeFurniture + addDoor).
> - Never invent a room or wall that doesn't exist in the scene just to place
>   something. If the needed target is missing or the reference is ambiguous
>   (e.g., two sofas and the user says "the sofa"), output one `clarify` op with a
>   short, specific question instead of guessing.
> - Room and furniture names are lowercase ("living room", "primary bedroom").
> - If the instruction isn't about drawing (chit-chat, a question), output a
>   single `clarify` op that briefly redirects.
>
> Current scene:
> ```json
> {{SNAPSHOT}}
> ```
>
> User said: "{{TRANSCRIPT}}"

---

## 4. Worked examples (use as few-shot in the prompt OR as your test suite)

**"Make a living room fifteen by twenty"**
```json
[{ "op": "createRoom", "name": "living room", "width": 180, "height": 240, "anchor": { "at": "cursor" } }]
```

**"Put a sofa against the north wall"** (living room exists)
```json
[{ "op": "placeFurniture", "kind": "sofa", "anchor": { "room": "living room", "against": "north" } }]
```

**"Add a three foot door on the south wall"**
```json
[{ "op": "addDoor", "wall": { "wallOf": "living room", "side": "south" }, "width": 36, "along": "center" }]
```

**"Move it to the corner"** (something is selected)
```json
[{ "op": "move", "target": { "selection": true }, "to": { "corner": "northeast" } }]
```

**"Make a twelve by twelve bedroom with a queen bed against the north wall and a door on the east wall"**
```json
[
  { "op": "createRoom", "name": "bedroom", "width": 144, "height": 144, "anchor": { "at": "cursor" } },
  { "op": "placeFurniture", "kind": "bed", "width": 60, "height": 80, "anchor": { "room": "bedroom", "against": "north" } },
  { "op": "addDoor", "wall": { "wallOf": "bedroom", "side": "east" }, "width": 32, "along": "center" }
]
```

**"Move the sofa"** (scene contains two sofas → ambiguous)
```json
[{ "op": "clarify", "question": "There are two sofas — the one in the living room or the den?" }]
```

---

## 5. Client-side resolver — what YOUR code must implement

After parsing/validating the JSON, resolve every symbolic field to concrete
geometry before building commands. Implement a resolver for each:

**References (`Ref`) → a concrete entity:**
- `{id}` → look up directly.
- `{selection:true}` → current selection (error/clarify if empty or multiple).
- `{last:true}` → most recently created entity this session.
- `{kind, room?}` → find entities of that kind (optionally within the named
  room). Zero matches → clarify "I don't see a {kind}". Multiple → clarify.
- `{wallOf, side}` → the named room's wall on that side (from `room.walls`).

**Anchors (`Anchor`) → an `{x, y}` (and orientation where relevant):**
- `{at:'cursor'}` → current cursor world position.
- `{room, against}` → compute against that room's named wall: place the item
  flush to the wall's interior face, centered along it (offset by half the item's
  depth). `center` = room centroid.
- `{corner, room?}` → the room's interior corner (inset by the item's half-size
  so it doesn't overlap walls).
- `{nextTo, side}` → resolve the ref, then offset by that entity's half-size +
  the new item's half-size on the given side, with a small gap.
- `{x, y}` → use as-is.

**Doors/windows `along`:** `'center'` = midpoint of the wall; `'left'`/`'right'`
= near that end with an inset; a number = inches from the wall's start point
(`a`). Store the door/window as an offset along the wall (per the main spec) so it
follows the wall if the wall moves.

**Validation before applying (untrusted output):**
- Reject any op not in the schema; reject unknown anchor/ref shapes.
- Clamp dimensions to sane ranges (e.g. rooms 24–1200 in, furniture 6–600 in).
- If any reference fails to resolve, convert the whole batch into a `clarify`
  message to the user rather than partially applying.
- Wrap the resolved batch as ONE `ApplyAIBatch` command = one undo step.
- Never `eval`. Never trust coordinates without clamping.

**Confirmation:** after applying, print/speak a plain-English summary
("Added a 15×20 living room with a sofa on the north wall.") built from the ops,
not from the model's prose (there is none).
