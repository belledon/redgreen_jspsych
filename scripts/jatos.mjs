#!/usr/bin/env node
/**
 * Package the built experiment as a JATOS study archive (.jzip).
 *
 * Usage:
 *   pnpm jatos            # build, then package
 *   pnpm jatos -- --no-build   # package the existing dist/ only
 *
 * Overwrite safety:
 *   - Every package gets FRESH study/component/batch UUIDs, so importing a new
 *     build into JATOS always creates a NEW study — it never overwrites an
 *     existing one. Delete old studies from the JATOS GUI when you are done
 *     with them.
 *   - The output file name carries a timestamp
 *     (jatos/red-green-attention-YYYYMMDD-HHMM.jzip). If the file already
 *     exists, you are asked to confirm before it is replaced.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const outDir = join(root, "jatos");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const dirName = pkg.name; // study assets directory name in the .jas
const title = pkg.name;

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).then((a) => {
    rl.close();
    return /^y(es)?$/i.test(a.trim());
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n"${cmd} ${args.join(" ")}" failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

// 1. Build (unless skipped)
const args = process.argv.slice(2);
if (!args.includes("--no-build")) {
  console.log("==> building (pnpm build) ...");
  run("pnpm", ["build"]);
}
if (!existsSync(distDir)) {
  console.error("dist/ not found — run `pnpm build` first.");
  process.exit(1);
}

// 2. Fresh UUIDs every time: JATOS treats a new UUID as a new study on import.
const studyUuid = randomUUID();
const componentUuid = randomUUID();
const batchUuid = randomUUID();

const jas = {
  version: "3",
  data: {
    uuid: studyUuid,
    title,
    description: pkg.description,
    groupStudy: false,
    linearStudy: false,
    allowPreview: false,
    dirName,
    comments: "",
    jsonData: null,
    endRedirectUrl: "",
    studyEntryMsg: null,
    componentList: [
      {
        uuid: componentUuid,
        title,
        htmlFilePath: "index.html",
        reloadable: false,
        active: true,
        comments: "",
        jsonData: null,
      },
    ],
    batchList: [
      {
        uuid: batchUuid,
        title: "Default",
        active: true,
        maxActiveMembers: null,
        maxTotalMembers: null,
        maxTotalWorkers: null,
        allowedWorkerTypes: ["PersonalSingle", "Jatos", "PersonalMultiple"],
        comments: null,
        jsonData: null,
      },
    ],
  },
};

// 3. Stage study_code dir + .jas
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13); // YYYYMMDDHHMM
const outPath = join(outDir, `${dirName}-${stamp}.jzip`);
if (existsSync(outPath)) {
  const ok = await confirm(`"${basename(outPath)}" already exists. Overwrite? [y/N] `);
  if (!ok) {
    console.log("aborted — nothing written.");
    process.exit(1);
  }
}

const stage = join(outDir, ".stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(distDir, join(stage, dirName), { recursive: true });
writeFileSync(join(stage, `${dirName}.jas`), JSON.stringify(jas, null, 2) + "\n");

// 4. Zip (7z if available, else the standard zip tool)
console.log("==> writing", basename(outPath));
const has7z = existsSync("/usr/bin/7z");
const zipCmd = has7z ? "7z" : "zip";
const zipArgs = has7z
  ? ["a", "-tzip", outPath, join(stage, dirName), join(stage, `${dirName}.jas`)]
  : ["-r", outPath, dirName, `${dirName}.jas`];
if (!has7z) process.chdir(stage); // zip has no way to control paths directly
run(zipCmd, zipArgs);
rmSync(stage, { recursive: true, force: true });

console.log(`\nDone: ${outPath}`);
console.log("Import it in JATOS: Studies -> Import study. Fresh UUIDs were");
console.log("generated, so importing creates a new study and will not overwrite");
console.log("any previously imported build.");
