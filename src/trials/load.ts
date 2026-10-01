/**
 * Trial loading for RedGreenAttention.
 *
 * Random procedural generation is great for debugging, but for a real
 * experiment every subject must see the identical stimulus set. This module
 * loads trials from an external, serialized file so the exact scene +
 * parameter for each trial can be authored (or exported by a design tool)
 * ahead of time and pinned for all subjects.
 *
 * Supported formats:
 *
 *   1. **JSON trial list** (recommended, one object per trial):
 *        [
 *          { "rectangles": [...], "discs": [...], "duration": 4000,
 *            "prompt": "Red or Green?", "choices": ["r","g"],
 *            "response_mode": "slider", "correct_response": "r",
 *            "probe_interval": 2500, ... },
 *          ...
 *        ]
 *      Each entry is a complete scene + parameter set. Omitted parameters
 *      fall back to the plugin's defaults.
 *
 *   2. **Generator-config list** (each entry is a SceneConfig):
 *        [
 *          { "width": 800, "height": 600, "numRects": 8, "numDiscs": 2,
 *            "discSpeed": 140 },
 *          ...
 *        ]
 *      Each entry is procedural (random), so this is useful for
 *      debugging/development. For a real experiment use form (1).
 *
 *   Format is detected automatically from the entry shape.
 *
 * Usage:
 *   - `?trials=path/to/file.json` URL parameter (path relative to `public/`)
 *   - otherwise the module reads `{base}/trials/trials.json` if present.
 *
 * @author Mario Belledonne
 */

import type { Disc, Rect } from "../plugins/red-green-trial";
import { generateScene } from "../scenes";
import type { SceneConfig } from "../scenes";

/** Full plugin parameter set, mirroring RedGreenTrial's `info.parameters`. */
export type TrialSpec = {
  rectangles?: Rect[];
  discs?: Disc[];
  duration?: number;
  response_mode?: "slider" | "empty" | "localize";
  choices?: string[];
  slider_range?: number[];
  slider_label_left?: string;
  slider_label_right?: string;
  slider_button_label?: string;
  slider_require_moved?: boolean;
  prompt?: string;
  correct_response?: string;
  scene_width?: number;
  scene_height?: number;
  background?: string;
  probe_target?: "object" | "disc" | "rect";
  probe_interval?: number;
  probe_duration?: number;
  probe_first_after?: number;
  probe_key?: string | string[];
  probe_flash_intensity?: number;
  probe_flash_duration?: number;
};

/** A generator-based trial entry (procedural scene). */
export type GeneratorTrialSpec = SceneConfig & { params?: TrialSpec };

export type LoadedTrial = TrialSpec & { type: "red-green-trial" };

/** Generated fallback defaults that mirror the plugin's parameter defaults. */
const DEFAULTS: Omit<TrialSpec, "correct_response" | "choices" | "rectangles" | "discs" | "prompt"> = {
  duration: 4000,
  response_mode: "slider",
  slider_range: [0, 6],
  slider_label_left: `<span style="color: red;">RED</span>`,
  slider_label_right: `<span style="color: green;">GREEN</span>`,
  slider_button_label: "Submit",
  slider_require_moved: false,
  scene_width: 800,
  scene_height: 600,
  background: "#ffffff",
  probe_target: "object",
  probe_interval: 0,
  probe_duration: 100,
  probe_first_after: 1000,
  probe_key: [" "],
  probe_flash_intensity: 0.5,
  probe_flash_duration: 250,
};

/** Validate a single trial spec and throw on missing/invalid fields. */
export function validateTrial(spec: TrialSpec): void {
  if (!Array.isArray(spec.rectangles)) {
    throw new Error("trial spec missing `rectangles` (array of rects)");
  }
  if (!Array.isArray(spec.discs) || spec.discs.length === 0) {
    throw new Error("trial spec missing `discs` (non-empty array of discs)");
  }
  if (spec.response_mode && !["slider", "empty", "localize"].includes(spec.response_mode)) {
    throw new Error(`invalid response_mode "${spec.response_mode}"`);
  }
  if (spec.response_mode === "slider") {
    const range = spec.slider_range ?? DEFAULTS.slider_range;
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error("slider_range must be a [min, max] pair");
    }
    if (!(range[0] < range[1])) {
      throw new Error("slider_range requires min < max");
    }
  }
  if (spec.response_mode && spec.response_mode === "localize" && spec.discs.length < 1) {
    throw new Error("localize mode requires at least one disc to hide");
  }
}

/** Merge a trial spec with defaults and ensure plugin identity. */
export function normalizeTrial(spec: TrialSpec): LoadedTrial {
  validateTrial(spec);
  const merged: LoadedTrial = {
    type: "red-green-trial",
    ...DEFAULTS,
    ...spec,
  };
  if (spec.correct_response !== undefined) merged.correct_response = spec.correct_response;
  if (spec.choices !== undefined) merged.choices = spec.choices;
  if (spec.prompt !== undefined) merged.prompt = spec.prompt;
  return merged;
}

/** Load a JSON trial-spec file (URL or file path) into normalized trials. */
export async function loadTrialsFromURL(url: string): Promise<LoadedTrial[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to load trials from ${url}: HTTP ${res.status}`);
  }
  const raw = await res.json();
  return parseTrials(raw);
}

/** Convert an arbitrary JSON value into a validated list of trials. */
export function parseTrials(raw: unknown): LoadedTrial[] {
  if (!Array.isArray(raw)) {
    throw new Error("trials file must be a JSON array");
  }
  return raw.map((entry, i) => {
    if (isGeneratorEntry(entry)) {
      // Generator form: procedural scene + optional overrides.
      const config: SceneConfig = {
        width: entry.width,
        height: entry.height,
        numRects: entry.numRects,
        numDiscs: entry.numDiscs,
        discSpeed: entry.discSpeed,
      };
      const scene = generateScene(config);
      const spec: TrialSpec = {
        ...(entry.params ?? {}),
        rectangles: scene.rectangles,
        discs: scene.discs,
        correct_response: scene.correctResponse,
        scene_width: config.width,
        scene_height: config.height,
      };
      return normalizeTrial(spec);
    }
    return normalizeTrial(entry as TrialSpec);
  });
}

/** Heuristic: does an entry look like a SceneConfig (procedural) rather than a TrialSpec? */
function isGeneratorEntry(entry: unknown): entry is GeneratorTrialSpec {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.numRects === "number" &&
    typeof e.numDiscs === "number" &&
    typeof e.width === "number" &&
    typeof e.height === "number"
  );
}

/** Resolve which trials source to use: URL param, then default file. */
export async function resolveTrialsSource(): Promise<LoadedTrial[] | null> {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("trials");
  if (explicit) {
    return loadTrialsFromURL(explicit);
  }
  // Default: a static file in the deployed site's root (public/trials).
  const defaultPath = `${import.meta.env.BASE_URL}trials/trials.json`;
  try {
    return await loadTrialsFromURL(defaultPath);
  } catch {
    return null; // No default file: fall back to procedural generation.
  }
}
