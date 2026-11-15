// The map: "Yard 9", a 48 x 36 m container terminal at dusk. Two bomb sites, three
// lanes, and cover everywhere. Every box is a collider for movement and a surface a
// bullet stops on. Plain geometry only, no models and no textures loaded from the net;
// the site letters are drawn on a canvas at runtime.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints for the bots. Each node is [x, z]; edges are listed as index pairs.
// The graph links attacker spawn (south) to both sites and to defender spawn (north)
// through west, mid and east lanes, so a bot always has a route.
const WAYPOINTS = [
  [0, 15], [-5, 14], [5, 14], // 0-2 attacker spawn
  [0, 8], [0, 3], [2, -8], // 3-5 mid (4 and 5 skirt the central pillar)
  [-8, 0], [8, 0], // 6-7 cross connectors
  [-14, 8], [-19, -1], [-20, -8], [-14, -6], // 8-11 west lane
  [14, 8], [19, 1], [20, -8], [14, -6], // 12-15 east lane
  [-15, -12], [-12, -15], [-21, -8], [-10, -12], // 16-19 site A
  [15, 12], [12, 15], [21, 8], [10, 12], // 20-23 site B
  [-8, 8], [8, 8], [-8, -8], [8, -8], // 24-27 connectors
  [0, -15], [-6, -14], [6, -14], // 28-30 defender spawn
];

const EDGES = [
  [0, 3], [1, 8], [2, 12], [3, 24], [3, 25], [3, 4],
  [24, 8], [25, 12], [24, 6], [25, 7], [4, 6], [4, 7],
  [6, 9], [7, 13], [8, 9], [9, 10], [12, 13], [13, 14],
  [10, 11], [14, 15], [11, 16], [15, 20], [11, 19], [15, 23],
  [16, 17], [16, 18], [17, 18], [20, 21], [20, 22], [21, 22],
  [19, 26], [23, 27], [26, 5], [27, 5], [5, 28], [26, 29],
  [27, 30], [6, 24], [7, 25], [9, 6], [13, 7], [10, 26],
  [14, 27], [19, 16], [23, 20], [28, 29], [28, 30], [4, 5],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' || name === 'ink' ? 0.5 : 0.92,
      metalness: 0.06,
      emissive: new THREE.Color(PALETTE[name]),
      emissiveIntensity: name === 'accent' || name === 'teal' ? 0.35 : 0,
    });
  }
  // Emissive lamp glass glows; everything else is lit, not glowing.
  const lampMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 2.2, roughness: 0.4, metalness: 0,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function deco(width, height, depth, x, y, z, material) {
    // Visible but not a collider: thin markings, lamp heads, the gantry beam.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Barrels and poles collide as their bounding box.
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function letterPlane(letter, x, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 190px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(letter, 128, 138);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.03, z);
    group.add(mesh);
  }

  // Floor and perimeter walls, open to the dusk sky.
  box(48.4, 0.4, 36.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.6, 36.4, -24.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 36.4, 24.2, 2.3, 0, 'surface');
  box(48.4, 4.6, 0.4, 0, 2.3, -18.2, 'surface');
  box(48.4, 4.6, 0.4, 0, 2.3, 18.2, 'surface');

  // Site A (north-west warehouse corner): stacked containers and crates.
  box(6.0, 2.6, 2.4, -19, 1.3, -13, 'hairline');
  box(6.0, 2.6, 2.4, -19, 3.9, -13, 'accent');
  box(1.2, 1.1, 1.2, -13, 0.55, -16, 'hairline');
  box(1.2, 1.1, 1.2, -21, 0.55, -16, 'hairline');
  box(1.2, 1.1, 1.2, -15.5, 0.55, -10.5, 'hairline');
  box(1.2, 1.1, 1.2, -21, 0.55, -6.5, 'hairline');
  // Site B (south-east dock corner): mirrored, in teal.
  box(6.0, 2.6, 2.4, 19, 1.3, 13, 'hairline');
  box(6.0, 2.6, 2.4, 19, 3.9, 13, 'teal');
  box(1.2, 1.1, 1.2, 13, 0.55, 16, 'hairline');
  box(1.2, 1.1, 1.2, 21, 0.55, 16, 'hairline');
  box(1.2, 1.1, 1.2, 15.5, 0.55, 10.5, 'hairline');
  box(1.2, 1.1, 1.2, 21, 0.55, 6.5, 'hairline');

  // Mid: a central pillar blocks the long sightline, crates break the rest.
  box(1.6, 3.4, 1.6, 0, 1.7, 0, 'hairline');
  box(1.2, 1.1, 1.2, -3.2, 0.55, 3.6, 'hairline');
  box(1.2, 1.1, 1.2, 3.2, 0.55, -3.6, 'hairline');
  box(2.4, 0.9, 1.2, -4.5, 0.45, -6.5, 'hairline');
  box(2.4, 0.9, 1.2, 4.5, 0.45, 6.5, 'hairline');

  // Lane containers: long boxes that make corners and sightlines. They sit against the
  // walls so the waypoint lanes stay walkable.
  box(2.4, 2.6, 6.0, -21.5, 1.3, 4, 'hairline');
  box(2.4, 2.6, 6.0, 21.5, 1.3, -4, 'hairline');
  box(6.0, 2.6, 2.4, -10, 1.3, 16.5, 'hairline');
  box(6.0, 2.6, 2.4, 10, 1.3, -11, 'hairline');
  box(1.2, 1.1, 1.2, -22, 0.55, 4, 'hairline');
  box(1.2, 1.1, 1.2, 22, 0.55, -4, 'hairline');
  box(1.2, 1.1, 1.2, -12, 0.55, -14, 'hairline');
  box(1.2, 1.1, 1.2, 12, 0.55, 14, 'hairline');

  // Barrels near the connectors.
  cylinder(0.45, 1.1, -6.5, 0.55, 5.5, 'accent');
  cylinder(0.45, 1.1, 6.5, 0.55, -5.5, 'teal');
  cylinder(0.45, 1.1, -8.5, 0.55, -5.5, 'hairline');
  cylinder(0.45, 1.1, 8.5, 0.55, 5.5, 'hairline');

  // Crane gantry over the north end: two legs, one beam, purely for the skyline.
  box(0.8, 9, 0.8, -16, 4.5, -16.5, 'hairline');
  box(0.8, 9, 0.8, 16, 4.5, -16.5, 'hairline');
  deco(33.6, 0.9, 0.9, 0, 8.6, -16.5, 'surface');

  // Sodium lamp poles: pole + glowing head. Four point lights, no shadows, cheap.
  const lampPositions = [[-12, 6, 'accent'], [12, -6, 'teal'], [-18, -12, 'accent'], [18, 12, 'teal']];
  for (const [lx, lz, kind] of lampPositions) {
    cylinder(0.09, 5.2, lx, 2.6, lz, 'hairline', 8);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), lampMat);
    head.position.set(lx, 5.3, lz);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE[kind]), 30, 22, 1.8);
    light.position.set(lx, 5.0, lz);
    scene.add(light);
  }

  // Site floor markings and letters.
  deco(9, 0.05, 9, -18, 0.02, -12, 'accent');
  deco(9, 0.05, 9, 18, 0.02, 12, 'teal');
  letterPlane('A', -18, -12, PALETTE.accent);
  letterPlane('B', 18, 12, PALETTE.teal);

  // Light: cold moonlight as the key, warm dusk fill, dark sky and fog.
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 95);
  const sky = new THREE.HemisphereLight(new THREE.Color('#33415e'), new THREE.Color('#0e1420'), 1.15);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color('#cfe0ff'), 1.9);
  key.position.set(12, 18, -10);
  key.target.position.set(0, 0, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 0.5);
  fill.position.set(-10, 8, 14);
  scene.add(fill);

  const sites = {
    A: { name: 'A', center: new THREE.Vector3(-18, 0, -12), radius: 4.5 },
    B: { name: 'B', center: new THREE.Vector3(18, 0, 12), radius: 4.5 },
  };

  return {
    colliders,
    shootables,
    group,
    sites,
    waypoints: WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    edges: EDGES,
    spawnEmber: [new THREE.Vector3(0, 0, 15), new THREE.Vector3(-5, 0, 14), new THREE.Vector3(5, 0, 14), new THREE.Vector3(-2.5, 0, 16), new THREE.Vector3(2.5, 0, 16)],
    spawnWarden: [new THREE.Vector3(0, 0, -15), new THREE.Vector3(-6, 0, -14), new THREE.Vector3(6, 0, -14), new THREE.Vector3(-3, 0, -16), new THREE.Vector3(3, 0, -16)],
  };
}
