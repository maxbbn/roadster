import * as THREE from 'three';

// Procedural model of the new Roadster: faceted wedge body, full-width light bars, glass canopy.
// Local frame: +x nose, +y up, +z the side facing the camera. Origin = midpoint between axles.

export const WHEEL_RADIUS = 0.36;
export const HALF_WHEELBASE = 1.35;

/**
 * Faceted body section at one station along the car, right half (z >= 0), listed bottom to top:
 * floor centre, floor edge, rocker top, waist crease (widest), shoulder crease, glass base, deck centre.
 */
interface Section {
  x: number;
  yb: number;
  zs: number;
  ys: number;
  zr: number;
  yc: number;
  w: number;
  ysh: number;
  zsh: number;
  yg: number;
  zg: number;
  yd: number;
}

// Keyframes read off the new Roadster's side and front views. Interpolated linearly so panels stay flat.
const SECTIONS: Section[] = [
  { x: -2.27, yb: -0.1, zs: 0.6, ys: 0.02, zr: 0.8, yc: 0.15, w: 0.86, ysh: 0.42, zsh: 0.8, yg: 0.45, zg: 0.58, yd: 0.47 },
  { x: -2.0, yb: -0.19, zs: 0.65, ys: -0.02, zr: 0.9, yc: 0.16, w: 0.97, ysh: 0.5, zsh: 0.9, yg: 0.52, zg: 0.62, yd: 0.54 },
  { x: -1.35, yb: -0.23, zs: 0.65, ys: -0.07, zr: 0.92, yc: 0.16, w: 1.02, ysh: 0.53, zsh: 0.94, yg: 0.55, zg: 0.65, yd: 0.56 },
  { x: -0.6, yb: -0.235, zs: 0.65, ys: -0.13, zr: 0.89, yc: 0.12, w: 0.98, ysh: 0.41, zsh: 0.9, yg: 0.43, zg: 0.7, yd: 0.45 },
  { x: 0.6, yb: -0.235, zs: 0.65, ys: -0.15, zr: 0.88, yc: 0.11, w: 0.96, ysh: 0.37, zsh: 0.9, yg: 0.38, zg: 0.71, yd: 0.4 },
  { x: 1.35, yb: -0.22, zs: 0.62, ys: -0.13, zr: 0.9, yc: 0.12, w: 0.99, ysh: 0.46, zsh: 0.92, yg: 0.42, zg: 0.64, yd: 0.37 },
  { x: 1.95, yb: -0.2, zs: 0.6, ys: -0.11, zr: 0.88, yc: 0.1, w: 0.95, ysh: 0.31, zsh: 0.86, yg: 0.24, zg: 0.55, yd: 0.21 },
  { x: 2.36, yb: -0.16, zs: 0.55, ys: -0.08, zr: 0.78, yc: 0.07, w: 0.86, ysh: 0.15, zsh: 0.8, yg: 0.13, zg: 0.5, yd: 0.12 },
];

/** Glass canopy keyframes: roof-edge y, roof-edge z, roof-centre y. Ends collapse onto the body. */
const CANOPY: [number, number, number, number][] = [
  [-1.92, 0, 0, 0],
  [-1.4, 0.65, 0.57, 0.68],
  [-0.8, 0.77, 0.53, 0.82],
  [-0.3, 0.81, 0.52, 0.865],
  [0.2, 0.78, 0.54, 0.84],
  [0.8, 0.6, 0.6, 0.64],
  [1.25, 0, 0, 0],
];

function sectionAt(x: number): Section {
  const k = SECTIONS;
  if (x <= k[0].x) return { ...k[0], x };
  if (x >= k[k.length - 1].x) return { ...k[k.length - 1], x };
  let i = 0;
  while (x > k[i + 1].x) i++;
  const a = k[i];
  const b = k[i + 1];
  const t = (x - a.x) / (b.x - a.x);
  const out = { x } as Section;
  for (const key of Object.keys(a) as (keyof Section)[]) if (key !== 'x') out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

function canopyAt(x: number): [number, number, number] {
  const s = sectionAt(x);
  const k = CANOPY;
  let i = 0;
  while (i < k.length - 2 && x > k[i + 1][0]) i++;
  const a = k[i];
  const b = k[i + 1];
  const t = Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0])));
  const end = (e: [number, number, number, number]): [number, number, number] =>
    e[1] === 0 ? [s.yg + 0.004, s.zg, s.yd + 0.006] : [e[1], e[2], e[3]];
  const ea = end(a);
  const eb = end(b);
  return [ea[0] + (eb[0] - ea[0]) * t, ea[1] + (eb[1] - ea[1]) * t, ea[2] + (eb[2] - ea[2]) * t];
}

const ARCH_R = 0.44;

function archHeight(x: number): number {
  let h = -Infinity;
  for (const ax of [-HALF_WHEELBASE, HALF_WHEELBASE]) {
    const dx = x - ax;
    if (Math.abs(dx) < ARCH_R) h = Math.max(h, Math.sqrt(ARCH_R * ARCH_R - dx * dx));
  }
  return h;
}

/** Station positions: dense uniform sampling plus every keyframe so creases land exactly. */
function stations(x0: number, x1: number, step: number, keys: number[]): number[] {
  const xs = new Set<number>();
  for (let x = x0; x < x1; x += step) xs.add(+x.toFixed(4));
  xs.add(x1);
  for (const k of keys) if (k > x0 && k < x1) xs.add(k);
  return [...xs].sort((a, b) => a - b);
}

/**
 * Faceted body shell with wheel arches carved out of the sides.
 * Material group 0 = paint, group 1 = dark trim (floor, rockers, front fascia).
 */
function buildShell(): THREE.BufferGeometry {
  const xs = stations(-2.27, 2.36, 0.025, SECTIONS.map((s) => s.x));
  const ring = 12;
  const pos: number[] = [];
  const paint: number[] = [];
  const trim: number[] = [];
  for (const x of xs) {
    const s = sectionAt(x);
    const arch = archHeight(x);
    const lift = (y: number) => Math.max(y, Math.min(arch, s.ysh - 0.03));
    const half: [number, number][] = [
      [s.zs, lift(s.yb)],
      [s.zr, lift(s.ys)],
      [s.w, lift(s.yc)],
      [s.zsh, s.ysh],
      [s.zg, s.yg],
    ];
    pos.push(x, s.yb, 0);
    for (const [z, y] of half) pos.push(x, y, z);
    pos.push(x, s.yd, 0);
    for (let j = half.length - 1; j >= 0; j--) pos.push(x, half[j][1], -half[j][0]);
  }
  // Strips 0,1 and 10,11 are floor/rocker trim.
  const isTrim = (j: number) => j <= 1 || j >= 10;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + ((j + 1) % ring);
      const d = i * ring + ((j + 1) % ring);
      (isTrim(j) ? trim : paint).push(a, b, c, a, c, d);
    }
  }
  for (const [station, front] of [[0, false], [xs.length - 1, true]] as const) {
    let cy = 0;
    for (let j = 0; j < ring; j++) cy += pos[(station * ring + j) * 3 + 1];
    const center = pos.length / 3;
    pos.push(xs[station], cy / ring, 0);
    for (let j = 0; j < ring; j++) {
      const a = station * ring + j;
      const b = station * ring + ((j + 1) % ring);
      if (front) trim.push(center, b, a);
      else paint.push(center, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...paint, ...trim]);
  g.addGroup(0, paint.length, 0);
  g.addGroup(paint.length, trim.length, 1);
  g.computeVertexNormals();
  return g;
}

/** Tinted glass canopy running from the short hood over the roof into the fastback. */
function buildCanopy(): THREE.BufferGeometry {
  const xs = stations(CANOPY[0][0], CANOPY[CANOPY.length - 1][0], 0.025, CANOPY.map((c) => c[0]));
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = 5;
  for (const x of xs) {
    const s = sectionAt(x);
    const [ye, ze, yt] = canopyAt(x);
    pos.push(x, s.yg + 0.002, s.zg, x, ye, ze, x, yt, 0, x, ye, -ze, x, s.yg + 0.002, -s.zg);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + j + 1;
      const d = i * ring + j + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Six-point star spoke, pointed at both ends. */
function buildSpokeGeometry(width: number, inner: number, outer: number): THREE.BufferGeometry {
  const mid = inner + (outer - inner) * 0.45;
  const shape = new THREE.Shape();
  shape.moveTo(inner, 0);
  shape.lineTo(mid, width);
  shape.lineTo(outer, 0.004);
  shape.lineTo(outer, -0.004);
  shape.lineTo(mid, -width);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1 });
}

const RIM_R = 0.29;

function buildTireGeometry(width: number): THREE.BufferGeometry {
  const r = WHEEL_RADIUS;
  const h = width / 2;
  const pts = [
    new THREE.Vector2(RIM_R - 0.01, -h),
    new THREE.Vector2(r - 0.03, -h),
    new THREE.Vector2(r - 0.01, -h + 0.016),
    new THREE.Vector2(r, -h + 0.045),
    new THREE.Vector2(r + 0.002, 0),
    new THREE.Vector2(r, h - 0.045),
    new THREE.Vector2(r - 0.01, h - 0.016),
    new THREE.Vector2(r - 0.03, h),
    new THREE.Vector2(RIM_R - 0.01, h),
  ];
  const g = new THREE.LatheGeometry(pts, 72);
  g.rotateX(Math.PI / 2);
  return g;
}

export interface CarVisualState {
  wheelSpin: number;
  vacuum: number; // 0..1 fan intensity
  jetDeploy: number; // 0..1 nozzle deployment
  thrustUp: number; // 0..1
  thrustFwd: number; // 0..1 rear nozzles
  thrustBack: number; // 0..1 front nozzles
  brake: number;
  bodyPitch: number;
  bodyLift: number;
  time: number;
}

const plumeVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const plumeFragment = /* glsl */ `
uniform float uTime;
uniform float uPower;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float along = clamp(vUv.y, 0.0, 1.0);
  vec3 n = vN / max(length(vN), 1e-4);
  vec3 v = vView / max(length(vView), 1e-4);
  float edge = pow(clamp(abs(dot(n, v)), 0.0, 1.0), 1.5);
  float shock = 0.75 + 0.25 * sin(along * 38.0 - uTime * 60.0);
  float flicker = 0.85 + 0.15 * h(floor(uTime * 40.0) + vUv.x * 7.0);
  float a = pow(1.0 - along, 1.6) * edge * shock * flicker * uPower;
  vec3 core = mix(uColor, vec3(1.0), pow(1.0 - along, 4.0));
  gl_FragColor = vec4(core * a * 4.0, a);
}`;

export class RoadsterModel {
  readonly root = new THREE.Group();
  readonly yaw = new THREE.Group();
  private body = new THREE.Group();
  private wheelSpinners: THREE.Object3D[] = [];
  readonly paint: THREE.MeshPhysicalMaterial;
  private underglow: THREE.MeshBasicMaterial;
  private underLight: THREE.PointLight;
  private groundGlow: THREE.Mesh;
  private rearNozzles: THREE.Object3D[] = [];
  private downNozzles: THREE.Object3D[] = [];
  private plumes: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; kind: 'up' | 'fwd' | 'back'; scale: number }[] = [];
  private thrustLight: THREE.PointLight;
  private tailMat: THREE.MeshStandardMaterial;
  private fanRotor: THREE.Object3D;
  readonly headlight: THREE.SpotLight;

  constructor(paintColor = '#dfe1e4') {
    this.root.add(this.yaw);
    this.yaw.add(this.body);

    // Satin paint with flat shading so every facet catches light on its own.
    this.paint = new THREE.MeshPhysicalMaterial({
      color: paintColor,
      metalness: 0.25,
      roughness: 0.34,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.4,
      flatShading: true,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#1e140d',
      metalness: 0.35,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.0,
      envMapIntensity: 1.6,
    });
    const trimMat = new THREE.MeshPhysicalMaterial({ color: '#16181c', metalness: 0.4, roughness: 0.32, clearcoat: 0.5, flatShading: true });
    const black = new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.55, metalness: 0.3 });
    const gloss = new THREE.MeshPhysicalMaterial({ color: '#08090b', roughness: 0.12, metalness: 0.4, clearcoat: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: '#9aa1aa', roughness: 0.25, metalness: 1 });

    const shell = new THREE.Mesh(buildShell(), [this.paint, trimMat]);
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.body.add(shell);

    const cabin = new THREE.Mesh(buildCanopy(), glass);
    cabin.castShadow = true;
    this.body.add(cabin);

    // Seats and headrests visible through the glass.
    for (const z of [-0.38, 0.38]) {
      const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 6, 12), new THREE.MeshStandardMaterial({ color: '#d8d2c8', roughness: 0.7 }));
      seat.position.set(-0.35, 0.42, z);
      seat.rotation.z = 0.35;
      this.body.add(seat);
    }

    const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      this.body.add(m);
      return m;
    };

    // Full-width front light bar along the top edge of the dark fascia, plus the lower splitter.
    const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e6f2ff', emissiveIntensity: 9 });
    box(0.014, 0.016, 1.5, headMat, 2.366, 0.1, 0);
    for (const z of [-1, 1]) {
      // Short returns wrapping around the chamfered corners.
      const ret = box(0.2, 0.016, 0.014, headMat, 2.3, 0.095, z * 0.81);
      ret.rotation.y = z * 0.55;
    }
    box(0.34, 0.025, 1.72, trimMat, 2.3, -0.205, 0);

    // Amber side markers on the front fenders behind the wheel arches.
    const amber = new THREE.MeshStandardMaterial({ color: '#ff9a2a', emissive: '#ff8a1a', emissiveIntensity: 4 });
    for (const z of [-1, 1]) {
      const m = box(0.13, 0.022, 0.01, amber, 0.86, 0.29, z * 0.928);
      m.rotation.x = z * -0.25;
    }

    // Full-width taillight bar across the Kamm tail.
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#ff0a12', emissive: '#ff0612', emissiveIntensity: 2.5 });
    box(0.014, 0.02, 1.5, this.tailMat, -2.276, 0.395, 0);
    // Rear diffuser with fins.
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.5), trimMat);
    diffuser.position.set(-2.0, -0.15, 0);
    diffuser.rotation.z = -0.25;
    this.body.add(diffuser);
    for (let i = -3; i <= 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.015), trimMat);
      fin.position.set(-2.0, -0.13, i * 0.2);
      fin.rotation.z = -0.25;
      this.body.add(fin);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.03, 1.6), black);
    floor.position.set(0.05, -0.215, 0);
    this.body.add(floor);

    // Vacuum fan: rotor visible under the tail plus glowing side skirts.
    this.fanRotor = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.16), metal);
      blade.position.z = 0.08;
      const holder = new THREE.Group();
      holder.rotation.x = (i / 7) * Math.PI * 2;
      holder.add(blade);
      this.fanRotor.add(holder);
    }
    this.fanRotor.position.set(-2.12, 0.0, 0);
    this.fanRotor.rotation.y = 0;
    this.body.add(this.fanRotor);
    const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 10, 32), gloss);
    fanRing.rotation.y = Math.PI / 2;
    fanRing.position.set(-2.13, 0.0, 0);
    this.body.add(fanRing);

    this.underglow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
    for (const z of [-0.93, 0.93]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.025, 0.03), this.underglow);
      strip.position.set(0, -0.2, z);
      this.body.add(strip);
    }
    this.underLight = new THREE.PointLight('#38e8ff', 0, 6, 2);
    this.underLight.position.set(0, -0.3, 0.6);
    this.body.add(this.underLight);
    const glowTex = makeRadial();
    this.groundGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 2.6),
      new THREE.MeshBasicMaterial({ map: glowTex, color: '#38e8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.position.set(0, -0.355, 0);
    this.body.add(this.groundGlow);

    // Cold-gas thrusters hidden behind the rear fascia and under the corners.
    for (const z of [-0.32, 0.32]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.22, 20, 1, true), metal);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.set(-2.05, 0.06, z);
      (nozzle.material as THREE.Material).side = THREE.DoubleSide;
      this.body.add(nozzle);
      this.rearNozzles.push(nozzle);
      this.addPlume(nozzle, 'fwd', 2.2);
    }
    for (const [x, z] of [[1.75, -0.55], [1.75, 0.55], [-1.75, -0.55], [-1.75, 0.55]]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.14, 16, 1, true), metal);
      nozzle.position.set(x, -0.14, z);
      this.body.add(nozzle);
      this.downNozzles.push(nozzle);
      this.addPlume(nozzle, 'up', 1.6);
      if (x > 0) this.addPlume(nozzle, 'back', 0.9);
    }
    this.thrustLight = new THREE.PointLight('#9fd8ff', 0, 10, 2);
    this.thrustLight.position.set(-1.5, -0.6, 0.5);
    this.body.add(this.thrustLight);

    // Headlight beam.
    this.headlight = new THREE.SpotLight('#e8f2ff', 0, 40, 0.42, 0.6, 1.6);
    this.headlight.position.set(2.3, 0.1, 0);
    this.headlight.target.position.set(14, -1.4, 0);
    this.body.add(this.headlight);
    this.body.add(this.headlight.target);

    this.buildWheels(metal);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material !== this.underglow && o !== this.groundGlow) o.castShadow = true;
    });
  }

  private addPlume(nozzle: THREE.Object3D, kind: 'up' | 'fwd' | 'back', scale: number): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPower: { value: 0 },
        uColor: { value: new THREE.Color(kind === 'fwd' ? '#6fb8ff' : '#7cc4ff') },
      },
      vertexShader: plumeVertex,
      fragmentShader: plumeFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.CylinderGeometry(0.07, 0.24, 1, 20, 8, true);
    // Flip so the narrow end sits at the nozzle (local y = 0) and the plume extends to +y.
    geo.rotateX(Math.PI);
    geo.translate(0, 0.5, 0);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.copy(nozzle.position);
    if (kind === 'fwd') holder.rotation.z = Math.PI / 2; // +y -> -x (behind the car)
    if (kind === 'up') holder.rotation.z = Math.PI; // +y -> -y (downwards)
    if (kind === 'back') holder.rotation.z = -Math.PI / 2; // +y -> +x (ahead)
    this.body.add(holder);
    mesh.scale.set(1, 0.001, 1);
    this.plumes.push({ mesh, mat, kind, scale });
  }

  /** Aero wheels: gloss-black face with a raised six-point star in graphite. */
  private buildWheels(metal: THREE.Material): void {
    const rubber = new THREE.MeshStandardMaterial({ color: '#101113', roughness: 0.88, metalness: 0 });
    const faceMat = new THREE.MeshPhysicalMaterial({ color: '#0b0c0f', roughness: 0.2, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.05 });
    const starMat = new THREE.MeshStandardMaterial({ color: '#5a5f68', roughness: 0.26, metalness: 1, envMapIntensity: 1.5 });
    const starDark = new THREE.MeshStandardMaterial({ color: '#25282e', roughness: 0.3, metalness: 1 });
    const lipMat = new THREE.MeshStandardMaterial({ color: '#8a9099', roughness: 0.22, metalness: 1 });
    const face = new THREE.CircleGeometry(RIM_R, 64);
    const spoke = buildSpokeGeometry(0.03, 0.05, RIM_R - 0.01);
    const spokeThin = buildSpokeGeometry(0.012, 0.09, RIM_R - 0.02);
    const liner = new THREE.CylinderGeometry(0.395, 0.395, 0.34, 28, 1, true, Math.PI / 2, Math.PI);
    liner.rotateX(Math.PI / 2);
    const linerMat = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.95, side: THREE.DoubleSide });
    for (const x of [-HALF_WHEELBASE, HALF_WHEELBASE]) {
      const width = x > 0 ? 0.27 : 0.31;
      for (const z of [-0.8, 0.8]) {
        const archLiner = new THREE.Mesh(liner, linerMat);
        archLiner.position.set(x, 0, z);
        this.body.add(archLiner);
      }
      for (const side of [-1, 1]) {
        const wheel = new THREE.Group();
        wheel.position.set(x, 0, side * 0.8);
        if (side < 0) wheel.rotation.y = Math.PI;
        const spinner = new THREE.Group();
        wheel.add(spinner);
        spinner.add(new THREE.Mesh(buildTireGeometry(width), rubber));
        const fz = width / 2 - 0.02;
        const disc = new THREE.Mesh(face, faceMat);
        disc.position.z = fz;
        spinner.add(disc);
        const back = new THREE.Mesh(face, faceMat);
        back.position.z = -width / 2 + 0.02;
        back.rotation.y = Math.PI;
        spinner.add(back);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const main = new THREE.Mesh(spoke, starMat);
          main.rotation.z = a;
          main.position.z = fz;
          spinner.add(main);
          const thin = new THREE.Mesh(spokeThin, starDark);
          thin.rotation.z = a + Math.PI / 6;
          thin.position.z = fz;
          spinner.add(thin);
        }
        const lip = new THREE.Mesh(new THREE.TorusGeometry(RIM_R - 0.004, 0.006, 6, 64), lipMat);
        lip.position.z = fz + 0.002;
        spinner.add(lip);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 24), metal);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = fz + 0.012;
        spinner.add(hub);
        this.yaw.add(wheel);
        this.wheelSpinners.push(spinner);
      }
    }
  }

  setPaint(color: string): void {
    this.paint.color.set(color);
  }

  update(s: CarVisualState): void {
    for (const w of this.wheelSpinners) w.rotation.z = -s.wheelSpin;
    this.body.rotation.z = s.bodyPitch;
    this.body.position.y = s.bodyLift;

    const v = s.vacuum;
    const pulse = 0.8 + 0.2 * Math.sin(s.time * 18);
    this.underglow.color.setRGB(0.25 * v * 6 * pulse, 1.6 * v * 6 * pulse, 2.2 * v * 6 * pulse);
    this.underLight.intensity = v * 18 * pulse;
    (this.groundGlow.material as THREE.MeshBasicMaterial).opacity = v * 0.55 * pulse;
    this.fanRotor.rotation.x += v * 1.2 + 0.02;

    const d = s.jetDeploy;
    this.rearNozzles.forEach((n) => (n.position.x = -2.05 - d * 0.3));
    this.downNozzles.forEach((n) => (n.position.y = -0.14 - d * 0.14));
    for (const p of this.plumes) {
      const power = p.kind === 'up' ? s.thrustUp : p.kind === 'fwd' ? s.thrustFwd : s.thrustBack;
      const flick = 0.9 + 0.1 * Math.sin(s.time * 70 + p.scale * 10);
      const len = Math.max(0.001, power * p.scale * flick * d);
      p.mesh.visible = power * d > 0.01;
      p.mesh.scale.set(0.6 + power * 0.5, len, 0.6 + power * 0.5);
      p.mat.uniforms.uTime.value = s.time;
      p.mat.uniforms.uPower.value = power * d;
      const holder = p.mesh.parent!;
      if (p.kind === 'fwd') holder.position.x = -2.16 - d * 0.3;
      if (p.kind === 'up' || p.kind === 'back') holder.position.y = -0.21 - d * 0.14;
    }
    this.thrustLight.intensity = (s.thrustUp * 30 + s.thrustFwd * 20) * d;
    this.tailMat.emissiveIntensity = 2.5 + s.brake * 5;
  }
}

function makeRadial(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 32, 0, 64, 32, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.setTransform(1, 0, 0, 0.5, 0, 16);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
