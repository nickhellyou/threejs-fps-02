// EMBERLINE hand-in.
//
// This program takes the finished game and its screenshots out of the
// repository and lays them down in the output directory, then asks the
// kit's dossier builder to describe that output for the scorer.
//
//   node main.ts                            writes to /output (the grader)
//   MAKEFUN_OUTPUT_DIR=out node main.ts     writes to out/ instead
//
// Node 22 runs this file as-is: no build step, no install, nothing but
// the standard library plus the vendored dossier builder.

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

// The folders this program stages, and the dossier's file name.
const GAME_FOLDER = "game";
const SHOTS_FOLDER = "screenshots";
const DOSSIER_FILE = "dossier.json";

// The grader's directory when no override is given.
const DEFAULT_OUTPUT = "/output";

// The dossier caps from the bounty's gate: how much source text the
// judge reads, how many screenshots and how large each may be, and how
// much the game tree may hold. The game entry cap is the platform's
// thousand output entries less the seven the rest of the output costs.
const DOSSIER_CAPS = {
  text_max_bytes: 160 * 1024,
  screenshots: { max: 4, max_bytes: 256 * 1024 },
  game_max_files: 1000 - 7,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

// The folder this file sits in is the repository root.
function repositoryRoot(): string {
  return dirname(fileURLToPath(import.meta.url));
}

// The output directory: the environment's override, else the grader's.
function outputDirectory(): string {
  const override = process.env.MAKEFUN_OUTPUT_DIR;
  return override !== undefined && override !== "" ? override : DEFAULT_OUTPUT;
}

// Lay one repository folder down in the output directory, replacing
// whatever an earlier run left there so a second run writes the same
// bytes as the first. When the output directory is the repository
// itself there is nothing to lay down: the folders are already there.
function stageFolder(repo: string, out: string, name: string): void {
  const source = join(repo, name);
  const target = join(out, name);
  if (source === target) return;
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

// Hand the entry in: stage the game and its screenshots, build the
// dossier from what was staged, and write it beside them.
function handIn(): void {
  const repo = repositoryRoot();
  const out = outputDirectory();
  mkdirSync(out, { recursive: true });
  stageFolder(repo, out, GAME_FOLDER);
  stageFolder(repo, out, SHOTS_FOLDER);
  const dossier = buildDossier(out, DOSSIER_CAPS);
  writeFileSync(join(out, DOSSIER_FILE), dossier);
  console.log(`wrote ${join(out, DOSSIER_FILE)} (${dossier.length} bytes)`);
}

handIn();
