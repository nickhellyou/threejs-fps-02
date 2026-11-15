// The other nine players. Four allies, five enemies, all bots. A bot is a state machine:
// buy, pick a plan, walk a waypoint route, hold an angle, fight what it sees, plant or
// defuse when the round asks for it. Bots see through a vision cone plus a real LOS
// raycast, hear gunshots, react with a human delay, and shoot in bursts with real
// spread, so a fight with them is a fight, not a script.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapon.js';

const BOT_SPEED = 4.2;
const BOT_RADIUS = 0.4;
const BOT_HEIGHT = 1.7;
const VISION_RANGE = 30; // spawn-to-spawn is 30 m: bots cannot duel across the map
const VISION_HALF_FOV = 1.05; // ~60 degrees each side
const HEAR_RANGE = 26;
const BOT_DAMAGE = 18; // six body hits to kill: fights last, rounds last
const BOT_HEAD_MULT = 4;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();

// Breadth-first search over the waypoint graph. Returns node indices, start to goal.
export function findPath(nodes, adj, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const prev = new Int16Array(nodes.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === toIdx) {
        const path = [toIdx];
        let n = toIdx;
        while (n !== fromIdx) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(next);
    }
  }
  return [fromIdx, toIdx];
}

function nearestNode(nodes, pos) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i].x - pos.x;
    const dz = nodes[i].z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function createBots(scene, world, game) {
  const adj = world.waypoints.map(() => []);
  for (const [a, b] of world.edges) { adj[a].push(b); adj[b].push(a); }
  const nav = { nodes: world.waypoints, adj };

  const bots = [];
  const bodyGeo = new THREE.BoxGeometry(0.55, 1.05, 0.32);
  const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  const stripeGeo = new THREE.BoxGeometry(0.57, 0.12, 0.34);

  for (let i = 0; i < 9; i++) {
    const team = i < 4 ? 'ember' : 'warden';
    const color = team === 'ember' ? PALETTE.accent : PALETTE.teal;
    const group = new THREE.Group();
    group.visible = false; // hidden until the first round spawns the bots
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#232a38'), roughness: 0.85, metalness: 0.1 });
    const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(color), emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    const stripe = new THREE.Mesh(stripeGeo, teamMat);
    stripe.position.y = 1.18;
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.56;
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.36), teamMat);
    visor.position.y = 1.56;
    group.add(body, stripe, head, visor);
    scene.add(group);

    const bot = {
      id: i, team, alive: true, health: 100, armor: 0,
      pos: new THREE.Vector3(), yaw: 0,
      group, body, head,
      weapon: 'pistol', mag: 12, reserve: 36, reloading: 0,
      path: [], pathIndex: 0, state: 'idle',
      fireTimer: 0, burstLeft: 0, burstTimer: 0, aimTime: 0,
      target: null, targetKind: null, reaction: 0,
      plan: null, holdPos: null, holdYaw: 0, holdUntil: 0,
      channel: null, investigate: null, blindUntil: 0,
      speed: BOT_SPEED, money: 800, kills: 0, hasSpike: false,
      node: 0, seed: Math.random(),
    };
    body.userData.entity = bot;
    body.userData.part = 'body';
    head.userData.entity = bot;
    head.userData.part = 'head';
    bots.push(bot);
  }

  return { bots, nav, hitMeshes: bots.flatMap((b) => [b.body, b.head]) };
}

// A round starts: spawn, buy, pick a plan. Attackers pick one of four plans; defenders
// split two to A, two to B, one roaming mid. The Spike goes to the player on round 1
// and to a random attacker afterwards, so the player is never forced to carry it.
export function resetBots(bots, world, nav, round, rng, player) {
  const plans = ['aRush', 'aSplit', 'bRush', 'midFake'];
  const plan = plans[Math.floor(rng() * plans.length)];
  const spikeHolder = round === 1 ? null : bots[Math.floor(rng() * 4)];
  bots.forEach((bot, i) => {
    bot.alive = true;
    bot.health = 100;
    bot.armor = 0;
    // Round 1 everyone starts on $800; after that, round income buys better guns.
    if (round > 1) bot.money += bot.lastRoundWon ? 3250 : 1900;
    if (bot.money >= 2700 && bot.weapon !== 'rifle') { bot.weapon = 'rifle'; bot.money -= 2700; }
    bot.mag = WEAPONS[bot.weapon].mag;
    bot.reserve = WEAPONS[bot.weapon].reserve;
    bot.reloading = 0;
    bot.state = 'move';
    bot.channel = null;
    bot.target = null;
    bot.hasSpike = bot === spikeHolder;
    bot.investigate = null;
    bot.blindUntil = 0;
    bot.stuckTime = 0;
    bot.lastPos = bot.pos.clone();
    const spawn = bot.team === 'ember' ? world.spawnEmber[i] : world.spawnWarden[i - 4];
    bot.pos.copy(spawn);
    bot.yaw = bot.team === 'ember' ? 0 : Math.PI; // attackers face north (-z), defenders south
    bot.group.position.copy(bot.pos);
    bot.group.visible = true;
    bot.plan = plan;
    // Attackers: route to their site along the waypoint graph. Defenders: hold an angle.
    if (bot.team === 'ember') {
      const site = plan === 'bRush' ? 'B' : plan === 'midFake' && i >= 2 ? 'B' : 'A';
      const entry = site === 'A' ? (i % 2 === 0 ? 11 : 19) : (i % 2 === 0 ? 15 : 23);
      bot.planSite = site;
      bot.path = findPath(nav.nodes, nav.adj, nearestNode(nav.nodes, bot.pos), entry);
      bot.holdPos = site === 'A' ? world.sites.A.center : world.sites.B.center;
    } else {
      const hold = i - 4;
      const holdNodes = [16, 20, 17, 21, 5];
      const node = holdNodes[hold];
      bot.holdPos = world.waypoints[node].clone();
      bot.holdYaw = Math.atan2(-bot.holdPos.x, -bot.holdPos.z);
      bot.path = findPath(nav.nodes, nav.adj, nearestNode(nav.nodes, bot.pos), node);
      bot.planSite = hold < 2 ? 'A' : hold < 4 ? 'B' : 'mid';
    }
    bot.pathIndex = 0;
  });
  return { plan, spikeHolder };
}

function losClear(world, from, to, hitMeshes, ignore) {
  _v1.copy(to).sub(from);
  const dist = _v1.length();
  if (dist < 0.01) return true;
  _dir.copy(_v1).normalize();
  _ray.set(from, _dir);
  _ray.far = dist;
  const wallHits = _ray.intersectObjects(world.shootables, false);
  if (wallHits.length) return false;
  return true;
}

// Smoke blocks sight: a segment that passes through a smoke sphere is blind.
export function segmentBlockedBySmoke(from, to, spheres) {
  for (const s of spheres) {
    // Closest point on the segment to the sphere centre.
    _v1.copy(to).sub(from);
    const len2 = _v1.lengthSq();
    if (len2 < 0.001) continue;
    let t = (s.center.x - from.x) * _v1.x + (s.center.y - from.y) * _v1.y + (s.center.z - from.z) * _v1.z;
    t /= len2;
    t = Math.max(0, Math.min(1, t));
    const cx = from.x + _v1.x * t;
    const cy = from.y + _v1.y * t;
    const cz = from.z + _v1.z * t;
    const d2 = (cx - s.center.x) ** 2 + (cy - s.center.y) ** 2 + (cz - s.center.z) ** 2;
    if (d2 < s.radius * s.radius) return true;
  }
  return false;
}

// One bot, one fixed step. Vision runs on a 0.1 s tick so nine bots do not raycast
// every frame; movement and shooting run every step.
export function updateBots(ctx, dt, now) {
  const { bots, nav, world, game } = ctx;
  const player = game.player;
  const shootables = world.shootables;
  const hitMeshes = ctx.hitMeshes;

  for (const bot of bots) {
    if (!bot.alive) continue;
    if (now < bot.blindUntil) { bot.target = null; }
    bot.group.position.copy(bot.pos);
    bot.group.rotation.y = bot.yaw;

    // --- senses, 10 times a second ---
    if (now - (bot.senseAt || 0) >= 0.1) {
      bot.senseAt = now;
      bot.target = null;
      bot.targetKind = null;
      let bestScore = Infinity;
      const candidates = [];
      if (player.alive) candidates.push({ entity: player, kind: 'player', pos: _v2.set(player.pos.x, player.pos.y + 1.4, player.pos.z) });
      for (const other of bots) {
        if (other === bot || !other.alive || other.team === bot.team) continue;
        candidates.push({ entity: other, kind: 'bot', pos: _v3.set(other.pos.x, other.pos.y + 1.3, other.pos.z) });
      }
      for (const cand of candidates) {
        const eye = _v1.set(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
        const dx = cand.pos.x - eye.x;
        const dy = cand.pos.y - eye.y;
        const dz = cand.pos.z - eye.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > VISION_RANGE) continue;
        const toTarget = Math.atan2(-dx, -dz);
        let ang = toTarget - bot.yaw;
        while (ang > Math.PI) ang -= Math.PI * 2;
        while (ang < -Math.PI) ang += Math.PI * 2;
        if (Math.abs(ang) > VISION_HALF_FOV) continue;
        if (!losClear(world, eye, cand.pos, hitMeshes, bot)) continue;
        if (game.blocksSight && game.blocksSight(eye, cand.pos)) continue;
        const score = dist + (cand.kind === 'player' ? 0 : 2);
        if (score < bestScore) { bestScore = score; bot.target = cand.entity; bot.targetKind = cand.kind; }
      }
      if (bot.target && bot.aimTime === 0) bot.reaction = 0.4 + bot.seed * 0.3;
      if (!bot.target) {
        bot.aimTime = 0;
        if (bot.state === 'engage') bot.state = 'move';
      }
      // Hearing: a recent gunshot or explosion pulls the bot toward the noise.
      if (!bot.target && game.lastNoise && now - game.lastNoise.t < 1.5) {
        const n = game.lastNoise;
        const d = Math.hypot(n.pos.x - bot.pos.x, n.pos.z - bot.pos.z);
        if (d < HEAR_RANGE && d > 3) bot.investigate = n.pos.clone();
      }
    }

    // --- channeling (plant / defuse) ---
    if (bot.channel) {
      const ch = bot.channel;
      ch.t += dt;
      if (ch.t >= ch.duration) {
        game.completeChannel(bot, ch.type);
        bot.channel = null;
      }
      continue;
    }

    // --- combat ---
    if (bot.target && now >= bot.blindUntil) {
      const tPos = bot.targetKind === 'player'
        ? _v2.set(player.pos.x, player.pos.y + 1.3, player.pos.z)
        : _v2.set(bot.target.pos.x, bot.target.pos.y + 1.3, bot.target.pos.z);
      const dx = tPos.x - bot.pos.x;
      const dz = tPos.z - bot.pos.z;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.aimTime += dt;
      bot.state = 'engage';
      // No firing in the first 1.5 s of a round: everyone gets out of spawn first.
      if (bot.aimTime > bot.reaction && bot.reloading <= 0 && now - game.roundStart >= 1.5) {
        bot.fireTimer -= dt;
        if (bot.fireTimer <= 0 && bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(bot.seed * 3);
          bot.burstTimer = 0;
        }
        if (bot.burstLeft > 0 && bot.mag > 0) {
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0) {
            bot.burstTimer = 0.11;
            bot.burstLeft--;
            botFire(ctx, bot, tPos);
            if (bot.mag <= 0) { bot.reloading = WEAPONS[bot.weapon].reloadTime; bot.mag = 0; }
          }
        }
      }
      if (bot.mag <= 0 && bot.reloading <= 0) { bot.reloading = WEAPONS[bot.weapon].reloadTime; }
      // No return here: an engaged bot keeps walking toward its objective, slower,
      // instead of planting its feet at spawn and duelling across the map.
    }
    if (bot.reloading > 0) {
      bot.reloading -= dt;
      if (bot.reloading <= 0) { bot.mag = WEAPONS[bot.weapon].mag; bot.reserve -= WEAPONS[bot.weapon].mag; }
    }

    // --- bomb duties ---
    const bomb = game.bomb;
    // A dropped Spike is fair game: the nearest attacker walks over and picks it up.
    if (bot.team === 'ember' && bomb.state === 'carried' && !bomb.carrier && bomb.dropPos) {
      const d = Math.hypot(bomb.dropPos.x - bot.pos.x, bomb.dropPos.z - bot.pos.z);
      if (d < 1.4) {
        bomb.carrier = bot;
        bot.hasSpike = true;
        bomb.dropPos = null;
        game.onSpikePickup && game.onSpikePickup(bot);
        bot.path = findPath(nav.nodes, nav.adj, nearestNode(nav.nodes, bot.pos), bot.planSite === 'B' ? 20 : 16);
        bot.pathIndex = 0;
        bot.state = 'move';
      } else if (bot.state !== 'move' && !bot.target) {
        bot.path = findPath(nav.nodes, nav.adj, nearestNode(nav.nodes, bot.pos), nearestNode(nav.nodes, bomb.dropPos));
        bot.pathIndex = 0;
        bot.state = 'move';
      }
    }
    if (bot.team === 'ember' && bot.hasSpike && bomb.state === 'carried' && bot.state !== 'plant') {
      const site = bot.planSite === 'B' ? world.sites.B : world.sites.A;
      const d = Math.hypot(site.center.x - bot.pos.x, site.center.z - bot.pos.z);
      if (d < site.radius * 0.7) {
        bot.channel = { type: 'plant', t: 0, duration: 3 };
        game.startChannel(bot, 'plant');
        continue;
      }
    }
    if (bot.team === 'warden' && bomb.state === 'planted') {
      const d = Math.hypot(bomb.pos.x - bot.pos.x, bomb.pos.z - bot.pos.z);
      if (d < 1.6) {
        bot.channel = { type: 'defuse', t: 0, duration: 5 };
        game.startChannel(bot, 'defuse');
        continue;
      }
      bot.path = findPath(nav.nodes, nav.adj, nearestNode(nav.nodes, bot.pos), bot.planSite === 'B' ? 20 : 16);
      bot.pathIndex = 0;
      bot.state = 'move';
    }

    // --- movement along the route ---
    if (bot.state === 'move' || bot.state === 'engage') {
      let dest = null;
      if (bot.pathIndex < bot.path.length) {
        dest = nav.nodes[bot.path[bot.pathIndex]];
      } else if (bot.investigate) {
        dest = bot.investigate;
      } else if (bot.holdPos) {
        dest = bot.holdPos;
      }
      if (dest) {
        const dx = dest.x - bot.pos.x;
        const dz = dest.z - bot.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.7) {
          if (bot.pathIndex < bot.path.length) bot.pathIndex++;
          else if (bot.investigate) bot.investigate = null;
          else if (bot.holdPos) {
            bot.state = 'hold';
            bot.holdUntil = now + 6 + bot.seed * 8;
            bot.holdYaw = bot.holdYaw || Math.atan2(-dx, -dz);
          }
        } else {
          // An engaged bot walks slower: moving and shooting is a tradeoff.
          const speed = bot.state === 'engage' ? bot.speed * 0.55 : bot.speed;
          const step = Math.min(dist, speed * dt);
          const nx = bot.pos.x + (dx / dist) * step;
          const nz = bot.pos.z + (dz / dist) * step;
          moveWithCollision(bot.pos, nx, nz, world.colliders);
          if (!bot.target) bot.yaw = Math.atan2(-dx, -dz);
          // Stuck against a wall: re-route along the graph instead of pushing forever.
          const moved = Math.hypot(bot.pos.x - bot.lastPos.x, bot.pos.z - bot.lastPos.z);
          if (moved < 0.02) {
            bot.stuckTime += dt;
            if (bot.stuckTime > 1.2) {
              bot.stuckTime = 0;
              const goal = dest === bot.investigate ? dest : nav.nodes[bot.path[bot.path.length - 1]];
              bot.path = findPath(nav.nodes, nav.adj, nearestNode(nav.nodes, bot.pos), nearestNode(nav.nodes, goal));
              bot.pathIndex = 0;
              bot.investigate = null;
            }
          } else {
            bot.stuckTime = 0;
          }
          bot.lastPos.copy(bot.pos);
        }
      }
    } else if (bot.state === 'hold') {
      bot.yaw = bot.holdYaw;
      if (now > bot.holdUntil) {
        // Rotate to a new angle, or patrol to the other site entrance.
        bot.holdYaw += (bot.seed - 0.5) * 2.4;
        bot.holdUntil = now + 5 + bot.seed * 6;
      }
    }
  }
}

// A bot shot: a real ray with spread from the bot's muzzle. The first thing it hits
// decides the outcome: a wall, a body, or a head. Tracer and sound go through the game.
function botFire(ctx, bot, targetPos) {
  const { world, game } = ctx;
  bot.mag--;
  const eye = _v1.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
  const dist = eye.distanceTo(targetPos);
  const spread = 0.02 + dist * 0.0016; // moving bots spray: a burst at 20 m is mostly misses
  _dir.copy(targetPos).sub(eye).normalize();
  _dir.x += (Math.random() - 0.5) * spread * 2;
  _dir.y += (Math.random() - 0.5) * spread * 2;
  _dir.z += (Math.random() - 0.5) * spread * 2;
  _dir.normalize();
  _ray.set(eye, _dir);
  _ray.far = 60;
  const wallHits = _ray.intersectObjects(world.shootables, false);
  const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
  const charHits = _ray.intersectObjects(ctx.hitMeshes.concat(game.playerHitMeshes), false);
  const muzzle = eye.clone();
  let end = eye.clone().addScaledVector(_dir, Math.min(wallDist, 60));
  if (charHits.length && charHits[0].distance < wallDist) {
    const hit = charHits[0];
    const entity = hit.object.userData.entity;
    const part = hit.object.userData.part;
    end = hit.point.clone();
    if (entity && entity !== bot && entity.alive) {
      const dmg = part === 'head' ? BOT_DAMAGE * BOT_HEAD_MULT : BOT_DAMAGE;
      game.damageEntity(entity, dmg, part, bot);
    }
  }
  game.spawnTracer(muzzle, end, bot.team === 'ember' ? PALETTE.accent : PALETTE.teal);
  game.playShot(bot.pos, bot.weapon, true);
  game.noise(bot.pos, 26);
}

// Axis-separated movement with AABB collision, shared with the player code.
export function moveWithCollision(pos, nx, nz, colliders) {
  const half = BOT_RADIUS;
  const height = BOT_HEIGHT;
  const box = new THREE.Box3();
  const tryMove = (x, z) => {
    // Lift the probe 0.05 m: the floor slab tops out at y = 0, and a box that merely
    // touches it still counts as intersecting, which would pin every bot to its spawn.
    box.min.set(x - half, pos.y + 0.05, z - half);
    box.max.set(x + half, pos.y + height, z + half);
    for (const c of colliders) {
      if (box.intersectsBox(c)) return false;
    }
    return true;
  };
  if (tryMove(nx, pos.z)) pos.x = nx;
  if (tryMove(pos.x, nz)) pos.z = nz;
}
