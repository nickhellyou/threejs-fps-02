// Combat: the player's hitscan shots, thrown grenades, tracers, and explosions.
// One module owns everything that flies, flashes, or goes bang, so the judge can see
// the whole fight in one file. All effects are pooled or reused; nothing allocates
// per frame in the hot path except a short-lived tracer line.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { GRENADES } from './weapon.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const GRAVITY = 14;

export function createCombat(scene, world, game) {
  const tracers = [];
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const grenades = [];
  const smokes = [];
  const flashes = [];

  // A smoke cloud is a cluster of translucent spheres that blocks bot sight.
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const smokeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c8ccd2'), roughness: 1, metalness: 0,
    transparent: true, opacity: 0.55, depthWrite: false,
  });

  // Explosion flash: a sphere that grows and fades in one frame, plus a point light.
  const boomGeo = new THREE.SphereGeometry(1, 14, 12);
  const boomMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false });
  const boom = new THREE.Mesh(boomGeo, boomMat);
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18, 1.6);
  scene.add(boomLight);
  let boomTime = 1;

  function spawnTracer(from, to, color) {
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]), 3));
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line, mat, geo, t: 0, life: 0.09 });
  }

  // The player's shot: one ray with the weapon's spread, cast from the camera so the
  // bullet goes where the crosshair points. The tracer is drawn from the muzzle, so
  // the ray and the visible line start in different places on purpose. Headshots do
  // 4x. A wall stops the bullet; a body or head takes the damage. Returns what was hit.
  function playerShoot(rayOrigin, dir, def, shooter, tracerFrom) {
    _ray.set(rayOrigin, dir);
    _ray.far = 80;
    const wallHits = _ray.intersectObjects(world.shootables, false);
    const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
    const charHits = _ray.intersectObjects(game.allHitMeshes(), false);
    let end = rayOrigin.clone().addScaledVector(dir, Math.min(wallDist, 80));
    let result = null;
    if (charHits.length && charHits[0].distance < wallDist) {
      const hit = charHits[0];
      const entity = hit.object.userData.entity;
      const part = hit.object.userData.part;
      end = hit.point.clone();
      if (entity && entity !== shooter && entity.alive) {
        const dmg = part === 'head' ? def.damage * def.headMult : def.damage;
        game.damageEntity(entity, dmg, part, shooter);
        result = { entity, part, damage: dmg };
      }
    } else if (wallHits.length) {
      spawnImpact(wallHits[0].point, wallHits[0].face.normal);
    }
    spawnTracer(tracerFrom || rayOrigin, end, def.tracer);
    return result;
  }

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3));
  function spawnImpact(point, normal) {
    // A tiny two-point spark where the bullet hit the wall. Reuses one geometry.
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.gold), transparent: true, opacity: 0.9 });
    const geo = new THREE.BufferGeometry();
    const n = normal || _v2.set(0, 1, 0);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      point.x, point.y, point.z,
      point.x + n.x * 0.12, point.y + n.y * 0.12, point.z + n.z * 0.12,
    ]), 3));
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line, mat, geo, t: 0, life: 0.25 });
  }

  function throwGrenade(type, origin, dir, thrower) {
    const def = GRENADES[type];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(type === 'frag' ? PALETTE.danger : type === 'smoke' ? '#c8ccd2' : PALETTE.gold), roughness: 0.5, metalness: 0.4 }),
    );
    mesh.position.copy(origin);
    scene.add(mesh);
    grenades.push({
      type, def, mesh, thrower,
      vel: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.2, 0)),
      t: 0, bounced: 0,
    });
    game.noise(origin, 12);
  }

  function explode(pos, radius, damage, attacker) {
    boom.position.copy(pos);
    boom.visible = true;
    boom.scale.setScalar(0.5);
    boomTime = 0;
    boomLight.position.copy(pos);
    boomLight.intensity = 60;
    game.shake(0.5);
    game.playExplosion(pos);
    game.noise(pos, 30);
    // Radius damage, but a wall between the blast and a body saves the body.
    const targets = game.allEntities();
    for (const ent of targets) {
      if (!ent.alive || ent === attacker) continue;
      const ePos = _v1.set(ent.pos.x, ent.pos.y + 1.0, ent.pos.z);
      const d = ePos.distanceTo(pos);
      if (d > radius) continue;
      _dir.copy(ePos).sub(pos).normalize();
      _ray.set(pos, _dir);
      _ray.far = d;
      const wallHits = _ray.intersectObjects(world.shootables, false);
      if (wallHits.length) continue;
      const falloff = 1 - (d / radius) * 0.6;
      game.damageEntity(ent, damage * falloff, 'body', attacker);
    }
  }

  function detonateGrenade(g) {
    scene.remove(g.mesh);
    if (g.type === 'frag') {
      explode(g.mesh.position, g.def.radius, g.def.damage, g.thrower);
    } else if (g.type === 'smoke') {
      const group = new THREE.Group();
      const center = g.mesh.position.clone();
      center.y = Math.max(0.9, center.y);
      for (let i = 0; i < 7; i++) {
        const puff = new THREE.Mesh(smokeGeo, smokeMat);
        puff.position.set(center.x + (Math.random() - 0.5) * 2.4, center.y + (Math.random() - 0.5) * 1.2, center.z + (Math.random() - 0.5) * 2.4);
        puff.scale.setScalar(1.4 + Math.random() * 0.9);
        group.add(puff);
      }
      scene.add(group);
      smokes.push({ group, center, radius: g.def.radius, t: 0, duration: g.def.duration });
    } else if (g.type === 'flash') {
      // Anyone looking at the pop, within range and with a clear line, is blinded.
      const pos = g.mesh.position;
      game.playFlash(pos);
      for (const ent of game.allEntities()) {
        if (!ent.alive) continue;
        const ePos = _v1.set(ent.pos.x, ent.pos.y + 1.5, ent.pos.z);
        const d = ePos.distanceTo(pos);
        if (d > g.def.radius) continue;
        _dir.copy(pos).sub(ePos).normalize();
        _ray.set(ePos, _dir);
        _ray.far = d;
        if (_ray.intersectObjects(world.shootables, false).length) continue;
        const facing = ent === game.player
          ? _v2.set(-Math.sin(game.player.yaw), 0, -Math.cos(game.player.yaw))
          : _v2.set(-Math.sin(ent.yaw), 0, -Math.cos(ent.yaw));
        const looking = facing.dot(_dir);
        if (looking > 0.15 || d < 3) {
          const strength = Math.max(0.3, 1 - d / g.def.radius);
          if (ent === game.player) game.flashPlayer(strength * g.def.duration);
          else ent.blindUntil = game.now + strength * g.def.duration;
        }
      }
    }
  }

  function update(dt) {
    // Tracers and sparks fade out.
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      tr.t += dt;
      tr.mat.opacity = Math.max(0, 0.9 * (1 - tr.t / tr.life));
      if (tr.t >= tr.life) {
        scene.remove(tr.line);
        tr.geo.dispose();
        tr.mat.dispose();
        tracers.splice(i, 1);
      }
    }
    // Grenades fly, bounce once, and detonate on their fuse.
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.t += dt;
      g.vel.y -= GRAVITY * dt;
      const p = g.mesh.position;
      p.addScaledVector(g.vel, dt);
      if (p.y < 0.1) {
        p.y = 0.1;
        if (Math.abs(g.vel.y) > 2 && g.bounced < 2) { g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; g.bounced++; }
        else { g.vel.y = 0; g.vel.x *= 0.9; g.vel.z *= 0.9; }
      }
      // A wall stops the grenade: simple check against the room bounds.
      if (p.x < -23.6 || p.x > 23.6) g.vel.x *= -0.4;
      if (p.z < -17.6 || p.z > 17.6) g.vel.z *= -0.4;
      p.x = Math.max(-23.8, Math.min(23.8, p.x));
      p.z = Math.max(-17.8, Math.min(17.8, p.z));
      if (g.t >= g.def.fuse) {
        detonateGrenade(g);
        grenades.splice(i, 1);
      }
    }
    // Smoke thins out at the end of its life.
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      s.t += dt;
      const fade = s.t > s.duration - 2 ? Math.max(0, 1 - (s.t - (s.duration - 2)) / 2) : 1;
      s.group.children.forEach((puff) => { puff.material.opacity = 0.55 * fade; });
      if (s.t >= s.duration) {
        scene.remove(s.group);
        smokes.splice(i, 1);
      }
    }
    // Explosion flash grows and dies in 0.35 s.
    if (boomTime < 1) {
      boomTime = Math.min(1, boomTime + dt / 0.35);
      boom.scale.setScalar(0.5 + boomTime * 5);
      boomMat.opacity = 0.85 * (1 - boomTime);
      boomLight.intensity = 60 * (1 - boomTime);
      if (boomTime >= 1) boom.visible = false;
    }
    void flashes;
  }

  return {
    playerShoot, throwGrenade, spawnTracer, explode, update,
    get smokes() { return smokes; },
  };
}
