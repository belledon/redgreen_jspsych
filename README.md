# Red/Green Attention

A sustained-attention psychophysics experiment built on [jsPsych](https://www.jspsych.org) 8.x
and [Vite](https://vitejs.dev). It is a rewrite of the CNCL
[`ib-jspsych`](https://github.com/CNCLgithub/ib-jspsych) paradigm with two changes:

1. **Standard build setup** — `jspsych-builder` is replaced by Vite. The experiment is a
   plain static Vite app (`index.html` → `src/main.ts`), so you can run it locally, deploy it
   anywhere, or bundle it into [JATOS](https://www.jatos.org).
2. **A new `RedGreenTrial` plugin** — instead of precomputed protobuf frame data and
   `anime.js` keyframes, scenes are described declaratively and rendered live by a small
   2-D physics loop.

## Task

Each trial shows a scene (800 × 600 px) for a fixed duration (3–5 s):

- **Discs** (1–3) move in linear trajectories and bounce off the world boundaries and off
  **solid** rectangles. Discs are always blue/purple shades (never red or green).
- **Rectangles** are stationary and either:
  - `solid: true` — discs bounce off them (a wall), or
  - `solid: false` — discs pass underneath them; the rectangle *occludes* the disc
    (z-order paints occluders above discs).
- Every scene contains at least one solid **red** (`#FF7878`) and one solid **green**
  (`#78FF78`) rectangle — the answer targets.
- After the animation closes, the subject sees **“Red or Green?”** and responds with a
  key: **`r`** if a disc first collided with a **red** rectangle, **`g`** if it first
  collided with a **green** rectangle. The response ends the trial.
- Ground truth is the color of the first solid colored rectangle any disc collides
  with, tracked live by the plugin during simulation (`first_collision_color`).

## Quick start

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check + production bundle in dist/
pnpm preview    # serve the production build
```

The participant presses **Start** (fullscreen is requested), runs ~12 trials, optionally
leaves a comment, and a CSV of all data is downloaded at the end.

## The `RedGreenTrial` plugin

Source: [`src/plugins/red-green-trial.ts`](src/plugins/red-green-trial.ts).
Registered like any jsPsych plugin. Key parameters:

| Parameter            | Type    | Default        | Meaning                                             |
| -------------------- | ------- | -------------- | --------------------------------------------------- |
| `rectangles`         | Array   | `[]`           | `{x, y, width, height, color, solid}`               |
| `discs`              | Array   | `[]`           | `{x, y, radius, color, vx, vy}`                     |
| `duration`           | Int     | `4000`         | Animation length in ms (3–5 s)                      |
| `response_mode`      | String  | `"empty"`      | `"empty"` (keyboard) or `"localize"` (click)       |
| `choices`            | Keys    | `["r","g"]`    | Accepted response keys (empty mode)                 |
| `prompt`             | String  | `Red or Green?`| Question text                                       |
| `correct_response`   | String  | —              | Authored hint; the plugin scores the real first-collision color |
| `scene_width`/`height`| Int    | 800 / 600      | Scene dimensions                                    |
| `background`         | String  | `#ffffff`      | Scene background                                    |
| `probe_target`       | String  | `"object"`     | Probe target: `"object"` (disc or rect), `"disc"`, `"rect"` |
| `probe_interval`     | Int     | `0`            | Min gap between runtime probes (ms); `0` disables probes |
| `probe_duration`     | Int     | `100`          | How long each probe is shown (ms)                   |
| `probe_first_after`  | Int     | `1000`         | Earliest a probe may appear (ms after animation start) |
| `probe_key`          | Keys    | `[" "]`        | Key that counts as a probe response (default space bar) |
| `probe_flash_intensity` | Float | `0.5`        | Border flash strength (0–1) when probe_key pressed |
| `probe_flash_duration`  | Int   | `250`         | Border flash duration (ms)                          |

### Response modes

- **`"empty"` (default)** — After the animation, the whole scene disappears and
  the subject sees the prompt (e.g. “Red or Green?”). They respond with a
  keyboard key. Data: `response` is the key, `correct` is computed against the
  first colored-rect collision the plugin tracked (`first_collision_color`),
  falling back to `correct_response` only if no colored rect was hit.
- **`"localize"`** — The scene stays on screen; exactly one disc disappears and
  the subject clicks on the position where that disc was last seen. The click
  ends the trial. Data: `response` is `{x, y}` in scene coordinates, and
  `hidden_disc` records the true hidden disc position/color for scoring.

### Runtime probes

When `probe_interval > 0`, a small white disc (~1/3 the size of a normal disc)
appears for `probe_duration` ms (~100 ms) centered on one of the objects (disc
or rectangle, per `probe_target`). Probes are scheduled at least `probe_interval`
ms apart (recommend ≥ 2500 ms), start no earlier than `probe_first_after`, and
are never scheduled so they would still be visible when the animation ends.
`probes` holds the ground truth: `{object_type, object_index, x, y, t}` where
`object_index` indexes into `scene.rectangles` or `scene.discs` (depending on
`object_type`). Plus `probe_count`.

**Probe responses:** during the **entire animation window**, every press of
`probe_key` (default space bar) is recorded as a timestamp (ms from animation
start) in `probe_response`. The display border flashes briefly and mildly
(`probe_flash_intensity` strength for `probe_flash_duration` ms) as visual
feedback on **every** press, whether or not it coincided with a probe. Human
responses are intentionally kept separate from the ground-truth `probes`; match
them later by comparing `probe_response` timestamps against probe `t`s.

Data written per trial: `rt`, `response`, `correct`, `response_mode`,
`animation_duration`, `probes`, `probe_response`, `probe_count`, and a full
`scene` snapshot (rectangles + discs with final positions/velocities) so the
exact stimulus can be reconstructed from data.

### Coordinate system

Positions are the **center** of the shape, in px, relative to the top-left of the scene.

### Physics

Each disc integrates `x += vx·dt`, `y += vy·dt` per frame (`requestAnimationFrame`, dt
clamped to 33 ms during tab switches). It reflects off the world edges and off solid
rectangles:

- **Edge contact** (closest point on the rectangle to the disc center) → reflect velocity
  about the contact normal; separate along the normal.
- **Center inside a rectangle** (spawn/teleport edge case) → push out along the
  least-penetration axis.

Non-solid rectangles never affect motion.

### Occlusion

`solid: false` rectangles are occluders: they are painted **after** the discs so a disc
passing underneath is hidden by the rectangle. `solid: true` rectangles only show on top
when the disc would be behind them, which cannot happen because the disc bounces.

## Scenes

[`src/scenes/index.ts`](src/scenes/index.ts) generates random scenes:

- 8 rectangles placed non-overlapping; the first two are always solid **red** and
  solid **green** (the answer rects), the rest random (black/gray/occluder, ~50% solid).
- 1–3 discs, always shades of blue or purple (never red or green).
- `correctResponse` is a fallback estimate (the first colored rect in scene order);
  the plugin scores the actual first collision it tracks during simulation.
- Spawn positions avoid overlapping any rectangle (no first-frame snap) and keep discs
  apart.

Adjust the trial count, timings, and scene parameters in [`src/main.ts`](src/main.ts).

## Loading trials from a file

Random generation is great for debugging, but for a real experiment every
subject must see the identical scene set. The experiment supports loading
trials from a serialized JSON file:

- **`?trials=path/to/trials.json`** URL parameter (path relative to the
  deployed site root), or
- **`public/trials/trials.json`** at build time — copied into `dist/` and
  loaded automatically if present.

### File format

A JSON **array**, one object per trial:

```json
[
  {
    "type": "red-green-trial",
    "rectangles": [ { "x": 150, "y": 150, "width": 120, "height": 80, "color": "#FF7878", "solid": true },
                     { "x": 650, "y": 480, "width": 120, "height": 80, "color": "#78FF78", "solid": true } ],
    "discs":     [ { "x": 100, "y": 100, "radius": 14, "color": "#2D90BA", "vx": 120, "vy": 90 } ],
    "duration": 4000,
    "response_mode": "empty",
    "choices": ["r", "g"],
    "prompt": "Red or Green?",
    "correct_response": "r",
    "probe_interval": 2500
  }
]
```

Every field accepts the same values as the plugin parameters (see the
table above). Omitted fields fall back to the plugin defaults. `rectangles`
and a non-empty `discs` are required; in `localize` mode a disc is hidden
for the click response, so `discs` must contain at least one entry.

A **generator-config** form is also accepted — instead of full trial
specs, each entry is a `SceneConfig` (`width`, `height`, `numRects`,
`numDiscs`, `discSpeed`) with an optional `params` object of overrides:

```json
[
  { "width": 800, "height": 600, "numRects": 8, "numDiscs": 2, "discSpeed": 140,
    "params": { "response_mode": "localize" } }
]
```

This is mainly useful for testing/resizing. For a published experiment,
author the full trial-list form so every subject sees identical stimuli.

If no file is provided (no `?trials=` and no `public/trials/trials.json`),
the experiment starts in **debug mode** with N_TRIALS random trials.

## File layout

```
index.html
vite.config.ts
tsconfig.json
public/trials/trials.json     # optional: fixed trial set (copied to dist/)
src/
  main.ts                    # jsPsych timeline
  styles/main.css
  plugins/red-green-trial.ts # the plugin
  scenes/index.ts            # procedural scene generator
  trials/load.ts             # trial-file loader/validator
trials/trials.json           # optional: source trial spec (not deployed)
fixtures/red-green-trial-spec.json  # example trial spec
scripts/jatos.mjs             # JZIP packaging script (pnpm jatos)
jatos/                        # generated .jzip packages (gitignored)
dist/                        # production build (gitignored)
```

## Deployment / JATOS

### Building

`pnpm build` produces a fully static `dist/` (relative asset URLs, so it works from
any static server or inside JATOS). Data is written via `jsPsych.data.get().csv()`
and downloaded when the experiment finishes.

### Packaging for JATOS

```bash
pnpm jatos              # build, then package -> jatos/<name>-<YYYYMMDDHHMM>.jzip
pnpm jatos -- --no-build   # package the existing dist/ only
```

This produces a [JZIP](https://www.jatos.org/JATOS-Study-Archive-JZIP.html) study
archive:

```
redgreen-attention-20261001T1217.jzip
├── redgreen-attention/        study assets directory (= dirName in the .jas)
│   ├── index.html
│   ├── assets/…
│   └── trials/trials.json
└── redgreen-attention.jas     study properties (JSON)
```

Import it in JATOS via **Studies → Import study**.

**Overwrite protection.** Every package contains *fresh* study/component/batch
UUIDs. JATOS identifies a study by UUID, so importing a rebuilt package always
creates a **new** study rather than overwriting an existing one — delete old
studies from the JATOS GUI when they are no longer needed. Additionally, the
output file name is timestamped; if it already exists, the script asks for
confirmation before replacing it.

Alternatively, host `dist/` on any static web server.
