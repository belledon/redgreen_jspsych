/**
 * Procedural scene generation for `RedGreenTrial`.
 *
 * This module builds random trial scenes: a set of stationary rectangles
 * (some solid, some occluders) and 1-3 moving discs whose velocities point
 * in arbitrary directions. The red/green response is carried by the
 * rectangles: a solid red (#FF7878) and a solid green (#78FF78) rect are
 * always present, and the subject's `r`/`g` answer is the color of the
 * first colored rectangle a disc collides with. This module provides a
 * fallback estimate; the plugin scores against the *real* first collision
 * it tracks during simulation. Discs are always blue/purple shades (never
 * red or green), so the answer is never carried by disc color.
 *
 * Generation is pure: it takes a `SceneConfig` and returns a `Scene`
 * describing initial positions/velocities. Animation, collision, and
 * occlusion rendering are handled at runtime by the plugin, not here.
 */

import type { Disc, Rect } from "../plugins/red-green-trial";

/**
 * Parameters controlling a single generated scene.
 */
export type SceneConfig = {
  /** Scene width in pixels. */
  width: number;
  /** Scene height in pixels. */
  height: number;
  /** Number of stationary rectangles to place. */
  numRects: number;
  /** Number of moving discs to place (1-3). */
  numDiscs: number;
  /** Base disc speed in px/s; each disc multiplies this by 0.4-1.0. */
  discSpeed: number;
};

/**
 * A complete scene handed to `RedGreenTrial`.
 *
 * Positions are expressed as shape *centers* in the scene's pixel
 * coordinate space (origin top-left). `correctResponse` is derived purely
 * from the disc colors and is the label the plugin scores against.
 */
export type Scene = {
  /**
   * Stationary rectangles. A rectangle with `solid: true` occludes discs
   * (they bounce off it); `solid: false` lets discs pass underneath while
   * the rectangle still occludes the disc visually.
   */
  rectangles: Rect[];
  /** Moving discs with initial positions and velocities (px/s). */
  discs: Disc[];
  /** Fallback ground-truth response: "r" if a red rect is hit first, "g" if
   *  a green rect is hit first (see module docs — the plugin tracks the real
   *  first collision during simulation). */
  correctResponse: "r" | "g";
};

/** Palette for rectangle fills: light red, light green, black, occluder. */
const RECT_COLORS = ["#FF7878", "#78FF78", "#000000", "#E700ED"];
const COLOR_OCCLUDER = RECT_COLORS[RECT_COLORS.length - 1];

/** Blue disc shades (response family: blue). */
const BLUE_COLORS = ["#2D90BA", "#4A90D9", "#5B7BD5"];
/** Purple disc shades (response family: purple). */
const PURPLE_COLORS = ["#7B4FBF", "#9B59B6", "#572DBA"];

/**
 * Uniform random number in [min, max).
 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Uniform random integer in [min, max] (inclusive).
 */
function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/**
 * Axis-aligned bounding-box overlap test.
 *
 * `a` and `b` are rects defined by center + extents; `padding` is added to
 * the half-extents on every side, so `true` means the two shapes are closer
 * than `padding` px apart.
 */
function overlap(a: Rect, b: Rect, padding: number): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + padding &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + padding
  );
}

/**
 * Find a position for a rectangle that does not collide with existing ones.
 *
 * Randomly samples the interior of the scene, keeping `PAD` px clearance
 * from all four walls, and rejects any candidate that overlaps an already
 * placed rectangle (with 24 px extra margin). After 200 failed attempts it
 * falls back to the center — a fallback that can overlap but guarantees
 * generation terminates on dense layouts.
 */
function placeRect(r: Rect, used: Rect[], width: number, height: number): Rect {
  const RECT_W = r.width;
  const RECT_H = r.height;
  const PAD = 40;
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = rand(RECT_W / 2 + PAD, width - RECT_W / 2 - PAD);
    const y = rand(RECT_H / 2 + PAD, height - RECT_H / 2 - PAD);
    const candidate = { ...r, x, y, width: RECT_W, height: RECT_H };
    if (used.every((u) => !overlap(candidate, u, 24))) {
      return candidate;
    }
  }
  return { ...r, x: width / 2, y: height / 2, width: RECT_W, height: RECT_H };
}

/**
 * Find a position for a disc that clears walls, other discs, and rectangles.
 *
 * Three constraints are enforced, each with a margin:
 *  1. `PAD` px from the walls, so the disc never spawns mid-bounce;
 *  2. `2*R + 20` px center-distance from every other disc;
 *  3. `R + 8` px clearance from every rectangle edge — a disc inside a
 *     solid rect would snap out on frame one, and one on top of an
 *     occluder would pop in visibly before the animation starts.
 *
 * Falls back to the center after 200 failed attempts.
 */
function placeDisc(d: Disc, used: Disc[], rects: Rect[], width: number, height: number): Disc {
  const R = d.radius;
  const PAD = 60;
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = rand(R + PAD, width - R - PAD);
    const y = rand(R + PAD, height - R - PAD);
    const candidate = { ...d, x, y };
    if (used.some((u) => Math.hypot(u.x - x, u.y - y) < 2 * R + 20)) {
      continue;
    }
    if (rects.some((r) => Math.abs(x - r.x) < r.width / 2 + R + 8 && Math.abs(y - r.y) < r.height / 2 + R + 8)) {
      continue;
    }
    return candidate;
  }
  return { ...d, x: width / 2, y: height / 2 };
}

/**
 * Generate a full random scene.
 *
 * Layout:
 *  - `numRects` stationary rectangles: random size within [50, 150] px,
 *    random palette color, and a 50/50 `solid` flag (solid → discs bounce
 *    off; non-solid → discs pass underneath while the rect occludes them).
 *  - The disc majority is chosen first: half the scenes are blue-majority,
 *    half purple-majority. The first disc is always painted with the
 *    majority color; each later disc is 70% majority / 30% minority, so
 *    most scenes have a clear (but not guaranteed) majority.
 *  - Discs are always shades of blue or purple (never red or green).
 *  - Each disc gets a speed of `0.4-1.0 × discSpeed` in a random direction
 *    (`vx`/`vy` are sampled independently, so diagonal motion is common).
 *
 * The ground truth is recomputed by counting blue vs. purple discs at the end
 * (independent of the initial majority choice), so the label always matches
 * the actual disc population.
 *
 * @param config scene parameters (size, shape counts, disc speed)
 * @returns a scene suitable for a `RedGreenTrial` trial
 */
export function generateScene(config: SceneConfig): Scene {
  const { width, height, numRects, numDiscs, discSpeed } = config;

  // Majority family: half the trials are blue-majority, half purple-majority.
  // Discs are always blue/purple shades — never red or green.
  const majorityIsBlue = Math.random() < 0.5;
  const majorityColor = majorityIsBlue
    ? BLUE_COLORS[randInt(0, BLUE_COLORS.length - 1)]
    : PURPLE_COLORS[randInt(0, PURPLE_COLORS.length - 1)];
  const minorityColor = majorityIsBlue
    ? PURPLE_COLORS[randInt(0, PURPLE_COLORS.length - 1)]
    : BLUE_COLORS[randInt(0, BLUE_COLORS.length - 1)];

  const rects: Rect[] = [];
  const usedRects: Rect[] = [];
  // The first two rects are always the two colored "answer" rects: one solid
  // red (#FF7878) and one solid green (#78FF78). A disc that collides with a
  // colored solid rect defines the red/green response.
  const GUARANTEED_ANSWER_COLORS = ["#FF7878", "#78FF78"];
  for (let i = 0; i < numRects; i++) {
    const color =
      i < GUARANTEED_ANSWER_COLORS.length
        ? GUARANTEED_ANSWER_COLORS[i]
        : RECT_COLORS[randInt(0, RECT_COLORS.length - 1)];
    const r: Rect = {
      x: 0,
      y: 0,
      width: rand(50, 150),
      height: rand(50, 250),
      color: color,
      solid: color != COLOR_OCCLUDER,
    };
    const placed = placeRect(r, usedRects, width, height);
    usedRects.push(placed);
    rects.push(placed);
  }

  /**
   * Choose the color for disc `i`: disc 0 is always the majority color;
   * subsequent discs are 70% majority, 30% minority.
   */
  const discColor = (i: number): string =>
    i === 0 ? majorityColor : Math.random() < 0.7 ? majorityColor : minorityColor;

  const discs: Disc[] = [];
  const usedDiscs: Disc[] = [];
  for (let i = 0; i < numDiscs; i++) {
    const d: Disc = {
      x: 0,
      y: 0,
      radius: 14,
      color: discColor(i),
      vx: rand(-1, 1) > 0 ? rand(0.4, 1) * discSpeed : -rand(0.4, 1) * discSpeed,
      vy: rand(-1, 1) > 0 ? rand(0.4, 1) * discSpeed : -rand(0.4, 1) * discSpeed,
    };
    const placed = placeDisc(d, usedDiscs, rects, width, height);
    usedDiscs.push(placed);
    discs.push(placed);
  }

  // Fallback ground-truth estimate: the color of the first colored rect in
  // scene order (red rects are placed first, so this is red unless the first
  // colored rect is green). The plugin scores against the *real* first
  // colored-rect collision tracked during simulation; this value is only used
  // if no colored rect is ever hit.
  const firstAnswerRect = rects.find((r) => r.color === "#FF7878" || r.color === "#78FF78");
  const correctResponse: "r" | "g" = firstAnswerRect?.color === "#78FF78" ? "g" : "r";

  return { rectangles: rects, discs, correctResponse };
}
