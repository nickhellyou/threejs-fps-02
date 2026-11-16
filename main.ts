// EMBERLINE, a threejs-fps entry (Node 22, standard library only). The game lives
// in game/ as plain static files the browser loads as ES modules, three.js from an
// import map, and this program hands it in: it stages game/ and screenshots/ from
// beside this file into the output directory and writes dossier.json there, the
// summary the judge reads, using the vendored make.fun library.
//
// The dossier's first screenshot by name is the cover, so screenshots/ is named
// for presentation order: a-combat (a mid-combat duel) first, then the plant, the
// round win, and the buy menu.
//
// Run it locally with MAKEFUN_OUTPUT_DIR set to a scratch directory:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Serve the game itself with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's own caps, from the bounty's gate.json: the text cap shapes the
// dossier's bytes; the rest refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files in all, since game/ counts beside the output directory's own 1000-entry
// cap, its screenshots/ and its dossier.json).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function stageDirectory(source, target) {
  if (!existsSync(source)) return false;
  cpSync(source, target, { recursive: true });
  return true;
}

function main() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(out, { recursive: true });
  stageDirectory(join(here, 'game'), join(out, 'game'));
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  stageDirectory(join(here, 'screenshots'), join(out, 'screenshots'));
  const dossier = buildDossier(out, DOSSIER_CAPS);
  writeFileSync(join(out, 'dossier.json'), dossier);
  console.log(`dossier written: ${dossier.length} bytes`);
}

main();
