import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

/**
 * RedGreenTrial
 *
 * A sustained-attention psychophysics trial in the style of the CNCL
 * `ib-jspsych` event-counting/IB paradigm, but rendered live from a scene
 * description rather than from precomputed protobuf frames.
 *
 * Scene:
 *   - Some number of simple shapes. Rectangles (colored or black) are
 *     stationary; they may be "solid" (discs bounce off them) or
 *     "occluder" (discs pass underneath; the rectangle occludes them).
 *   - 1-3 discs move in linear trajectories and bounce off the world
 *     boundaries and any solid rectangles.
 *
 * Trial-end response modes (choose one via `response_mode`):
 *   1. "slider" (default): the whole scene disappears; the subject sees the
 *      question (e.g. "Red or Green?") and answers with a 7-point confidence
 *      slider, "Confident red" on the left end and "Confident green" on the
 *      right. `response` is the slider value (0-6) and `response_label` its
 *      mapped category ("r" for 0-2, "g" for 4-6, null at the midpoint 3).
 *   2. "empty": the whole scene disappears; the subject sees the question and
 *      responds with the keyboard (`choices`, default r/g).
 *   3. "localize": the scene stays; exactly one disc disappears, and the
 *      subject clicks on the position where that disc was last seen. The
 *      click ends the trial with response = {x, y} in scene coordinates and
 *      `hidden_disc` records the true hidden-disc position for scoring.
 *
 * Optional runtime probes (enabled when `probe_interval` > 0):
 *   During the animation, a small white disc (~1/3 the size of a normal
 *   disc) appears for `probe_duration` ms (~100 ms) centered on one of the
 *   objects (disc or rectangle). Probes are scheduled at least
 *   `probe_interval` ms apart (recommended >= 2500), starting at
 *   `probe_first_after` ms; a probe is never scheduled that would still be
 *   visible when the animation ends.
 *
 *   During the animation, the subject may press the space bar (`probe_key`,
 *   default " ") at any time to signal that they saw a probe. Every press
 *   is recorded as a timestamp (ms from animation start) in `probe_response`,
 *   and the display border flashes briefly as visual feedback, whether or not
 *   the press coincided with a probe. The `probes` array holds only ground
 *   truth: which object each probe appeared on (`object_type`, `object_index`
 *   into `scene.rectangles`/`scene.discs`), its position at onset (x, y) and
 *   onset time (t).
 *
 * Data written per trial:
 *   - rt, response (key, slider value, or {x, y}), correct, response_mode,
 *     animation_duration; in slider mode also response_label ("r"/"g"/null),
 *     slider_moved, slider_midpoint
 *   - first_collision_color ("r"/"g"/null), first_collision_time, first_collision_rect_index
 *   - probes (ground truth, see above) and probe_count
 *   - probe_response (timestamps of probe-key presses during the animation)
 *   - a full serialization of the scene (rectangles + discs), so the exact
 *     stimulus can be reconstructed from the data alone.
 *
 * Scoring: in empty and slider modes the ground-truth answer is the color
 * ("r" = red, "g" = green) of the first solid colored rectangle a disc
 * collides with during the animation. The plugin tracks this in real time;
 * if no colored rect is ever hit, `correct` is null. The `correct_response`
 * parameter is treated as a fallback hint only (authored trials may still
 * provide one). In slider mode the midpoint maps to response_label null, so
 * `correct` is null for unsure responses.
 *
 * @author Mario Belledonne
 */
const info = <const>{
  name: "red-green-trial",
  version: "0.2.0",
  parameters: {
    /** Rectangles that stay fixed in the scene. */
    rectangles: {
      type: ParameterType.COMPLEX,
      default: [],
    },
    /** The moving discs. */
    discs: {
      type: ParameterType.COMPLEX,
      default: [],
    },
    /** Animation duration in ms (3-5 s recommended). */
    duration: {
      type: ParameterType.INT,
      default: 4000,
    },
    /** Trial-end response mode: "slider" (default), "empty" (keyboard) or "localize" (click). */
    response_mode: {
      type: ParameterType.STRING,
      default: "slider",
    },
    /** Slider scale in slider mode: min, max, step (default 0-6). The midpoint
     *  maps to response_label null ("unsure"); below it "r", above it "g". */
    slider_range: {
      type: ParameterType.INT,
      array: true,
      default: [0, 6],
    },
    /** Label shown at the left end of the slider. */
    slider_label_left: {
      type: ParameterType.HTML_STRING,
      default: `<span style="color: red;">RED</span>`,
    },
    /** Label shown at the right end of the slider. */
    slider_label_right: {
      type: ParameterType.HTML_STRING,
      default: `<span style="color: green;">GREEN</span>`,
    },
    /** Button label that confirms the slider response. */
    slider_button_label: {
      type: ParameterType.STRING,
      default: "Submit",
    },
    /** If true, the Continue button stays disabled until the slider is moved
     *  (mirrors jsPsych's slider-response `require_moved`). */
    slider_require_moved: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** Key(s) accepted as a response (characters or event.key names). */
    choices: {
      type: ParameterType.KEYS,
      default: ["r", "g"],
    },
    /** Question shown after the animation closes (empty mode). */
    prompt: {
      type: ParameterType.HTML_STRING,
      default: "Red or Green?",
    },
    /** Correct response; if provided, `correct` is computed. */
    correct_response: {
      type: ParameterType.STRING,
      default: undefined,
      optional: true,
    },
    /** Width of the scene area in px. */
    scene_width: {
      type: ParameterType.INT,
      default: 800,
    },
    /** Height of the scene area in px. */
    scene_height: {
      type: ParameterType.INT,
      default: 600,
    },
    /** Background color of the scene. */
    background: {
      type: ParameterType.STRING,
      default: "#ffffff",
    },
    /**
     * Runtime probe target: "object" (disc or rectangle), "disc", "rect".
     */
    probe_target: {
      type: ParameterType.STRING,
      default: "object",
    },
    /**
     * Minimum gap between probes in ms (>= 2500 recommended); 0 disables
     * probes entirely.
     */
    probe_interval: {
      type: ParameterType.INT,
      default: 0,
    },
    /** How long each probe is shown, in ms (~100 recommended). */
    probe_duration: {
      type: ParameterType.INT,
      default: 100,
    },
    /** Time after animation start at which the first probe may appear. */
    probe_first_after: {
      type: ParameterType.INT,
      default: 1000,
    },
    /**
     * Key that counts as a "saw the probe" response while a probe is
     * visible (default is the space bar). Accepts a single event.key value
     * or an array of values.
     */
    probe_key: {
      type: ParameterType.KEYS,
      default: [" "],
    },
    /**
     * How strongly the display border flashes when probe_key is pressed
     * during a probe (0 = no flash, 1 = strongest).
     */
    probe_flash_intensity: {
      type: ParameterType.FLOAT,
      default: 0.5,
    },
    /**
     * How long the border flash lasts, in ms.
     */
    probe_flash_duration: {
      type: ParameterType.INT,
      default: 250,
    },
  },
  data: {
    /** Response time in ms, measured from the moment the question appears. */
    rt: {
      type: ParameterType.INT,
    },
    /** The key the subject pressed (or click coordinates in localize mode). */
    response: {
      type: ParameterType.COMPLEX,
    },
    /** True if `response` matches `correct_response`. */
    correct: {
      type: ParameterType.BOOL,
    },
    /** Which trial-end response mode was used. */
    response_mode: {
      type: ParameterType.STRING,
    },
    /** In localize mode, the disc that was hidden (position, color, ...). */
    hidden_disc: {
      type: ParameterType.COMPLEX,
    },
    /** Animation duration actually shown, in ms. */
    animation_duration: {
      type: ParameterType.INT,
    },
    /** Runtime probes (ground truth): array of {object_type, object_index, x, y, t}. */
    probes: {
      type: ParameterType.COMPLEX,
    },
    /** Timestamps (ms from animation start) of probe-key presses during the animation. */
    probe_response: {
      type: ParameterType.COMPLEX,
    },
    /** Number of probes shown this trial. */
    probe_count: {
      type: ParameterType.INT,
    },
    /** Frozen copy of the scene configuration used for this trial. */
    scene: {
      type: ParameterType.COMPLEX,
    },
  },
};

type Info = typeof info;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** When false the disc passes underneath (the rectangle occludes it). */
  solid: boolean;
};

export type Disc = {
  x: number;
  y: number;
  radius: number;
  color: string;
  vx: number;
  vy: number;
};

type Body = {
  kind: "rect" | "disc";
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  color: string;
  solid: boolean;
  el: HTMLDivElement;
  vx: number;
  vy: number;
  /** Index within its own source array (`rectangles` or `discs`). */
  srcIndex: number;
};

type Probe = {
  object_type: "disc" | "rect";
  /** Index into `scene.rectangles` or `scene.discs` (the object the probe was on). */
  object_index: number;
  x: number;
  y: number;
  t: number;
};

/** Fill colors of the two "answer" rectangles (red / green). */
const RECT_RED = "#FF7878";
const RECT_GREEN = "#78FF78";

type FirstCollision = {
  /** "r" if the hit rect was red, "g" if green. */
  color: "r" | "g";
  /** Index of the rect in `state.rects` (i.e. `scene.rectangles`). */
  rect_index: number;
  /** ms from animation start. */
  time: number;
};

type State = {
  bodies: Body[];
  discs: Body[];
  rects: Body[];
  width: number;
  height: number;
  raf: number | null;
  last: number;
  elapsed: number;
  duration: number;
  finished: boolean;
  ended: boolean;
  /** Runtime probe support. */
  probe_target: string;
  probe_interval: number;
  probe_duration: number;
  probe_first_after: number;
  probe_key: string[];
  probe_flash_intensity: number;
  probe_flash_duration: number;
  probes: Probe[];
  /** Timestamps (ms from animation start) of probe-key presses during the animation. */
  probe_response: number[];
  probeEl: HTMLDivElement | null;
  probeBody: Body | null;
  probeHideAt: number;
  nextProbeAt: number;
  /** Border flash animation controls. */
  flashStart: number | null;
  flashUntil: number;
  /** Bound keydown handler (so it can be removed on trial end). */
  keydownHandler: ((ev: KeyboardEvent) => void) | null;
  /** The disc hidden at animation end in localize mode (or null). */
  hiddenDisc: Body | null;
  /** First solid colored-rect collision during the animation (ground truth). */
  firstCollision: FirstCollision | null;
};

class RedGreenTrialPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>): void {
    const state = this.setupState(display_element, trial);
    this.renderScene(display_element, trial, state);
    this.attachKeyListener(state);

    // Play the animation.
    const started = performance.now();
    state.raf = requestAnimationFrame((t) => this.tick(t, state));

    // Close the animation after `duration` ms, then present the question.
    this.jsPsych.pluginAPI.setTimeout(() => {
      this.closeAnimation(state, trial);
      this.presentQuestion(display_element, trial, state, started);
    }, trial.duration ?? 4000);
  }

  // ---------------------------------------------------------------- setup

  private setupState(
    display_element: HTMLElement,
    trial: TrialType<Info>,
  ): State {
    const width = trial.scene_width ?? 800;
    const height = trial.scene_height ?? 600;
    const rects: Body[] = (trial.rectangles ?? []).map((r: Rect, i: number) => ({
      kind: "rect",
      x: r.x,
      y: r.y,
      halfW: r.width / 2,
      halfH: r.height / 2,
      color: r.color,
      solid: r.solid !== false,
      el: null as unknown as HTMLDivElement,
      vx: 0,
      vy: 0,
      srcIndex: i,
    }));
    const discs: Body[] = (trial.discs ?? []).map((d: Disc, i: number) => ({
      kind: "disc",
      x: d.x,
      y: d.y,
      halfW: d.radius,
      halfH: d.radius,
      color: d.color,
      solid: true,
      el: null as unknown as HTMLDivElement,
      vx: d.vx,
      vy: d.vy,
      srcIndex: i,
    }));
    return {
      bodies: [...rects, ...discs],
      rects,
      discs,
      width,
      height,
      raf: null,
      last: 0,
      elapsed: 0,
      duration: trial.duration ?? 4000,
      finished: false,
      ended: false,
      probe_target: trial.probe_target ?? "object",
      probe_interval: trial.probe_interval ?? 0,
      probe_duration: trial.probe_duration ?? 100,
      probe_first_after: trial.probe_first_after ?? 1000,
      probe_key: this.normalizeKeys(trial.probe_key ?? [" "]),
      probe_flash_intensity: trial.probe_flash_intensity ?? 0.5,
      probe_flash_duration: trial.probe_flash_duration ?? 250,
      probes: [],
      probe_response: [],
      probeEl: null,
      probeBody: null,
      probeHideAt: 0,
      nextProbeAt: trial.probe_first_after ?? 1000,
      flashStart: null,
      flashUntil: 0,
      keydownHandler: null,
      hiddenDisc: null,
      firstCollision: null,
    };
  }

  private renderScene(
    display_element: HTMLElement,
    trial: TrialType<Info>,
    state: State,
  ): void {
    const scene = document.createElement("div");
    scene.id = "red-green-scene";
    scene.style.width = `${state.width}px`;
    scene.style.height = `${state.height}px`;
    scene.style.position = "relative";
    scene.style.overflow = "hidden";
    scene.style.background = trial.background ?? "#ffffff";
    scene.style.margin = "20px auto";
    scene.style.border = "1px solid #000";

    // Paint order: discs first, then rectangles. Non-solid rectangles are
    // occluders: the disc passes underneath and the rectangle hides it.
    // Solid rectangles are walls the disc bounces off, so drawing them on
    // top is visually neutral (the disc never overlaps them).
    const sorted = [...state.bodies].sort((a, b) => {
      const ao = a.kind === "rect" ? 1 : 0;
      const bo = b.kind === "rect" ? 1 : 0;
      return ao - bo;
    });
    for (const body of sorted) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.background = body.color;
      if (body.kind === "rect") {
        el.style.width = `${body.halfW * 2}px`;
        el.style.height = `${body.halfH * 2}px`;
      } else {
        el.style.width = `${body.halfW * 2}px`;
        el.style.height = `${body.halfH * 2}px`;
        el.style.borderRadius = "50%";
      }
      body.el = el;
      scene.appendChild(el);
    }
    display_element.appendChild(scene);
    this.applyTransforms(state);
  }

  private applyTransforms(state: State): void {
    for (const body of state.bodies) {
      body.el.style.transform = `translate(${body.x - body.halfW}px, ${
        body.y - body.halfH
      }px)`;
    }
  }

  // --------------------------------------------------------- probe keys

  /**
   * Normalize the probe_key parameter into a lower-case array of event.key
   * values, matching jsPsych's "ALL_KEYS"/array semantics used elsewhere.
   */
  private normalizeKeys(keys: string | string[]): string[] {
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.map((k) => k.toLowerCase());
  }

  /**
   * Attach a global keydown listener that (a) records spacebar presses that
   * fall inside a probe's on-screen window and (b) triggers the mild border
   * flash on the display element. Removed in closeAnimation.
   */
  private attachKeyListener(state: State): void {
    if (state.probe_interval <= 0) {
      return;
    }
    const handler = (ev: KeyboardEvent) => {
      if (state.ended || state.finished) {
        return;
      }
      const key = ev.key.toLowerCase();
      if (!state.probe_key.includes(key)) {
        return;
      }
      // Record every probe-key press during the animation, regardless of
      // whether it coincides with a probe. Timestamps are ms from animation
      // start, so they can be matched to `probes` later.
      state.probe_response.push(Math.round(state.elapsed));
      this.flashBorder(state);
    };
    state.keydownHandler = handler;
    window.addEventListener("keydown", handler);
  }

  /**
   * Briefly flash the display element's border as mild visual feedback for
   * a spacebar response during a probe. Uses a CSS class transition and
   * removes it after probe_flash_duration ms.
   */
  private flashBorder(state: State): void {
    const scene = document.getElementById("red-green-scene");
    if (!scene) {
      return;
    }
    const intensity = Math.max(0, Math.min(1, state.probe_flash_intensity ?? 0.5));
    const duration = state.probe_flash_duration ?? 250;
    scene.classList.add("red-green-flash");
    scene.style.boxShadow = `0 0 ${8 + 12 * intensity}px ${2 + 4 * intensity}px rgba(0, 120, 255, ${
      0.4 + 0.4 * intensity
    })`;
    state.flashStart = performance.now();
    state.flashUntil = state.flashStart + duration;
    window.setTimeout(() => {
      scene.classList.remove("red-green-flash");
      scene.style.boxShadow = "";
      state.flashStart = null;
    }, duration);
  }

  // --------------------------------------------------------------- physics

  private tick(now: number, state: State): void {
    if (state.finished || state.ended) {
      return;
    }
    if (state.last === 0) {
      state.last = now;
      state.raf = requestAnimationFrame((t) => this.tick(t, state));
      return;
    }
    const dt = Math.min((now - state.last) / 1000, 1 / 30); // clamp pauses
    state.last = now;
    state.elapsed += dt * 1000;
    for (const disc of state.discs) {
      this.moveDisc(disc, dt, state);
    }
    this.applyTransforms(state);
    this.updateProbes(state);
    if (state.elapsed >= state.duration) {
      state.finished = true;
      return;
    }
    state.raf = requestAnimationFrame((t) => this.tick(t, state));
  }

  /** Integrate one disc, bouncing off the world edges and solid rectangles. */
  private moveDisc(disc: Body, dt: number, state: State): void {
    disc.x += disc.vx * dt;
    disc.y += disc.vy * dt;

    // World boundaries.
    if (disc.x - disc.halfW < 0) {
      disc.x = disc.halfW;
      disc.vx = Math.abs(disc.vx);
    } else if (disc.x + disc.halfW > state.width) {
      disc.x = state.width - disc.halfW;
      disc.vx = -Math.abs(disc.vx);
    }
    if (disc.y - disc.halfH < 0) {
      disc.y = disc.halfH;
      disc.vy = Math.abs(disc.vy);
    } else if (disc.y + disc.halfH > state.height) {
      disc.y = state.height - disc.halfH;
      disc.vy = -Math.abs(disc.vy);
    }

    // Solid rectangles only.
    for (const rect of state.rects) {
      if (!rect.solid) {
        continue;
      }
      this.bounceOffRect(disc, rect, state);
    }
  }

  private bounceOffRect(disc: Body, rect: Body, state: State): void {
    const closestX = Math.max(rect.x - rect.halfW, Math.min(disc.x, rect.x + rect.halfW));
    const closestY = Math.max(rect.y - rect.halfH, Math.min(disc.y, rect.y + rect.halfH));
    const dx = disc.x - closestX;
    const dy = disc.y - closestY;
    const d2 = dx * dx + dy * dy;
    const r = disc.halfW;
    if (d2 > r * r) {
      return;
    }

    // Record the first solid colored-rect collision (ground truth for the
    // red/green response). Only the *first* one counts, across all discs.
    if (state.firstCollision === null) {
      const color =
        rect.color === RECT_RED ? ("r" as const) : rect.color === RECT_GREEN ? ("g" as const) : null;
      if (color !== null) {
        state.firstCollision = {
          color,
          rect_index: rect.srcIndex,
          time: Math.round(state.elapsed),
        };
      }
    }

    if (d2 > 1e-9) {
      // Contact at a corner: reflect along the radial direction.
      const dist = Math.sqrt(d2);
      const nx = dx / dist;
      const ny = dy / dist;
      const vDotN = disc.vx * nx + disc.vy * ny;
      if (vDotN < 0) {
        disc.vx -= 2 * vDotN * nx;
        disc.vy -= 2 * vDotN * ny;
      }
      disc.x = closestX + nx * r;
      disc.y = closestY + ny * r;
      return;
    }

    // Center is inside the rect: push out along the least-penetration axis.
    const overlapLeft = disc.x + r - (rect.x - rect.halfW);
    const overlapRight = rect.x + rect.halfW - (disc.x - r);
    const overlapTop = disc.y + r - (rect.y - rect.halfH);
    const overlapBottom = rect.y + rect.halfH - (disc.y - r);
    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
    if (minOverlap === overlapLeft) {
      disc.x = rect.x - rect.halfW - r;
      disc.vx = -Math.abs(disc.vx);
    } else if (minOverlap === overlapRight) {
      disc.x = rect.x + rect.halfW + r;
      disc.vx = Math.abs(disc.vx);
    } else if (minOverlap === overlapTop) {
      disc.y = rect.y - rect.halfH - r;
      disc.vy = Math.abs(disc.vy);
    } else {
      disc.y = rect.y + rect.halfH + r;
      disc.vy = Math.abs(disc.vy);
    }
  }

  // ------------------------------------------------------------ probes

  /** Called from the animation loop; shows/hides and tracks the probe. */
  private updateProbes(state: State): void {
    if (state.probe_interval <= 0 || state.ended || state.finished) {
      return;
    }
    // Hide the probe once its on-screen window has passed; otherwise keep
    // it centered on its (possibly moving) target.
    if (state.probeEl && state.probeBody) {
      if (state.elapsed >= state.probeHideAt) {
        state.probeEl.style.display = "none";
        state.probeBody = null;
      } else {
        state.probeEl.style.left = `${state.probeBody.x - 9.33}px`;
        state.probeEl.style.top = `${state.probeBody.y - 9.33}px`;
      }
    }
    // Time to spawn a new probe?
    if (state.elapsed < state.nextProbeAt) {
      return;
    }
    // Never start a probe that would still be visible when the animation
    // ends (avoids a flash right at the trial-end transition).
    if (state.nextProbeAt + state.probe_duration > state.duration) {
      return;
    }
    this.showProbe(state);
    state.nextProbeAt = state.elapsed + state.probe_interval;
  }

  /** Spawn the small white probe on a random disc/rectangle. */
  private showProbe(state: State): void {
    const target = this.pickProbeTarget(state);
    if (!target) {
      return;
    }
    if (!state.probeEl) {
      const el = document.createElement("div");
      el.id = "red-green-probe";
      el.style.position = "absolute";
      // ~1/3 the size of a normal disc (normal radius = 14, so probe
      // radius ~ 4.67, diameter ~ 9.33).
      el.style.width = "9.33px";
      el.style.height = "9.33px";
      el.style.borderRadius = "50%";
      el.style.background = "#fff";
      el.style.border = "1px solid #333"; // keep visible on white scenes
      el.style.pointerEvents = "none";
      el.style.display = "none";
      state.probeEl = el;
      document.getElementById("red-green-scene")?.appendChild(el);
    }
    const pr = state.probeEl;
    pr.style.display = "block";
    pr.style.left = `${target.x - 9.33 / 2}px`;
    pr.style.top = `${target.y - 9.33 / 2}px`;
    state.probeBody = target;
    state.probeHideAt = state.elapsed + state.probe_duration;
    state.probes.push({
      object_type: target.kind,
      object_index: target.srcIndex,
      x: Math.round(target.x),
      y: Math.round(target.y),
      t: Math.round(state.elapsed),
    });
  }

  private pickProbeTarget(state: State): Body | null {
    const candidates =
      state.probe_target === "rect"
        ? state.rects
        : state.probe_target === "disc"
          ? state.discs
          : [...state.discs, ...state.rects];
    if (candidates.length === 0) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // ------------------------------------------------------------ question

  private closeAnimation(state: State, trial: TrialType<Info>): void {
    state.finished = true;
    if (state.raf !== null) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    // Remove the probe-key listener since the animation is over.
    if (state.keydownHandler) {
      window.removeEventListener("keydown", state.keydownHandler);
      state.keydownHandler = null;
    }
    // Stop a probe that might still be visible at animation end.
    if (state.probeEl) {
      state.probeEl.style.display = "none";
      state.probeBody = null;
    }
    // Clear any in-flight border flash.
    const scene = document.getElementById("red-green-scene");
    if (scene) {
      scene.classList.remove("red-green-flash");
      scene.style.boxShadow = "";
    }
    state.flashStart = null;
    const mode = trial.response_mode ?? "empty";
    if (mode === "localize") {
      // Keep the scene (minus the hidden disc) on screen for clicking.
      state.hiddenDisc = this.hideOneDisc(state);
      return;
    }
    if (scene) {
      scene.remove();
    }
  }

  /** Hide exactly one disc (for localize mode); returns the hidden disc. */
  private hideOneDisc(state: State): Body {
    const idx = Math.floor(Math.random() * state.discs.length);
    const hidden = state.discs[idx];
    hidden.el.style.display = "none";
    return hidden;
  }

  private presentQuestion(
    display_element: HTMLElement,
    trial: TrialType<Info>,
    state: State,
    started: number,
  ): void {
    const mode = trial.response_mode ?? "empty";
    if (mode === "localize") {
      this.presentLocalizeQuestion(display_element, trial, state, started);
      return;
    }
    this.presentEmptyQuestion(display_element, trial, state, started);
  }

  private presentEmptyQuestion(
    display_element: HTMLElement,
    trial: TrialType<Info>,
    state: State,
    started: number,
  ): void {
    const mode = trial.response_mode ?? "slider";
    if (mode === "slider") {
      this.presentSliderQuestion(display_element, trial, state, started);
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.id = "red-green-question";
    wrapper.style.textAlign = "center";
    wrapper.style.marginTop = "40px";

    const h2 = document.createElement("h2");
    h2.innerHTML = trial.prompt ?? "Red or Green?";
    wrapper.appendChild(h2);

    const hint = document.createElement("div");
    hint.style.marginTop = "12px";
    hint.style.color = "#444";
    const keys: string[] = Array.isArray(trial.choices)
      ? (trial.choices as string[])
      : trial.choices && trial.choices !== "ALL_KEYS" && trial.choices !== "NO_KEYS"
        ? [trial.choices]
        : [];
    hint.innerHTML = keys.map((c: string) => `<b>${c}</b>`).join(" / ");
    wrapper.appendChild(hint);
    display_element.appendChild(wrapper);

    const start_time = performance.now();
    let responded = false;
    const end_trial = (key: string) => {
      if (responded) {
        return;
      }
      responded = true;
      state.ended = true;
      if (state.raf !== null) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
      // Remove the probe-key listener (animation over).
      if (state.keydownHandler) {
        window.removeEventListener("keydown", state.keydownHandler);
        state.keydownHandler = null;
      }
      const rt = Math.round(performance.now() - start_time);
      // Ground truth is the color of the first solid colored rectangle a disc
      // collided with. If none was hit, fall back to the authored hint (if any).
      const answer = state.firstCollision?.color ?? trial.correct_response ?? null;
      const correct = answer !== null ? key === answer : null;
      const trial_data = this.assembleTrialData(trial, state, started, rt, key, correct, mode);
      display_element.innerHTML = "";
      this.jsPsych.finishTrial(trial_data);
    };

    this.jsPsych.pluginAPI.getKeyboardResponse({
      callback_function: (info: { key: string }) => end_trial(info.key),
      valid_responses: trial.choices as string[] | "ALL_KEYS" | "NO_KEYS",
      rt_method: "performance",
      persist: false,
      allow_held_key: false,
    });
  }

  private presentLocalizeQuestion(
    display_element: HTMLElement,
    trial: TrialType<Info>,
    state: State,
    started: number,
  ): void {
    const wrapper = document.createElement("div");
    wrapper.id = "red-green-localize-question";
    wrapper.style.textAlign = "center";
    wrapper.style.marginTop = "20px";

    const h2 = document.createElement("h2");
    h2.innerHTML = trial.prompt ?? "Where was the missing disc?";
    wrapper.appendChild(h2);

    const hint = document.createElement("div");
    hint.style.marginTop = "12px";
    hint.style.color = "#444";
    hint.innerHTML =
      "<p>One disc has disappeared. Click on the position where it was last seen.</p>";
    wrapper.appendChild(hint);
    display_element.appendChild(wrapper);

    const scene = document.getElementById("red-green-scene");
    if (!scene) {
      return;
    }
    const start_time = performance.now();
    let responded = false;

    const onClick = (ev: MouseEvent) => {
      if (responded) {
        return;
      }
      responded = true;
      state.ended = true;
      const rect = scene.getBoundingClientRect();
      const clickX = ev.clientX - rect.left;
      const clickY = ev.clientY - rect.top;
      const rt = Math.round(performance.now() - start_time);
      this.finishFromLocalize(display_element, trial, state, started, clickX, clickY, rt);
    };

    scene.addEventListener("click", onClick);
  }

  private finishFromLocalize(
    display_element: HTMLElement,
    trial: TrialType<Info>,
    state: State,
    started: number,
    x: number,
    y: number,
    rt: number,
  ): void {
    // In localize mode there is no keyboard response; `correct` stays null.
    const correct: boolean | null = null;
    // Remove the probe-key listener (animation over).
    if (state.keydownHandler) {
      window.removeEventListener("keydown", state.keydownHandler);
      state.keydownHandler = null;
    }
    const hidden = state.hiddenDisc;
    const trial_data: Record<string, unknown> = this.assembleTrialData(
      trial, state, started, rt, { x: Math.round(x), y: Math.round(y) }, correct, "localize",
    );
    trial_data.hidden_disc = hidden
      ? {
          index: state.discs.indexOf(hidden),
          x: Math.round(hidden.x),
          y: Math.round(hidden.y),
          radius: hidden.halfW,
          color: hidden.color,
          vx: hidden.vx,
          vy: hidden.vy,
        }
      : null;
    display_element.innerHTML = "";
    this.jsPsych.finishTrial(trial_data);
  }

  /** Build the trial-data record shared by all response modes. */
  private assembleTrialData(
    trial: TrialType<Info>,
    state: State,
    started: number,
    rt: number,
    response: unknown,
    correct: boolean | null,
    mode: string,
  ): Record<string, unknown> {
    return {
      rt,
      response,
      correct,
      response_mode: mode,
      animation_duration: Math.round(performance.now() - started),
      first_collision_color: state.firstCollision?.color ?? null,
      first_collision_time: state.firstCollision?.time ?? null,
      first_collision_rect_index: state.firstCollision?.rect_index ?? null,
      probes: state.probes,
      probe_response: state.probe_response,
      probe_count: state.probes.length,
      scene: this.serializeScene(trial, state),
    };
  }

  /** Slider response mode: a 7-point confidence scale, "Confident red" on the
   *  left end, "Confident green" on the right, Continue button to confirm.
   *  Scoring: values below the midpoint map to "r", above to "g", the exact
   *  midpoint maps to null ("unsure"), so `correct` is null there. */
  private presentSliderQuestion(
    display_element: HTMLElement,
    trial: TrialType<Info>,
    state: State,
    started: number,
  ): void {
    const wrapper = document.createElement("div");
    wrapper.id = "red-green-question";
    wrapper.style.textAlign = "center";
    wrapper.style.marginTop = "40px";

    const h2 = document.createElement("h2");
    h2.innerHTML = trial.prompt ?? "Red or Green?";
    wrapper.appendChild(h2);

    const [min, max] =
      Array.isArray(trial.slider_range) && trial.slider_range.length === 2
        ? (trial.slider_range as number[])
        : [0, 6];
    const mid = Math.round((min + max) / 2);

    const scale = document.createElement("div");
    scale.style.cssText = "margin:24px auto 0;max-width:520px;";

    const labels = document.createElement("div");
    labels.style.cssText =
      "display:flex;justify-content:space-between;font-size:14px;color:#444;";
    labels.innerHTML =
      `<span>${trial.slider_label_left ?? "Confident red"}</span>` +
      `<span>${trial.slider_label_right ?? "Confident green"}</span>`;
    scale.appendChild(labels);

    const input = document.createElement("input");
    input.type = "range";
    input.id = "red-green-slider";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(mid);
    input.style.cssText = "width:100%;margin-top:10px;";
    scale.appendChild(input);

    const ticks = document.createElement("div");
    ticks.style.cssText =
      "display:flex;justify-content:space-between;font-size:12px;color:#888;margin-top:2px;";
    for (let v = min; v <= max; v++) {
      const t = document.createElement("span");
      t.textContent = String(v);
      ticks.appendChild(t);
    }
    scale.appendChild(ticks);
    wrapper.appendChild(scale);

    const button = document.createElement("button");
    button.textContent = trial.slider_button_label ?? "Continue";
    button.id = "red-green-slider-btn";
    button.className = "jspsych-btn";
    button.style.marginTop = "24px";
    if (trial.slider_require_moved) {
      button.disabled = true;
      input.addEventListener("input", () => {
        button.disabled = false;
      });
    }
    wrapper.appendChild(button);
    display_element.appendChild(wrapper);

    const start_time = performance.now();
    const moved = { value: false };
    input.addEventListener("input", () => {
      moved.value = true;
    });

    const end_trial = () => {
      state.ended = true;
      if (state.raf !== null) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
      // Remove the probe-key listener (animation over).
      if (state.keydownHandler) {
        window.removeEventListener("keydown", state.keydownHandler);
        state.keydownHandler = null;
      }
      const value = Number(input.value);
      const label = value < mid ? "r" : value > mid ? "g" : null;
      const rt = Math.round(performance.now() - start_time);
      // Ground truth is the color of the first solid colored rectangle a disc
      // collided with. If none was hit, fall back to the authored hint (if any).
      const answer = state.firstCollision?.color ?? trial.correct_response ?? null;
      const correct = answer !== null && label !== null ? label === answer : null;
      const trial_data = this.assembleTrialData(trial, state, started, rt, value, correct, "slider");
      (trial_data as Record<string, unknown>).response_label = label;
      (trial_data as Record<string, unknown>).slider_moved = moved.value;
      (trial_data as Record<string, unknown>).slider_midpoint = mid;
      display_element.innerHTML = "";
      this.jsPsych.finishTrial(trial_data);
    };

    button.addEventListener("click", end_trial);
  }

  private serializeScene(
    trial: TrialType<Info>,
    state: State,
  ): Record<string, unknown> {
    return {
      width: state.width,
      height: state.height,
      background: trial.background,
      rectangles: state.rects.map((r) => ({
        x: r.x,
        y: r.y,
        width: r.halfW * 2,
        height: r.halfH * 2,
        color: r.color,
        solid: r.solid,
      })),
      discs: state.discs.map((d) => ({
        x: d.x,
        y: d.y,
        radius: d.halfW,
        color: d.color,
        vx: d.vx,
        vy: d.vy,
      })),
    };
  }
}

export default RedGreenTrialPlugin;
