import * as THREE from 'three';

// Procedural hypercar model inspired by the 2nd-gen Roadster silhouette.
// Local frame: +x nose, +y up, +z the side facing the camera. Origin = midpoint between axles.

export const WHEEL_RADIUS = 0.36;
export const HALF_WHEELBASE = 1.35;

type Key = [number, number];

/** Catmull-Rom interpolation over keyframes sorted by x. */
function curve(keys: Key[]): (x: number) => number {
  return (x: number) => {
    if (x <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (x >= last[0]) return last[1];
    let i = 0;
    while (i < keys.length - 2 && x > keys[i + 1][0]) i++;
    const p0 = keys[Math.max(0, i - 1)];
    const p1 = keys[i];
    const p2 = keys[i + 1];
    const p3 = keys[Math.min(keys.length - 1, i + 2)];
    const t = (x - p1[0]) / (p2[0] - p1[0]);
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

const topY = curve([
  [-2.27, 0.34], [-2.2, 0.41], [-2.0, 0.47], [-1.6, 0.52], [-1.35, 0.535], [-1.0, 0.53], [-0.5, 0.51],
  [0.0, 0.49], [0.6, 0.465], [1.0, 0.475], [1.35, 0.49], [1.7, 0.41], [2.0, 0.28], [2.2, 0.15], [2.32, 0.04], [2.38, -0.04],
]);
const bottomY = curve([
  [-2.27, -0.09], [-2.0, -0.16], [-1.6, -0.225], [-1.0, -0.235], [1.6, -0.235], [2.1, -0.2], [2.38, -0.13],
]);
const halfWidth = curve([
  [-2.27, 0.84], [-2.1, 0.95], [-1.7, 1.0], [-1.35, 1.02], [-0.9, 1.0], [-0.3, 0.95], [0.3, 0.95], [0.9, 0.97],
  [1.35, 0.99], [1.8, 0.95], [2.1, 0.84], [2.3, 0.64], [2.38, 0.46],
]);
const crown = curve([
  [-2.27, 0.0], [-1.5, 0.03], [-0.5, 0.0], [0.6, -0.02], [1.3, -0.07], [2.0, -0.04], [2.38, 0.0],
]);
const topExp = curve([[-2.27, 3.4], [-1.35, 3.8], [-0.4, 2.9], [0.6, 2.9], [1.35, 3.6], [2.0, 3.0], [2.38, 2.2]]);
const roofY = curve([
  [-1.02, 0.5], [-0.92, 0.6], [-0.75, 0.7], [-0.5, 0.79], [-0.25, 0.815], [0.0, 0.79], [0.2, 0.71], [0.45, 0.56], [0.68, 0.46],
]);

const ARCH_R = 0.44;

function archHeight(x: number): number {
  let h = -Infinity;
  for (const ax of [-HALF_WHEELBASE, HALF_WHEELBASE]) {
    const dx = x - ax;
    if (Math.abs(dx) < ARCH_R) h = Math.max(h, Math.sqrt(ARCH_R * ARCH_R - dx * dx));
  }
  return h;
}

/** Lofted body shell with wheel arches carved out of the sides. */
function buildShell(): THREE.BufferGeometry {
  const stations = 140;
  const ring = 72;
  const x0 = -2.27;
  const x1 = 2.38;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    // Denser sampling near the ends where curvature is high.
    const x = x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(t * Math.PI));
    const top = topY(x);
    const bot = bottomY(x);
    const w = halfWidth(x);
    const cy = bot + (top - bot) * 0.42;
    const rt = top - cy;
    const rb = cy - bot;
    const eTop = topExp(x);
    const arch = archHeight(x);
    for (let j = 0; j < ring; j++) {
      const phi = -Math.PI / 2 + (j / ring) * Math.PI * 2;
      const s = Math.sin(phi);
      const c = Math.cos(phi);
      let z = w * spow(c, 2 / (s > 0 ? eTop : 5));
      let y = s > 0 ? cy + rt * spow(s, 2 / eTop) : cy + rb * spow(s, 2 / 5);
      if (s > 0) y += crown(x) * (1 - (z / w) ** 2);
      if (Math.abs(z) > 0.6 && y < arch) {
        y = arch;
        z = Math.sign(z) * Math.max(Math.abs(z), 0.6);
      }
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + ((j + 1) % ring);
      const d = i * ring + ((j + 1) % ring);
      idx.push(a, b, c, a, c, d);
    }
  }
  // End caps.
  for (const [station, front] of [[0, false], [stations, true]] as const) {
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < ring; j++) {
      cx += pos[(station * ring + j) * 3];
      cy += pos[(station * ring + j) * 3 + 1];
    }
    const center = pos.length / 3;
    pos.push(cx / ring, cy / ring, 0);
    for (let j = 0; j < ring; j++) {
      const a = station * ring + j;
      const b = station * ring + ((j + 1) % ring);
      if (front) idx.push(center, b, a);
      else idx.push(center, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildGreenhouse(): THREE.BufferGeometry {
  const stations = 60;
  const ring = 40;
  const x0 = -1.02;
  const x1 = 0.68;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const x = x0 + ((x1 - x0) * i) / stations;
    const base = topY(x) - 0.06;
    const h = Math.max(0.005, roofY(x) - base);
    const w = halfWidth(x) - 0.26;
    for (let j = 0; j <= ring; j++) {
      const phi = (j / ring) * Math.PI;
      const z = w * spow(Math.cos(phi), 2 / 2.4);
      const y = base + h * Math.pow(Math.sin(phi), 2 / 2.4);
      pos.push(x, y, z);
    }
  }
  const rw = ring + 1;
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * rw + j;
      const b = (i + 1) * rw + j;
      const c = (i + 1) * rw + j + 1;
      const d = i * rw + j + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildRimGeometry(): THREE.BufferGeometry {
  const outer = 0.255;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const spokes = 10;
  for (let i = 0; i < spokes; i++) {
    const a0 = (i / spokes) * Math.PI * 2 + 0.11;
    const a1 = ((i + 1) / spokes) * Math.PI * 2 - 0.11;
    const r0 = 0.085;
    const r1 = 0.215;
    const hole = new THREE.Path();
    hole.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    hole.absarc(0, 0, r1, a0 + 0.04, a1 - 0.04, false);
    hole.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
    hole.absarc(0, 0, r0, a1, a0, true);
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.03,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 24,
  });
  return g;
}

function buildTireGeometry(width: number): THREE.BufferGeometry {
  const r = WHEEL_RADIUS;
  const h = width / 2;
  const pts = [
    new THREE.Vector2(0.25, -h),
    new THREE.Vector2(r - 0.035, -h),
    new THREE.Vector2(r - 0.012, -h + 0.018),
    new THREE.Vector2(r, -h + 0.05),
    new THREE.Vector2(r + 0.002, 0),
    new THREE.Vector2(r, h - 0.05),
    new THREE.Vector2(r - 0.012, h - 0.018),
    new THREE.Vector2(r - 0.035, h),
    new THREE.Vector2(0.25, h),
  ];
  const g = new THREE.LatheGeometry(pts, 64);
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

  constructor(paintColor = '#b3121a') {
    this.root.add(this.yaw);
    this.yaw.add(this.body);

    this.paint = new THREE.MeshPhysicalMaterial({
      color: paintColor,
      metalness: 0.55,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      envMapIntensity: 1.3,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#05070b',
      metalness: 0.2,
      roughness: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.0,
      envMapIntensity: 1.8,
    });
    const black = new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.55, metalness: 0.3 });
    const gloss = new THREE.MeshPhysicalMaterial({ color: '#08090b', roughness: 0.12, metalness: 0.4, clearcoat: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: '#9aa1aa', roughness: 0.25, metalness: 1 });

    const shell = new THREE.Mesh(buildShell(), this.paint);
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.body.add(shell);

    const cabin = new THREE.Mesh(buildGreenhouse(), glass);
    cabin.castShadow = true;
    this.body.add(cabin);

    // Seats and headrests visible through the glass.
    for (const z of [-0.38, 0.38]) {
      const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 6, 12), new THREE.MeshStandardMaterial({ color: '#d8d2c8', roughness: 0.7 }));
      seat.position.set(-0.45, 0.48, z);
      seat.rotation.z = 0.35;
      this.body.add(seat);
    }

    const ellipsoid = (sx: number, sy: number, sz: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
      m.scale.set(sx, sy, sz);
      return m;
    };

    // Headlights: slim slanted lenses on the fender leading edge.
    const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dff0ff', emissiveIntensity: 7 });
    for (const z of [-0.66, 0.66]) {
      const housing = ellipsoid(0.26, 0.032, 0.11, gloss);
      housing.position.set(1.96, 0.24, z);
      housing.rotation.z = -0.5;
      this.body.add(housing);
      const lens = ellipsoid(0.22, 0.016, 0.09, headMat);
      lens.position.set(1.975, 0.247, z * 1.01);
      lens.rotation.z = -0.5;
      this.body.add(lens);
    }
    // Lower intake.
    const intake = ellipsoid(0.1, 0.055, 0.5, black);
    intake.position.set(2.29, -0.1, 0);
    this.body.add(intake);
    // Side scoops ahead of the rear wheels.
    for (const z of [-1, 1]) {
      const scoop = ellipsoid(0.42, 0.075, 0.05, black);
      scoop.position.set(-0.62, 0.13, z * 0.95);
      scoop.rotation.z = 0.08;
      this.body.add(scoop);
      const mirror = ellipsoid(0.11, 0.055, 0.075, this.paint);
      mirror.position.set(0.42, 0.56, z * 0.86);
      this.body.add(mirror);
    }

    // Taillight bar across the Kamm tail.
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#ff0a12', emissive: '#ff0612', emissiveIntensity: 2.5 });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.45), this.tailMat);
    tail.position.set(-2.275, 0.29, 0);
    this.body.add(tail);
    for (const z of [-0.74, 0.74]) {
      const end = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.16), this.tailMat);
      end.position.set(-2.27, 0.27, z);
      this.body.add(end);
    }
    // Rear diffuser with fins.
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.5), black);
    diffuser.position.set(-2.0, -0.15, 0);
    diffuser.rotation.z = -0.25;
    this.body.add(diffuser);
    for (let i = -3; i <= 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.015), black);
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
    this.headlight.position.set(2.0, 0.2, 0);
    this.headlight.target.position.set(14, -1.4, 0);
    this.body.add(this.headlight);
    this.body.add(this.headlight.target);

    this.buildWheels(black, metal);
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

  private buildWheels(black: THREE.Material, metal: THREE.Material): void {
    const rubber = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.88, metalness: 0 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.22, metalness: 1, envMapIntensity: 1.4 });
    const caliperMat = new THREE.MeshPhysicalMaterial({ color: '#c8c9cc', roughness: 0.35, metalness: 0.6, clearcoat: 0.6 });
    const discMat = new THREE.MeshStandardMaterial({ color: '#5d6066', roughness: 0.45, metalness: 1 });
    const rimGeo = buildRimGeometry();
    const liner = new THREE.CylinderGeometry(ARCH_R - 0.025, ARCH_R - 0.025, 0.5, 28, 1, true, Math.PI / 2, Math.PI);
    liner.rotateX(Math.PI / 2);
    const linerMat = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.95, side: THREE.DoubleSide });
    for (const x of [-HALF_WHEELBASE, HALF_WHEELBASE]) {
      const width = x > 0 ? 0.27 : 0.31;
      const archLiner = new THREE.Mesh(liner, linerMat);
      archLiner.position.set(x, 0, 0.58);
      this.body.add(archLiner);
      const archLiner2 = archLiner.clone();
      archLiner2.position.z = -0.58;
      this.body.add(archLiner2);
      for (const side of [-1, 1]) {
        const wheel = new THREE.Group();
        wheel.position.set(x, 0, side * 0.8);
        if (side < 0) wheel.rotation.y = Math.PI;
        const spinner = new THREE.Group();
        wheel.add(spinner);
        const tire = new THREE.Mesh(buildTireGeometry(width), rubber);
        spinner.add(tire);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.z = width / 2 - 0.06;
        spinner.add(rim);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, width - 0.04, 32, 1, true), rimMat);
        barrel.rotation.x = Math.PI / 2;
        (barrel.material as THREE.Material).side = THREE.DoubleSide;
        spinner.add(barrel);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 24), metal);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = width / 2 - 0.015;
        spinner.add(hub);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 40), discMat);
        disc.rotation.x = Math.PI / 2;
        disc.position.z = width / 2 - 0.13;
        spinner.add(disc);
        const caliper = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.04, 10, 18, 1.0), caliperMat);
        caliper.position.z = width / 2 - 0.11;
        caliper.rotation.z = Math.PI * 0.55;
        caliper.scale.z = 0.8;
        wheel.add(caliper);
        this.yaw.add(wheel);
        this.wheelSpinners.push(spinner);
      }
    }
    void black;
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
