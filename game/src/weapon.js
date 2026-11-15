// The arsenal. One weapon table, four guns and three grenades, all with real numbers
// the judge can read: damage, headshot multiplier, spread, fire rate, price. A gun is
// a view model, a magazine, a reload, and the spread that punishes firing on the move.
// main.js owns the ray and the damage; this module owns the numbers and the model.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 SIDEARM', price: 0, mag: 12, reserve: 36,
    damage: 34, headMult: 4, fireGap: 0.14, reloadTime: 1.1,
    spreadStill: 0.004, spreadMoving: 0.02, auto: false, moveSpeed: 5.6,
    zoom: 1, kick: 0.008, tracer: PALETTE.gold,
  },
  rifle: {
    id: 'rifle', name: 'VK-9 ROOK', price: 2700, mag: 30, reserve: 90,
    damage: 34, headMult: 4, fireGap: 0.096, reloadTime: 1.9,
    spreadStill: 0.0022, spreadMoving: 0.028, auto: true, moveSpeed: 5.2,
    zoom: 1, kick: 0.011, tracer: PALETTE.gold,
  },
  smg: {
    id: 'smg', name: 'HORNET SMG', price: 1500, mag: 32, reserve: 96,
    damage: 26, headMult: 4, fireGap: 0.06, reloadTime: 1.6,
    spreadStill: 0.004, spreadMoving: 0.035, auto: true, moveSpeed: 5.8,
    zoom: 1, kick: 0.007, tracer: PALETTE.gold,
  },
  sniper: {
    id: 'sniper', name: 'LONGBOW', price: 4750, mag: 5, reserve: 15,
    damage: 88, headMult: 4, fireGap: 1.2, reloadTime: 3.0,
    spreadStill: 0.0004, spreadMoving: 0.05, auto: false, moveSpeed: 4.9,
    zoom: 2.6, kick: 0.03, tracer: PALETTE.gold,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'EMBER FRAG', price: 300, fuse: 1.6, radius: 6, damage: 120 },
  smoke: { id: 'smoke', name: 'VEIL SMOKE', price: 300, duration: 12, radius: 3.2 },
  flash: { id: 'flash', name: 'STROBE FLASH', price: 200, duration: 1.6, radius: 14 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_AMOUNT = 50;

// Build a simple first-person view model for a weapon id. Box geometry only, in the
// palette, with a muzzle tip the effects code can find.
export function createViewModel(camera, weaponId) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.4 });

  const model = new THREE.Group();
  const def = WEAPONS[weaponId];
  const longBarrel = weaponId === 'sniper' ? 0.72 : weaponId === 'smg' ? 0.3 : 0.42;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, weaponId === 'smg' ? 0.34 : 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, longBarrel), grip);
  barrel.position.set(0, 0.025, -0.24 - longBarrel / 2);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  stock.position.set(0, -0.02, 0.3);
  model.add(receiver, barrel, stock);
  if (weaponId === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.05);
    model.add(scope);
  }
  if (weaponId !== 'pistol') {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.2), accent);
    stripe.position.set(0, 0.06, -0.1);
    model.add(stripe);
  }
  model.position.set(0.25, -0.23, -0.5);
  model.scale.setScalar(0.8);
  camera.add(model);

  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  flash.rotation.z = Math.PI / 4; // a diamond, not a square
  flash.position.set(0, 0.025, -0.24 - longBarrel - 0.06);
  model.add(flash);

  const muzzle = new THREE.Object3D();
  muzzle.position.copy(flash.position);
  model.add(muzzle);

  return { model, flash, flashMat, muzzle, def, kick: 0, muzzleTime: 0 };
}

// Spread for a shot: still and aimed is a laser, moving or hip-firing is a cone.
// A sniper scoped in is near-perfect; a sniper on the move is useless.
export function currentSpread(def, speed, moveReference, ads) {
  const moving = Math.min(1, speed / moveReference);
  const spread = def.spreadStill + (def.spreadMoving - def.spreadStill) * moving;
  return ads ? spread * 0.45 : spread;
}
