import { initJsPsych } from "jspsych";
import PreloadPlugin from "@jspsych/plugin-preload";
import FullscreenPlugin from "@jspsych/plugin-fullscreen";
import SurveyTextPlugin from "@jspsych/plugin-survey-text";
import InstructionsPlugin from "@jspsych/plugin-instructions";
import SurveyMultiChoicePlugin from "@jspsych/plugin-survey-multi-choice";
import HtmlButtonResponsePlugin from "@jspsych/plugin-html-button-response";
import HtmlKeyboardResponsePlugin from "@jspsych/plugin-html-keyboard-response";

// import jatos from "./types/jatos";
import RedGreenTrialPlugin from "./plugins/red-green-trial";
import { generateScene, SceneConfig } from "./scenes";
import { resolveTrialsSource, LoadedTrial } from "./trials/load";
// jsPsych's official stylesheet provides the flex/centering rules for the
// content wrapper and default plugin styles (buttons, progress bar, survey
// components). It is NOT auto-injected by the jsPsych package, so import it
// explicitly, before our overrides so they can layer on top.
import "jspsych/css/jspsych.css";
import "@fontsource/literata/400.css";   // regular — body/instruction text
import "@fontsource/literata/700.css";   // semibold — headings, response keys
import "./styles/main.css";

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
const EXP_DURATION = 5; // minutes for whole experiment
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
    console.log(loaded);
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
    const responseMode = idx % 2 === 0 ? "keyboard" : "localize";
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


const TRIALS = await buildTrialTimeline();

const timeline: any[] = [];

// Consent
// timeline.push({
//     type: ExternalHtmlPlugin,
//     url: "assets/consent.html",
//     cont_btn: "start",
//     check_fn: function () {
//         if (document.getElementById("consent_checkbox").checked) {
//             return true;
//         } else {
//             alert("You must tick the checkbox to continue with the study.");
//         }
//     },
// });
//
//
// Welcome screen
timeline.push({
    type: InstructionsPlugin,
    pages: [
        `
<div class="intro-text">
<h1>Hi, welcome to our study!</h1><br><br> 
<p>Please take a moment to adjust your seating so that you can comfortably watch
the monitor and use the keyboard/mouse.</p>
<p>Feel free to dim the lights as well.  
Close the door or do whatever is necessary to minimize disturbance during the
experiment.</p>
<p>Please also take a moment to silence your phone so that you are not
interrupted by any messages mid-experiment.</p>
<center>Click <b>Next</b> when you are ready to calibrate your display.</center>
</div>
`,
    ],
    show_clickable_nav: true,
    allow_backward: false,
    data: {
        type: "welcome",
    },
});


// Switch to fullscreen
timeline.push({
    type: FullscreenPlugin,
    fullscreen_mode: true,
});


const instruct_tl: any[] = [];

instruct_tl.push(
    {
        type: InstructionsPlugin,
        pages: [
            `
<div class="intro-text">
<h1>Instructions</h1>
<p>The study is designed to be <i>challenging</i>.<p>
<p>Sometimes, you'll be certain about what you saw.<br>
Other times, you won't be -- and this is okay!</p>
<p>Just give your best guess each time.</p>
<center>Click <b>Next</b> to continue.</center>
</div>
`,
            `
<div class="intro-text">
<h1>Instructions</h1>
<p>We know it is also difficult to stay focused for so long -
especially when you are doing the same thing over and over.<p>
<p>But remember, the experiment will be all over in less than ${EXP_DURATION}
minutes. There are only <strong>${N_TRIALS} trials</strong> in this study. </p>
<p>Please do your best to remain focused! Your responses will only be useful
to us if you remain focused.</p>
<center>Click <b>Next</b> to continue.</center>
</div>
`,
            `
<div class="intro-text">
<h1>Instructions</h1>
<p>You will see a short animation of discs bouncing around an arena containing
<span style="color: red;">RED</span>, <span style="color: green;">GREEN</span>,
or <b>BLACK</b> rectangles.</p>
<center>Click <b>Next</b> to see an example.</center>
</div>
`,        ],
        show_clickable_nav: true,
        allow_backward: false,
    }
);

instruct_tl.push(TRIALS[0]);

instruct_tl.push(
    {
        type: InstructionsPlugin,
        pages: [
            `
<div class="intro-text">
<h1>Instructions</h1>
<p>Your primary task is to determine whether any disc will first hit a <span
style="color: red;">red</span> or <span style="color: green;">green</span>
rectangle.</p>
<p>At the end of the animation, and you will respond with a slider. If you are
confident that <spanstyle="color: red;">red</span> will be first, place the
slider all the way to the <b>LEFT</b>. If you are confident that
<spanstyle="color: green;">red</span> will be first, place the slider all the
way to the <b>RIGHT</b>. If you are unsure, just make your best guess and place
the slider closer to the middle</p>
<center>Click <b>Next</b> to give it a try</center>
</div>
`,
        ],
        show_clickable_nav: true,
        allow_backward: false,
    }
);

instruct_tl.push(TRIALS[1]);

instruct_tl.push(
    {
        type: InstructionsPlugin,
        pages: [
`
<div class="intro-text">
<h1>Instructions</h1>
<p>In addition to your primary task of Red-Green judgements, you may also be
asked to detect small white dots that briefly appear in the scene.</p>
<p>If and when you happen to notice a dot, please press the SPACE bar shortly
after. The small dots are very hard to see; it is ok if you don't notice them.
<center>Click <b>Next</b> to give it a try</center>
</p>
</div>
`,
        ],
        show_clickable_nav: true,
        allow_backward: false,
    }
);


instruct_tl.push(TRIALS[2]);

instruct_tl.push(
    {
        type: InstructionsPlugin,
        pages: [
`
<div class="intro-text">
<h1>Instructions</h1>
<p>Finally, one of the discs may disappear at the end of the animation.</p>
<p>If this happens, please use your mouse to click where the last position
of the missing object.
</p>
<center>Click <b>Next</b> to give it a try</center>
</div>
`,
        ],
        show_clickable_nav: true,
        allow_backward: false,
    }
);

instruct_tl.push(TRIALS[3]);

// comprehension check
const comp_check = {
    type: SurveyMultiChoicePlugin,
    preamble:
    "<h2>Comprehension Check</h2> " +
        "<p> Before beginning the experiment, you must answer a few simple questions to ensure that the instructions are clear." +
        "<br> If you do not answer all questions correctly, you will be returned to the start of the instructions.</p>",
    questions: [
        {
            prompt: "Which of the following is <b>TRUE</b>",
            name: "check1",
            options: [
                `A) When discs are moving, you should click on your favorite`,
                `B) The primary task is to predict Red or Green`,
                "C) Only respond if you are 100% sure about the answer",
            ],
            required: true,
        },
        {
            prompt: " Which of the following statements is <b>FALSE</b>:",
            name: "check2",
            options: [
                "A) It is ok if you miss the dots",
                "B) To move on to the next trial, you must click the slider if present",
                "C) You can move objects with your mouse",
            ],
            required: true,
        },
    ],
    randomize_question_order: false,
    on_finish: function (data) {
        const q1 = data.response.check1[0];
        const q2 = data.response.check2[0];
        // both comp checks must pass
        data.correct = q1 == "B" && q2 == "C";
    },
    data: {
        type: "comp_quiz",
    },
};

// feedback
const comp_feedback = {
    type: HtmlButtonResponsePlugin,
    stimulus: () => {
        var last_correct_resp = jsPsych.data
            .getLastTrialData()
            .values()[0].correct;
        var msg;
        if (last_correct_resp) {
            msg =
                "<h2><span style='color:green'>You passed the comprehension check!</span>" +
                "<br>When you're ready, please click <b>Next</b> to begin the study. </h2>";
        } else {
            msg =
                "<h2><span style='color:red'>You failed to respond <b>correctly</b> to all" +
                " parts of the comprehension check.</span>" +
                "<br>Please click <b>Next</b> to revisit the instructions.</h2>";
        }
        return msg;
    },
    choices: ["Next"],
    data: {
        // add any additional data that needs to be recorded here
        type: "comp_feedback",
    },
};

// `comp_loop`: if answers are incorrect, `comp_check` will be repeated until answers are correct responses
const comp_loop = {
    timeline: [...instruct_tl, comp_check, comp_feedback],
    loop_function: function (data) {
        // return false if comprehension passes to break loop
        // HACK: changing `timeline` will break this
        const vals = data.values();
        const quiz = vals[vals.length - 2];
        return !quiz.correct;
    },
};

timeline.push(comp_loop);

timeline.push(TRIALS);

const comments = {
    type: SurveyTextPlugin,
    questions: [
        {
            prompt: "Any comments about the task?",
            rows: 3,
            name: "comments",
        },
    ],
};
timeline.push(comments);

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
