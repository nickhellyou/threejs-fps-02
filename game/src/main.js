// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// One state object holds the whole match: phase, round, score, money, the Spike, the
// player, and nine bots. Every module reads and writes that one store, so the rules
// of the game live in exactly one place.
// ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, ARMOR_AMOUNT, createViewModel, currentSpread } from './weapon.js';
import { createBots, resetBots, updateBots, segmentBlockedBySmoke } from './bots.js';
import { createCombat } from './combat.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 15;
const BOMB_FUSE = 40;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const MAX_ROUNDS = 9;
const WIN_SCORE = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const body = player.state;

// The player as an entity, so bots can target it exactly like a bot.
body.pos = body.position;
body.alive = true;
body.health = 100;
body.armor = 0;
body.team = 'ember';
body.kills = 0;
body.yaw = 0; // north, down the map
body.name = 'YOU';

// Invisible hitbox meshes for the player, so bot bullets can hit the player.
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerBodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.05, 0.32), hitMat);
const playerHeadMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), hitMat);
playerBodyMesh.userData.entity = body;
playerBodyMesh.userData.part = 'body';
playerHeadMesh.userData.entity = body;
playerHeadMesh.userData.part = 'head';
scene.add(playerBodyMesh, playerHeadMesh);
const playerHitMeshes = [playerBodyMesh, playerHeadMesh];

// --- the single state store ---
const state = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1,
  score: { ember: 0, warden: 0 },
  timer: BUY_TIME,
  money: 800,
  lossStreak: 0,
  owned: { pistol: true, rifle: false, smg: false, sniper: false },
  weapon: 'pistol',
  mag: WEAPONS.pistol.mag,
  reserve: WEAPONS.pistol.reserve,
  reloading: 0,
  fireTimer: 0,
  grenades: { frag: 0, smoke: 0, flash: 0 },
  bomb: { state: 'carried', carrier: null, site: null, pos: new THREE.Vector3(), timer: BOMB_FUSE, dropPos: null },
  now: 0,
  lastNoise: null,
  roundWinner: null,
  roundEndTimer: 0,
  playerChannel: null,
  shakeAmt: 0,
  flashStrength: 0,
};

const bots = createBots(scene, world, null);
const botCtx = { bots: bots.bots, nav: bots.nav, world, game: null, hitMeshes: bots.hitMeshes };
let combat = null;

const game = {
  player: body,
  bomb: state.bomb,
  now: 0,
  roundStart: 0,
  lastNoise: null,
  playerHitMeshes,
  allEntities() { return [body, ...bots.bots]; },
  allHitMeshes() { return bots.hitMeshes.concat(playerHitMeshes); },
  blocksSight(from, to) {
    if (!combat) return false;
    return segmentBlockedBySmoke(from, to, combat.smokes);
  },
  noise(pos) {
    state.lastNoise = { pos: pos.clone(), t: state.now };
    game.lastNoise = state.lastNoise;
  },
  spawnTracer(from, to, color) { combat.spawnTracer(from, to, color); },
  playShot(pos, weaponId, distant) { audio.shot(weaponId, distant); },
  playExplosion(pos) { audio.explosion(); },
  playFlash(pos) { audio.flash(); },
  shake(amount) { state.shakeAmt = Math.max(state.shakeAmt, amount); },
  flashPlayer(strength) {
    state.flashStrength = Math.max(state.flashStrength, strength);
    hud.flashWhite(strength);
  },
  startChannel(bot, type) {
    hud.killFeed(`${bot.team === 'ember' ? 'EMBER' : 'WARDEN'} bot is ${type === 'plant' ? 'planting' : 'defusing'} the Spike`);
  },
  onSpikePickup(bot) {
    hud.killFeed('A teammate picked up the Spike');
    hud.setBomb('SPIKE WITH A TEAMMATE', false);
  },
  completeChannel(bot, type) {
    if (type === 'plant') plantBomb(bot.planSite, bot);
    else defuseBomb(bot);
  },
  damageEntity(entity, dmg, part, attacker) { damageEntity(entity, dmg, part, attacker); },
};
botCtx.game = game;

combat = createCombat(scene, world, game);
hud.setMinimapWorld(world);

let viewModel = createViewModel(camera, state.weapon);
let adsFov = 74;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;

const direction = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const stageRay = new THREE.Raycaster();

// For staged shots: the nearest enemy the camera can actually see (clear LOS).
function visibleTarget(fromPos, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const b of candidates) {
    if (!b.alive) continue;
    const target = _v3.set(b.pos.x, b.pos.y + 1.3, b.pos.z);
    const d = fromPos.distanceTo(target);
    if (d >= bestD) continue;
    direction.copy(target).sub(fromPos).normalize();
    stageRay.set(fromPos, direction);
    stageRay.far = d;
    if (stageRay.intersectObjects(world.shootables, false).length) continue;
    best = b;
    bestD = d;
  }
  return best;
}

function weaponDef() { return WEAPONS[state.weapon]; }

function switchWeapon(id) {
  if (!state.owned[id] || state.weapon === id) return;
  state.weapon = id;
  const def = weaponDef();
  state.mag = def.mag;
  state.reserve = def.reserve;
  state.reloading = 0;
  state.fireTimer = 0;
  camera.remove(viewModel.model);
  viewModel = createViewModel(camera, id);
  hud.setWeapon(def.name);
  hud.setAmmo(state.mag, state.reserve);
}

function startMatch() {
  hud.hideOverlay();
  state.phase = 'buy';
  state.round = 1;
  state.score = { ember: 0, warden: 0 };
  state.money = 800;
  state.lossStreak = 0;
  state.owned = { pistol: true, rifle: false, smg: false, sniper: false };
  state.weapon = 'pistol';
  state.grenades = { frag: 0, smoke: 0, flash: 0 };
  body.health = 100;
  body.armor = 0;
  body.alive = true;
  body.kills = 0;
  switchWeapon('pistol');
  startRound();
}

function startRound() {
  state.phase = 'buy';
  state.timer = BUY_TIME;
  state.playerChannel = null;
  body.alive = true;
  body.health = 100;
  body.armor = state.armor > 0 ? state.armor : 0;
  body.position.copy(world.spawnEmber[0]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0; // north, down the map
  body.pitch = 0;
  const def = weaponDef();
  state.mag = def.mag;
  state.reserve = def.reserve;
  state.reloading = 0;
  const { plan, spikeHolder } = resetBots(bots.bots, world, bots.nav, state.round, random, body);
  state.bomb.state = 'carried';
  state.bomb.carrier = spikeHolder ? spikeHolder : body;
  state.bomb.site = null;
  state.bomb.timer = BOMB_FUSE;
  bots.bots.forEach((b) => { b.lastRoundWon = false; });
  hud.setRound(state.round, MAX_ROUNDS);
  hud.setScore(state.score.ember, state.score.warden);
  hud.setMoney(state.money);
  hud.setBomb(state.bomb.carrier === body ? 'YOU HAVE THE SPIKE' : 'SPIKE WITH A TEAMMATE', false);
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(state.mag, state.reserve);
  hud.setWeapon(def.name);
  hud.setGrenades(grenadeList());
  if (!shot) showBuyMenu();
  hud.banner(`ROUND ${state.round}`, `Plan: ${plan === 'aRush' ? 'Rush A' : plan === 'aSplit' ? 'Split A' : plan === 'bRush' ? 'Rush B' : 'Fake mid, hit B'} — buy up, then deploy`, 3000);
}

function grenadeList() {
  return [
    { id: 'frag', name: 'FRAG', count: state.grenades.frag },
    { id: 'smoke', name: 'SMOKE', count: state.grenades.smoke },
    { id: 'flash', name: 'FLASH', count: state.grenades.flash },
  ].filter((g) => g.count > 0);
}

function buyItems() {
  return [
    { id: 'rifle', key: '1', name: 'VK-9 ROOK rifle', desc: '30 rounds, full-auto, the workhorse', price: 2700, owned: state.owned.rifle },
    { id: 'smg', key: '2', name: 'HORNET SMG', desc: 'Fast, close range, 32 rounds', price: 1500, owned: state.owned.smg },
    { id: 'sniper', key: '3', name: 'LONGBOW sniper', desc: 'One shot, one kill. Right-click to scope', price: 4750, owned: state.owned.sniper },
    { id: 'frag', key: '4', name: 'EMBER FRAG grenade', desc: '1.6 s fuse, big radius', price: 300, owned: false },
    { id: 'smoke', key: '5', name: 'VEIL SMOKE grenade', desc: 'Blocks sight for 12 s', price: 300, owned: false },
    { id: 'flash', key: '6', name: 'STROBE FLASH grenade', desc: 'Blinds anyone looking at it', price: 200, owned: false },
    { id: 'armor', key: '7', name: 'KEVLAR armor', desc: 'Absorbs half of incoming damage', price: ARMOR_PRICE, owned: body.armor > 0 },
  ];
}

function showBuyMenu() {
  hud.showBuy(buyItems(), state.money, (id) => buy(id), () => startLive());
}

function buy(id) {
  if (id === 'armor') {
    if (body.armor > 0 || state.money < ARMOR_PRICE) return;
    state.money -= ARMOR_PRICE;
    body.armor = ARMOR_AMOUNT;
  } else if (WEAPONS[id]) {
    if (state.owned[id] || state.money < WEAPONS[id].price) return;
    state.money -= WEAPONS[id].price;
    state.owned[id] = true;
    switchWeapon(id);
  } else if (GRENADES[id]) {
    if (state.grenades[id] >= 2 || state.money < GRENADES[id].price) return;
    state.money -= GRENADES[id].price;
    state.grenades[id]++;
  }
  audio.buy();
  hud.setMoney(state.money);
  hud.setHealth(body.health, body.armor);
  hud.setGrenades(grenadeList());
  showBuyMenu();
}

function startLive() {
  if (state.phase !== 'buy') return;
  state.phase = 'live';
  state.timer = ROUND_TIME;
  game.roundStart = state.now; // the 1.5 s no-fire grace starts here
  hud.hideBuy();
  if (!shot) input.requestLock();
}

function plantBomb(siteName, planter) {
  state.bomb.state = 'planted';
  state.bomb.site = siteName;
  state.bomb.timer = BOMB_FUSE;
  const site = world.sites[siteName];
  state.bomb.pos.copy(site.center);
  hud.setBomb(`SPIKE PLANTED AT ${siteName} — ${Math.ceil(state.bomb.timer)}s`, true);
  hud.banner('SPIKE PLANTED', `Site ${siteName}. Hold it for ${BOMB_FUSE} seconds.`, 3000);
  audio.plant();
  game.noise(state.bomb.pos);
}

function defuseBomb(defuser) {
  state.bomb.state = 'defused';
  endRound('warden', 'SPIKE DEFUSED');
}

function endRound(winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.roundWinner = winner;
  state.roundEndTimer = 4;
  state.score[winner]++;
  const playerWon = winner === 'ember';
  if (playerWon) {
    state.money += 3250;
    state.lossStreak = 0;
    audio.win();
  } else {
    state.lossStreak++;
    state.money += Math.min(2900, 1900 + (state.lossStreak - 1) * 500);
    audio.lose();
  }
  bots.bots.forEach((b) => { b.lastRoundWon = b.team === winner; });
  hud.setScore(state.score.ember, state.score.warden);
  hud.setMoney(state.money);
  hud.banner(playerWon ? 'ROUND WON' : 'ROUND LOST', `${reason} — EMBER ${state.score.ember} : ${state.score.warden} WARDEN`, 3800);
  hud.setBomb('', false);
}

function endMatch() {
  state.phase = 'matchEnd';
  const won = state.score.ember > state.score.warden;
  hud.showOverlay('end', won
    ? `EMBERLINE takes Yard 9, ${state.score.ember}–${state.score.warden}. You finished with ${body.kills} eliminations.`
    : `WARDEN holds Yard 9, ${state.score.ember}–${state.score.warden}. Run it back.`);
  if (document.pointerLockElement) document.exitPointerLock();
}

function damageEntity(entity, dmg, part, attacker) {
  if (!entity.alive) return;
  let remaining = dmg;
  if (entity.armor > 0) {
    const absorbed = Math.min(entity.armor, remaining * 0.5);
    entity.armor -= absorbed;
    remaining -= absorbed;
  }
  entity.health -= remaining;
  const isPlayer = entity === body;
  if (isPlayer) {
    hud.setHealth(entity.health, entity.armor);
    hud.damageFlash(remaining / 100);
    audio.hurt();
  }
  if (entity.health > 0) return;
  entity.health = 0;
  entity.alive = false;
  const attackerName = attacker === body ? 'YOU' : attacker === null ? 'BLAST' : `${attacker.team === 'ember' ? 'EMBER' : 'WARDEN'} bot`;
  const victimName = isPlayer ? 'YOU' : `${entity.team === 'ember' ? 'EMBER' : 'WARDEN'} bot`;
  hud.killFeed(`${attackerName} ${part === 'head' ? '⌖' : '▸'} ${victimName}`);
  if (attacker === body) {
    state.money += 300;
    body.kills++;
    hud.setMoney(state.money);
    hud.hitMarker(true, part === 'head', 200);
    audio.kill();
  }
  if (!isPlayer) {
    entity.group.visible = false;
    entity.target = null;
  }
  // The Spike drops where its carrier fell.
  if (state.bomb.state === 'carried' && state.bomb.carrier === entity) {
    state.bomb.carrier = null;
    state.bomb.dropPos = entity.pos.clone();
    if (entity.hasSpike !== undefined) entity.hasSpike = false;
    hud.setBomb('SPIKE DROPPED — WALK OVER IT TO PICK IT UP', true);
  }
  if (isPlayer) {
    hud.banner('ELIMINATED', 'Your team fights on. Next round you are back in.', 3000);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  checkRoundEnd();
}

function checkRoundEnd() {
  if (state.phase !== 'live') return;
  const emberAlive = bots.bots.filter((b) => b.team === 'ember' && b.alive).length + (body.alive ? 1 : 0);
  const wardenAlive = bots.bots.filter((b) => b.team === 'warden' && b.alive).length;
  if (state.bomb.state === 'planted') return; // the fuse decides now
  if (wardenAlive === 0) endRound('ember', 'ALL DEFENDERS DOWN');
  else if (emberAlive === 0) endRound('warden', 'ALL ATTACKERS DOWN');
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (state.phase === 'menu') startMatch();
    // Locking during the buy phase does not start the round; DEPLOY does.
  } else if (state.phase === 'menu') {
    hud.showOverlay('start');
  } else if (state.phase === 'matchEnd') {
    // overlay stays up
  } else if (state.phase === 'buy') {
    showBuyMenu();
  } else if (state.phase === 'live' && body.alive) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (state.phase === 'matchEnd') { startMatch(); return; }
  if (state.phase === 'menu') { startMatch(); return; }
  input.requestLock();
});

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  if (state.shakeAmt > 0.001) {
    camera.position.x += (Math.random() - 0.5) * state.shakeAmt * 0.15;
    camera.position.y += (Math.random() - 0.5) * state.shakeAmt * 0.15;
    state.shakeAmt *= 0.88;
  }
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const targetFov = input.state.ads && weaponDef().zoom > 1 ? 74 / weaponDef().zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.2) {
    camera.fov += (targetFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
  hud.setScoped(input.state.ads && weaponDef().zoom > 1);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot() {
  const def = weaponDef();
  if (state.reloading > 0 || state.fireTimer > 0) return;
  if (state.mag <= 0) {
    audio.dryFire();
    reload();
    return;
  }
  state.fireTimer = def.fireGap;
  state.mag--;
  camera.getWorldDirection(direction);
  const ads = input.state.ads;
  const spread = currentSpread(def, player.groundSpeed(), def.moveSpeed, ads) * (input.state.keys.has('ShiftLeft') ? 0.7 : 1);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  _eye.copy(camera.position);
  viewModel.muzzle.getWorldPosition(muzzleWorld);
  const result = combat.playerShoot(_eye, direction, def, body, muzzleWorld);
  if (result) {
    hud.hitMarker(false, result.part === 'head');
    audio.hit(result.part === 'head');
  }
  viewModel.flashMat.opacity = 1;
  viewModel.muzzleTime = 0.06;
  viewModel.kick = 1;
  player.recoil(def.kick, (random() * 2 - 1) * def.kick * 0.4);
  audio.shot(state.weapon, false);
  game.noise(body.position);
  hud.setAmmo(state.mag, state.reserve);
}

function reload() {
  const def = weaponDef();
  if (state.reloading > 0 || state.mag >= def.mag || state.reserve <= 0) return;
  state.reloading = def.reloadTime;
  audio.reload();
}

function throwCurrentGrenade() {
  const order = ['frag', 'smoke', 'flash'];
  const type = order.find((t) => state.grenades[t] > 0);
  if (!type) return;
  state.grenades[type]--;
  camera.getWorldDirection(direction);
  _eye.copy(camera.position);
  combat.throwGrenade(type, _eye, direction, body);
  hud.setGrenades(grenadeList());
}

function tryChannel(dt) {
  const keys = input.state.keys;
  const eHeld = keys.has('KeyE');
  if (!eHeld) { state.playerChannel = null; hud.setPlant(null, 0); return; }
  if (state.bomb.state === 'carried' && state.bomb.carrier === body) {
    for (const siteName of ['A', 'B']) {
      const site = world.sites[siteName];
      const d = Math.hypot(site.center.x - body.position.x, site.center.z - body.position.z);
      if (d < site.radius) {
        if (!state.playerChannel || state.playerChannel.type !== 'plant') {
          state.playerChannel = { type: 'plant', t: 0, duration: PLANT_TIME, site: siteName };
        }
        state.playerChannel.t += dt;
        hud.setPlant(`PLANTING SPIKE — SITE ${siteName}`, state.playerChannel.t / PLANT_TIME);
        if (state.playerChannel.t >= PLANT_TIME) {
          plantBomb(siteName, body);
          state.playerChannel = null;
          hud.setPlant(null, 0);
        }
        return;
      }
    }
  }
  if (state.bomb.state === 'planted') {
    const d = Math.hypot(state.bomb.pos.x - body.position.x, state.bomb.pos.z - body.position.z);
    if (d < 2.2) {
      if (!state.playerChannel || state.playerChannel.type !== 'defuse') {
        state.playerChannel = { type: 'defuse', t: 0, duration: DEFUSE_TIME };
      }
      state.playerChannel.t += dt;
      hud.setPlant('DEFUSING SPIKE', state.playerChannel.t / DEFUSE_TIME);
      if (state.playerChannel.t >= DEFUSE_TIME) {
        defuseBomb(body);
        state.playerChannel = null;
        hud.setPlant(null, 0);
      }
      return;
    }
  }
  state.playerChannel = null;
  hud.setPlant(null, 0);
}

function step(dt) {
  state.now += dt;
  game.now = state.now;
  elapsed += dt;

  // Player hitbox follows the player, for bot bullets.
  playerBodyMesh.position.set(body.position.x, body.position.y + 0.85, body.position.z);
  playerHeadMesh.position.set(body.position.x, body.position.y + 1.56, body.position.z);
  playerBodyMesh.rotation.y = body.yaw;
  playerHeadMesh.rotation.y = body.yaw;

  if (state.phase === 'buy') {
    state.timer -= dt;
    if (state.timer <= 0) startLive();
  } else if (state.phase === 'live') {
    state.timer -= dt;
    if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      hud.setBomb(`SPIKE PLANTED AT ${state.bomb.site} — ${Math.ceil(state.bomb.timer)}s`, true);
      if (state.bomb.timer <= 0) {
        state.bomb.state = 'detonated';
        combat.explode(state.bomb.pos, 9, 200, null);
        endRound('ember', 'SPIKE DETONATED');
      }
    } else if (state.timer <= 0) {
      endRound('warden', 'TIME EXPIRED — SITE HELD');
    }
  } else if (state.phase === 'roundEnd') {
    state.roundEndTimer -= dt;
    if (state.roundEndTimer <= 0) {
      if (state.score.ember >= WIN_SCORE || state.score.warden >= WIN_SCORE || state.round >= MAX_ROUNDS) endMatch();
      else { state.round++; startRound(); }
    }
  }

  if (state.phase === 'live' || state.phase === 'buy' || state.phase === 'roundEnd') {
    const pressed = input.takePressed();
    if (pressed.has('KeyB') && state.phase === 'buy') {
      if (document.pointerLockElement) document.exitPointerLock();
      showBuyMenu();
    }
    if (state.phase === 'buy') {
      if (pressed.has('Digit1')) buy('rifle');
      if (pressed.has('Digit2')) buy('smg');
      if (pressed.has('Digit3')) buy('sniper');
      if (pressed.has('Digit4')) buy('frag');
      if (pressed.has('Digit5')) buy('smoke');
      if (pressed.has('Digit6')) buy('flash');
      if (pressed.has('Digit7')) buy('armor');
    }
    if (state.phase === 'live' && body.alive) {
      const def = weaponDef();
      const walkSpeed = def.moveSpeed * (input.state.ads ? 0.6 : 1) * (input.state.keys.has('ShiftLeft') ? 0.55 : 1);
      player.step(dt, input.state.keys, walkSpeed);
      if (pressed.has('KeyR')) reload();
      if (pressed.has('KeyG')) throwCurrentGrenade();
      if (pressed.has('Digit1')) switchWeapon('pistol');
      if (pressed.has('Digit2')) switchWeapon('rifle');
      if (pressed.has('Digit3')) switchWeapon('smg');
      if (pressed.has('Digit4')) switchWeapon('sniper');
      if (pressed.has('KeyM')) {
        const muted = audio.toggleMute();
        hud.killFeed(muted ? 'Sound muted (M)' : 'Sound on (M)');
      }
      if (input.state.firing) shoot();
      if (!shot) tryChannel(dt);
      // Pick up a dropped Spike by walking over it.
      if (state.bomb.state === 'carried' && !state.bomb.carrier && state.bomb.dropPos) {
        const d = Math.hypot(state.bomb.dropPos.x - body.position.x, state.bomb.dropPos.z - body.position.z);
        if (d < 1.4) {
          state.bomb.carrier = body;
          state.bomb.dropPos = null;
          hud.setBomb('YOU HAVE THE SPIKE', false);
          hud.killFeed('YOU picked up the Spike');
        }
      }
    }
    if (state.phase === 'live') updateBots(botCtx, dt, state.now);
    combat.update(dt);
  }

  // Weapon timers.
  if (state.fireTimer > 0) state.fireTimer -= dt;
  if (state.reloading > 0) {
    state.reloading -= dt;
    if (state.reloading <= 0) {
      const def = weaponDef();
      const need = def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
      hud.setAmmo(state.mag, state.reserve);
    }
  }
  if (viewModel.muzzleTime > 0) {
    viewModel.muzzleTime -= dt;
    viewModel.flashMat.opacity = Math.max(0, viewModel.muzzleTime / 0.06);
  }
  if (viewModel.kick > 0) {
    viewModel.kick = Math.max(0, viewModel.kick - dt * 8);
    viewModel.model.position.z = -0.5 + viewModel.kick * 0.05;
  }

  // HUD, every step.
  hud.setTimer(state.phase === 'buy' ? state.timer : state.phase === 'live' ? state.timer : 0);
  const emberAlive = bots.bots.filter((b) => b.team === 'ember' && b.alive).length + (body.alive ? 1 : 0);
  const wardenAlive = bots.bots.filter((b) => b.team === 'warden' && b.alive).length;
  hud.setPips(emberAlive, wardenAlive);
  const spreadPx = 5 + player.groundSpeed() * 2.2 + (input.state.ads ? -2 : 0);
  hud.setCrosshairGap(Math.max(3, spreadPx));
  hud.drawMinimap(body.position, body.yaw, bots.bots, state.bomb);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (body.alive && (state.phase === 'live' || state.phase === 'buy')) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // Live round but no pointer lock (the buy timer ran out while the player was still
    // in the menu): offer the click-to-deploy overlay instead of a dead screen.
    if (!shot && state.phase === 'live' && body.alive && !input.state.locked && document.getElementById('overlay').hidden) {
      hud.showOverlay('paused');
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  state.phase = 'live';
  state.timer = ROUND_TIME;
  hud.hideBuy();
  if (name === 'start') {
    state.phase = 'buy';
    body.position.set(0, 0, 15);
    body.yaw = 0; // north, down the map
    body.pitch = 0;
    settle(10);
    showBuyMenu();
    hud.banner('ROUND 1', 'Buy up, then deploy', 4000);
  } else if (name === 'play') {
    // Two seconds of live play: bots push up the lanes. Then the player steps into
    // mid lane, aims at the nearest defender with a clear line of sight, and fires.
    settle(120);
    body.position.set(0, 0, 6);
    body.velocity.set(0, 0, 0);
    syncCamera();
    const enemy = visibleTarget(camera.position, bots.bots.filter((b) => b.team === 'warden'))
      || bots.bots.find((b) => b.team === 'warden' && b.alive);
    if (enemy) {
      aimAt(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.3, enemy.pos.z));
      shoot();
      settle(2);
    }
  } else if (name === 'plant') {
    // Planting at site A, seen from inside the site: the A letter on the floor, the
    // smoke at the entrance, and the progress bar.
    state.bomb.carrier = body;
    body.position.set(-16.5, 0, -16);
    body.yaw = 0;
    body.pitch = 0;
    settle(60);
    combat.throwGrenade('smoke', new THREE.Vector3(-14, 1.6, -8), new THREE.Vector3(-0.3, 0.35, -0.7), body);
    settle(100);
    state.playerChannel = { type: 'plant', t: PLANT_TIME * 0.55, duration: PLANT_TIME, site: 'A' };
    aimAt(new THREE.Vector3(-13, 1.2, -8));
    settle(2);
    hud.setPlant('PLANTING SPIKE — SITE A', 0.55);
    hud.setBomb('YOU HAVE THE SPIKE', false);
  } else if (name === 'end') {
    // Round won: bots have had four seconds to reach the site, two defenders down.
    // The camera finds the nearest living teammate and frames them at the site.
    settle(240);
    const dead = bots.bots.filter((b) => b.team === 'warden').slice(0, 2);
    dead.forEach((b) => { b.alive = false; b.group.visible = false; });
    state.score.ember = 1;
    hud.setScore(1, 0);
    hud.setBomb('', false);
    hud.banner('ROUND WON', 'ALL DEFENDERS DOWN — EMBER 1 : 0 WARDEN', 4000);
    const ally = bots.bots.find((b) => b.team === 'ember' && b.alive);
    if (ally) {
      body.position.set(
        Math.max(-23, Math.min(23, ally.pos.x + 2)),
        0,
        Math.max(-17, Math.min(17, ally.pos.z + 4)),
      );
      aimAt(new THREE.Vector3(ally.pos.x, ally.pos.y + 1.3, ally.pos.z));
    } else {
      body.position.set(-10, 0, -6);
      aimAt(new THREE.Vector3(-16, 1.5, -12));
    }
    settle(2);
  }
  hud.setHealth(body.health, body.armor);
  hud.setMoney(state.money);
  hud.setAmmo(state.mag, state.reserve);
  hud.setWeapon(weaponDef().name);
  hud.setTimer(state.timer);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setAmmo(state.mag, state.reserve);
hud.setWeapon(weaponDef().name);
hud.setHealth(body.health, body.armor);
hud.setMoney(state.money);
hud.setScore(0, 0);
hud.setRound(1, MAX_ROUNDS);
hud.setTimer(BUY_TIME);
// Debug handle for headless tests (?debug=1): read-only view of the match state.
if (params.get('debug')) {
  window.__game = {
    state,
    bots: bots.bots,
    body,
    snapshot() {
      return {
        phase: state.phase,
        round: state.round,
        score: { ...state.score },
        timer: Math.round(state.timer * 10) / 10,
        money: state.money,
        bomb: { state: state.bomb.state, site: state.bomb.site, carrier: state.bomb.carrier === body ? 'player' : state.bomb.carrier ? state.bomb.carrier.team + ' bot' : null },
        player: { hp: Math.round(body.health), alive: body.alive, pos: [Math.round(body.position.x * 10) / 10, Math.round(body.position.z * 10) / 10] },
        bots: bots.bots.map((b) => ({ team: b.team, alive: b.alive, hp: Math.round(b.health), state: b.state, pos: [Math.round(b.pos.x * 10) / 10, Math.round(b.pos.z * 10) / 10] })),
      };
    },
  };
}
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
