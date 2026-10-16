import * as THREE from 'three';
import { CollisionWorld, roundPolygon, type Vec2 } from './geometry';
import type { LevelData, LaserGateDef, SurfaceStyle } from './level-data';
import { getTextures, makeSignTexture } from '../render/textures';

export const TRACK_FRONT = 2.4;
export const TRACK_BACK = -3.6;

export interface LaserGate {
  def: LaserGateDef;
  lower: THREE.Mesh;
  upper: THREE.Mesh;
  lowerGlow: THREE.Mesh;
  upperGlow: THREE.Mesh;
  nodes: THREE.Mesh[];
  gapLow: number;
  gapHigh: number;
}

export interface Pickup {
  x: number;
  y: number;
  mesh: THREE.Object3D;
  taken: boolean;
  kind: 'cell' | 'fuel';
}

export interface Checkpoint {
  x: number;
  y: number;
  active: boolean;
  lamp: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
}

export interface BuiltLevel {
  world: CollisionWorld;
  lasers: LaserGate[];
  pickups: Pickup[];
  checkpoints: Checkpoint[];
  plasmaMaterials: THREE.ShaderMaterial[];
  finishLamp: THREE.MeshBasicMaterial;
  update: (t: number) => void;
}

const plasmaVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const plasmaFragment = /* glsl */ `
uniform float uTime;
uniform float uTop;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 p = vec2(vWorld.x * 0.35 + vWorld.z * 0.2, vWorld.y * 0.35 + vWorld.z * 0.35);
  float n = fbm(p + vec2(uTime * 0.25, -uTime * 0.6));
  float n2 = fbm(p * 2.0 - vec2(uTime * 0.4, uTime * 0.2));
  float depth = clamp((uTop - vWorld.y) / 14.0, 0.0, 1.0);
  float veins = smoothstep(0.55, 0.75, n * 0.7 + n2 * 0.5);
  vec3 hot = vec3(4.0, 1.2, 0.35);
  vec3 mag = vec3(2.2, 0.2, 1.2);
  vec3 c = mix(hot, mag, depth) * (0.25 + veins * 1.4) * (1.0 - depth * 0.75);
  c += vec3(4.0, 2.2, 0.8) * pow(max(0.0, 1.0 - (uTop - vWorld.y) * 1.5), 4.0) * (0.6 + 0.4 * n2);
  gl_FragColor = vec4(c, 1.0);
}`;

function styleTint(style: SurfaceStyle): string {
  switch (style) {
    case 'ceiling':
      return '#7d8aa6';
    case 'pillar':
      return '#a08c70';
    case 'tower':
      return '#8e96a8';
    case 'wall':
      return '#6c7280';
    default:
      return '#9098a8';
  }
}

export function buildLevel(scene: THREE.Scene, data: LevelData): BuiltLevel {
  const world = new CollisionWorld();
  const tex = getTextures();

  const makeMaps = (repeat: number, src: typeof tex.panels) => {
    const map = src.map.clone();
    const roughnessMap = src.roughnessMap.clone();
    const normalMap = src.normalMap.clone();
    for (const t of [map, roughnessMap, normalMap]) t.repeat.set(repeat, repeat);
    return { map, roughnessMap, normalMap };
  };
  const deckMaps = makeMaps(1 / 7, tex.asphalt);

  const deckMat = new THREE.MeshStandardMaterial({
    ...deckMaps,
    color: '#ffffff',
    metalness: 0.1,
    roughness: 1,
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 1.1,
  });

  const accentDefault = '#ffd2a6';
  const neonByColor = new Map<string, THREE.MeshBasicMaterial>();
  const neon = (hex: string) => {
    let m = neonByColor.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.6) });
      neonByColor.set(hex, m);
    }
    return m;
  };

  const bollardPositions: THREE.Vector3[] = [];

  data.solids.forEach((solid, id) => {
    const pts = roundPolygon(solid.verts, solid.radius ?? 0.25);
    world.addPolygon(pts, id);

    const capMaps = makeMaps(1 / 9, tex.panels);
    const capMat = new THREE.MeshStandardMaterial({
      ...capMaps,
      color: styleTint(solid.style),
      metalness: 0.55,
      roughness: 1,
      envMapIntensity: 0.8,
    });
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
    const bevel = 0.14;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: TRACK_FRONT - TRACK_BACK - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 3,
      steps: 1,
    });
    const mesh = new THREE.Mesh(geo, [capMat, deckMat]);
    mesh.position.z = TRACK_BACK + bevel;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    addNeonOutline(scene, pts, neon(solid.accent ?? accentDefault));

    // Collect places for small marker lights along upward-facing decks.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 4) continue;
      const ny = -(b.x - a.x) / len;
      if (ny < 0.95 || a.y < -10) continue;
      for (let s = 2; s < len - 1; s += 7) {
        const t = s / len;
        bollardPositions.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, TRACK_BACK + 0.35));
      }
    }
  });

  // Marker lights along the back edge of every deck.
  const bollards = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.18, 0.5, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.9) }),
    bollardPositions.length,
  );
  const m4 = new THREE.Matrix4();
  bollardPositions.forEach((p, i) => {
    m4.makeTranslation(p.x, p.y + 0.25, p.z);
    bollards.setMatrixAt(i, m4);
  });
  scene.add(bollards);

  // Plasma pits.
  const plasmaMaterials: THREE.ShaderMaterial[] = [];
  for (const h of data.hazards) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTop: { value: h.y1 } },
      vertexShader: plasmaVertex,
      fragmentShader: plasmaFragment,
    });
    plasmaMaterials.push(mat);
    const height = Math.min(30, h.y1 - h.y0);
    const box = new THREE.Mesh(new THREE.BoxGeometry(h.x1 - h.x0, height, TRACK_FRONT - TRACK_BACK + 8), mat);
    box.position.set((h.x0 + h.x1) / 2, h.y1 - height / 2, (TRACK_FRONT + TRACK_BACK) / 2 - 2);
    scene.add(box);
    const light = new THREE.PointLight('#ff6a2a', 900, 40, 1.8);
    light.position.set((h.x0 + h.x1) / 2, h.y1 + 3, 1);
    scene.add(light);
  }

  const lasers = data.lasers.map((def) => buildLaserGate(scene, def));
  const pickups = buildPickups(scene, data);
  const checkpoints = data.checkpoints.map((c) => buildCheckpoint(scene, c.x, c.y));

  for (const s of data.signs) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 3.2),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(s.lines, s.accent), transparent: true, toneMapped: false }),
    );
    sign.position.set(s.x, s.y + 4.6, TRACK_BACK - 0.4);
    scene.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3, 0.16), new THREE.MeshStandardMaterial({ color: '#30343c', metalness: 0.9, roughness: 0.4 }));
    post.position.set(s.x, s.y + 1.5, TRACK_BACK - 0.45);
    scene.add(post);
  }

  for (const l of data.lamps) buildLamp(scene, l.x, l.y, l.color);

  const finishLamp = buildFinishGate(scene, data.finishX, data.finishY);

  return {
    world,
    lasers,
    pickups,
    checkpoints,
    plasmaMaterials,
    finishLamp,
    update: (t: number) => {
      plasmaMaterials.forEach((m) => (m.uniforms.uTime.value = t));
      for (const gate of lasers) updateLaser(gate, t);
      for (const p of pickups) {
        if (p.taken) continue;
        p.mesh.rotation.y = t * 2 + p.x;
        p.mesh.position.y = p.y + Math.sin(t * 3 + p.x) * 0.15;
      }
      for (const c of checkpoints) c.ring.rotation.y = t * (c.active ? 3 : 0.8);
    },
  };
}

function addNeonOutline(scene: THREE.Scene, pts: Vec2[], mat: THREE.Material): void {
  const pos: number[] = [];
  const z = TRACK_FRONT + 0.012;
  const w = 0.045;
  const inset = 0.2;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a.y < -12 && b.y < -12) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    // Inward normal for a CCW outline.
    const nx = -dy / len;
    const ny = dx / len;
    const a1x = a.x + nx * inset;
    const a1y = a.y + ny * inset;
    const b1x = b.x + nx * inset;
    const b1y = b.y + ny * inset;
    const a2x = a1x + nx * w;
    const a2y = a1y + ny * w;
    const b2x = b1x + nx * w;
    const b2y = b1y + ny * w;
    pos.push(a1x, a1y, z, b1x, b1y, z, b2x, b2y, z, a1x, a1y, z, b2x, b2y, z, a2x, a2y, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, mat);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  scene.add(m);
}

function buildLaserGate(scene: THREE.Scene, def: LaserGateDef): LaserGate {
  const metal = new THREE.MeshStandardMaterial({ color: '#2c3038', metalness: 0.9, roughness: 0.35 });
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.25, 0.35) });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.05, 0.1), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 10);
  beamGeo.translate(0, 0.5, 0);
  const glowGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 12, 1, true);
  glowGeo.translate(0, 0.5, 0);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(def.x, 0, 0);
    scene.add(m);
    return m;
  };
  const lower = mk(beamGeo, beamMat);
  const upper = mk(beamGeo, beamMat);
  const lowerGlow = mk(glowGeo, glowMat);
  const upperGlow = mk(glowGeo, glowMat);
  // Emitter housings at both ends and two sliding nodes marking the gap.
  for (const y of [def.yMin, def.yMax]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), metal);
    housing.position.set(def.x, y + (y === def.yMin ? -0.6 : 0.6), 0);
    scene.add(housing);
  }
  const nodeMat = new THREE.MeshStandardMaterial({ color: '#202228', metalness: 1, roughness: 0.3, emissive: '#ff2030', emissiveIntensity: 1.5 });
  const nodes = [0, 1].map(() => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 16), nodeMat);
    n.position.x = def.x;
    scene.add(n);
    return n;
  });
  const light = new THREE.PointLight('#ff2a3a', 200, 18, 2);
  light.position.set(def.x, def.gapCenter, 2);
  scene.add(light);
  const gate: LaserGate = { def, lower, upper, lowerGlow, upperGlow, nodes, gapLow: 0, gapHigh: 0 };
  updateLaser(gate, 0);
  return gate;
}

function updateLaser(g: LaserGate, t: number): void {
  const d = g.def;
  const c = d.gapCenter + Math.sin(t * d.speed + d.phase) * d.amplitude;
  g.gapLow = c - d.gapSize / 2;
  g.gapHigh = c + d.gapSize / 2;
  const flick = 0.85 + 0.15 * Math.sin(t * 50 + d.x);
  for (const m of [g.lower, g.lowerGlow]) {
    m.position.y = d.yMin;
    m.scale.set(m === g.lowerGlow ? flick : 1, g.gapLow - d.yMin, m === g.lowerGlow ? flick : 1);
  }
  for (const m of [g.upper, g.upperGlow]) {
    m.position.y = g.gapHigh;
    m.scale.set(m === g.upperGlow ? flick : 1, d.yMax - g.gapHigh, m === g.upperGlow ? flick : 1);
  }
  g.nodes[0].position.y = g.gapLow - 0.25;
  g.nodes[1].position.y = g.gapHigh + 0.25;
}

function buildPickups(scene: THREE.Scene, data: LevelData): Pickup[] {
  const out: Pickup[] = [];
  const cellCore = new THREE.MeshStandardMaterial({ color: '#0b2a33', emissive: '#3ff0ff', emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.2 });
  const cellRing = new THREE.MeshStandardMaterial({ color: '#d8e2ee', metalness: 1, roughness: 0.2 });
  for (const c of data.cells) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), cellCore);
    core.scale.y = 1.4;
    g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 32), cellRing);
    g.add(ring);
    g.position.set(c.x, c.y, 0);
    scene.add(g);
    out.push({ x: c.x, y: c.y, mesh: g, taken: false, kind: 'cell' });
  }
  const fuelMat = new THREE.MeshStandardMaterial({ color: '#3a2008', emissive: '#ffa63a', emissiveIntensity: 3, roughness: 0.3 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#dfe4ea', metalness: 1, roughness: 0.25 });
  for (const f of data.fuelPods) {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 6, 16), fuelMat);
    g.add(tank);
    for (const y of [-0.42, 0.42]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 16), capMat);
      cap.position.y = y;
      g.add(cap);
    }
    g.position.set(f.x, f.y, 0);
    scene.add(g);
    out.push({ x: f.x, y: f.y, mesh: g, taken: false, kind: 'fuel' });
  }
  return out;
}

function buildCheckpoint(scene: THREE.Scene, x: number, y: number): Checkpoint {
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3e46', metalness: 0.9, roughness: 0.35 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.2, 12), metal);
  pole.position.set(x, y + 2.1, TRACK_BACK + 0.8);
  scene.add(pole);
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.6, 0.3) });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), lamp);
  head.position.set(x, y + 4.4, TRACK_BACK + 0.8);
  scene.add(head);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 40), lamp);
  ring.position.copy(head.position);
  scene.add(ring);
  return { x, y, active: false, lamp, ring };
}

function buildLamp(scene: THREE.Scene, x: number, y: number, color: string): void {
  const metal = new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.9, roughness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 9, 10), metal);
  pole.position.set(x, y + 4.5, TRACK_BACK + 0.3);
  pole.castShadow = true;
  scene.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.6), metal);
  arm.position.set(x, y + 8.9, TRACK_BACK + 1.5);
  scene.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4) }));
  head.position.set(x, y + 8.75, TRACK_BACK + 2.6);
  scene.add(head);
  const light = new THREE.SpotLight(color, 900, 30, 0.75, 0.7, 1.6);
  light.position.set(x, y + 8.6, TRACK_BACK + 2.6);
  light.target.position.set(x, y, 0);
  scene.add(light);
  scene.add(light.target);
}

function buildFinishGate(scene: THREE.Scene, x: number, y: number): THREE.MeshBasicMaterial {
  const metal = new THREE.MeshStandardMaterial({ color: '#d0d4da', metalness: 1, roughness: 0.25 });
  for (const z of [TRACK_BACK - 0.2, TRACK_FRONT + 0.4]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), metal);
    p.position.set(x, y + 3.5, z);
    p.castShadow = true;
    scene.add(p);
  }
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 1.2) });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, TRACK_FRONT - TRACK_BACK + 1.2), metal);
  beam.position.set(x, y + 7, (TRACK_FRONT + TRACK_BACK) / 2 + 0.1);
  scene.add(beam);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.15, TRACK_FRONT - TRACK_BACK + 1.0), lamp);
  strip.position.set(x, y + 6.65, (TRACK_FRONT + TRACK_BACK) / 2 + 0.1);
  scene.add(strip);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 1.6),
    new THREE.MeshBasicMaterial({ map: makeSignTexture(['FINISH  终点'], '#5dffa0', 1024, 256), transparent: true, toneMapped: false }),
  );
  banner.position.set(x, y + 8.4, TRACK_FRONT + 0.7);
  scene.add(banner);
  // Checkered pad on the deck.
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 224;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 14; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#f2f2f2' : '#111';
    ctx.fillRect(i * 16, j * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.6, TRACK_FRONT - TRACK_BACK - 0.4), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(x, y + 0.01, (TRACK_FRONT + TRACK_BACK) / 2);
  pad.receiveShadow = true;
  scene.add(pad);
  return lamp;
}
