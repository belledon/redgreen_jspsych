import { initJsPsych } from "jspsych";
import PreloadPlugin from "@jspsych/plugin-preload";
import FullscreenPlugin from "@jspsych/plugin-fullscreen";
import SurveyTextPlugin from "@jspsych/plugin-survey-text";
import SurveyMultiChoicePlugin from "@jspsych/plugin-survey-multi-choice";
import HtmlButtonResponsePlugin from "@jspsych/plugin-html-button-response";
import HtmlKeyboardResponsePlugin from "@jspsych/plugin-html-keyboard-response";

import jatos from "./types/jatos";
import RedGreenTrialPlugin from "./plugins/red-green-trial";
import { generateScene, SceneConfig } from "./scenes";
import { resolveTrialsSource, LoadedTrial } from "./trials/load";
// jsPsych's official stylesheet provides the flex/centering rules for the
// content wrapper and default plugin styles (buttons, progress bar, survey
// components). It is NOT auto-injected by the jsPsych package, so import it
// explicitly, before our overrides so they can layer on top.
import "jspsych/css/jspsych.css";
import "./styles/main.css";

console.log(jatos)

const jsPsych = initJsPsych({
    show_progress_bar: true,
    on_finish: () => {
        if (typeof jatos !== 'undefined') {
            jatos.endStudy(jsPsych.data.get().json());
        } else {
            jsPsych.data.displayData();
            return jsPsych;
        }
    },
});

const N_TRIALS = 1;
const ANIMATION_DURATION_MS = 4000; // within the required 3-5 s window

/**
 * Convert a serialized trial spec into a jsPsych trial object for
 * `RedGreenTrialPlugin`. The loader already normalized defaults and
 * validated required fields; we just stamp the plugin type.
 */
function fromSpec(spec: LoadedTrial) {
    const { type: _type, ...rest } = spec;
    return {
        type: RedGreenTrialPlugin,
        ...rest,
    };
}

/**
 * Build the main experiment timeline. If an external trials file is
 * available (via `?trials=` or `trials/trials.json`), every subject sees
 * the identical scene set. Otherwise fall back to random generation for
 * debugging.
 */
async function buildTrialTimeline() {
    const loaded = await resolveTrialsSource();
    if (loaded && loaded.length > 0) {
        // Deterministic: same trials for every subject, in file order.
        return loaded.map(fromSpec);
    }
    // Fallback (debugging): random trials.
    console.log("Could not load trials, generating random set")
    return Array.from({ length: N_TRIALS }, (_, i) => makeTrial(jsPsych, i));
}

function makeTrial(jsPsych: ReturnType<typeof initJsPsych>, idx: number) {
    const config: SceneConfig = {
        width: 800,
        height: 600,
        numRects: 8,
        numDiscs: 1 + (idx % 3), // 1-3 discs, varied across trials
        discSpeed: 140,
    };
    const scene = generateScene(config);
    // Alternate trial-end response modes: even trials are keyboard
    // (blue/purple), odd trials are localization (click on the missing disc).
    const responseMode = idx % 2 === 0 ? "empty" : "localize";
    return {
        type: RedGreenTrialPlugin,
        rectangles: scene.rectangles,
        discs: scene.discs,
        duration: ANIMATION_DURATION_MS,
        prompt: "Red or Green?",
        choices: ["r", "g"],
        correct_response: scene.correctResponse,
        response_mode: responseMode,
        // Runtime probes: enabled every other trial (spaced ~2.5 s apart).
        probe_interval: idx % 2 === 0 ? 2500 : 0,
        probe_duration: 100,
        probe_first_after: 1000,
        probe_target: "object",
        scene_width: 800,
        scene_height: 600,
    };
}

const timeline: any[] = [
    {
        type: HtmlButtonResponsePlugin,
        stimulus: `
<div class="intro-text">
<h1>Red / Green Attention</h1>
<p>You will see a short animation (3-5 s) with blue/purple discs moving
among stationary rectangles. Some rectangles are solid (discs bounce off
them); others are occluders (discs pass behind them). Discs are never
red or green — the red/green signal comes from the rectangles.</p>
<p>After each animation you will be asked either: <b>Red or Green?</b>
(press <b>r</b> if a disc first collided with a <b>red</b> rectangle,
<b>g</b> if it first collided with a <b>green</b> rectangle), or
<b>Click on the missing disc</b> (one disc disappears and you click on the
position where it was last seen).</p>
<p>Sometimes a small white dot will flash briefly on one of the shapes during
the animation. If you notice it, press the <b>space bar</b> as soon as you see
it; a brief flash around the display will confirm your response. If you don't
see it, do nothing.</p>
<p>Respond as quickly and accurately as you can.</p>
</div>
`,
        choices: ["Start"],
    },
    { type: FullscreenPlugin, fullscreen_mode: true },
];

const trial_timeline = await buildTrialTimeline();
timeline.push(...trial_timeline);

const debrief = {
    type: SurveyTextPlugin,
    questions: [
        {
            prompt: "Any comments about the task?",
            rows: 3,
            name: "comments",
        },
    ],
};
timeline.push(debrief);

const debriefing = {
    type: HtmlKeyboardResponsePlugin,
    stimulus: `
<div class="debriefing" style="max-width: 42em; text-align: left; line-height: 1.55;">
<h2 style="margin-top: 0;">Thank you for participating</h2>
<p>
This study is used to explore how humans <strong>dynamically allocate attention</strong>
in rich physical tasks. You watched scenes of moving discs that bounced off walls and
stationary shapes, then reported the color of the first rectangle that
a disc bounced off.
</p>
<p>
The task is based on prior work on physical prediction and attention: people continuously
update mental predictions of how objects move in physical scenes, and attention is
directed to the elements most relevant to the current judgment.
</p>
<p>
<strong>Original study:</strong>
Smith, K. A., Dechter, E., Tenenbaum, J. B., &amp; Vul, E. (2013).
Physical predictions over time. <em>Proceedings of the 35th Annual Meeting of the
Cognitive Science Society</em>.
(<a href="https://escholarship.org/content/qt9m0197n4/qt9m0197n4.pdf" target="_blank" rel="noopener noreferrer">PDF</a>)
</p>
<p class="small" style="opacity: 0.75;">Press any key to close this window.</p>
</div>
`,
    // IMPORTANT: use the string "ALL_KEYS", not the array ["ALL_KEYS"].
    // jsPsych v8 lowercases array forms (breaks "ALL_KEYS" into "all_keys"),
    // so an array never matches any real key.
    choices: "ALL_KEYS",
};
timeline.push(debriefing);

(async () => {
    await jsPsych.run(timeline);
})();
