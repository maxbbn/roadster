import * as THREE from 'three';

// Distant scenery: sky dome, stars, moon, mountain ridges, industrial skyline and the launch vehicle.

function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function buildBackground(scene: THREE.Scene): { update: (t: number, camX: number) => void } {
  const group = new THREE.Group();
  scene.add(group);

  // Sky dome follows the camera horizontally so it never runs out.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uMoonDir: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uMoonDir; varying vec3 vDir; void main(){
        float h = vDir.y;
        vec3 zen = vec3(0.004,0.008,0.03);
        vec3 mid = vec3(0.02,0.03,0.09);
        vec3 hor = vec3(0.16,0.09,0.17);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, zen, smoothstep(0.18, 0.8, h));
        float glow = pow(max(0.0, 1.0 - abs(h - 0.02) * 9.0), 2.0);
        c += vec3(0.9,0.32,0.12) * glow * 0.45 * smoothstep(-0.2, 0.6, vDir.x);
        float m = max(0.0, dot(vDir, uMoonDir));
        c += vec3(0.5,0.6,0.9) * pow(m, 60.0) * 0.6;
        c += vec3(1.6,1.7,2.0) * smoothstep(0.9993, 0.9996, m);
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  sky.renderOrder = -10;
  group.add(sky);

  // Stars.
  const r = rand(7);
  const starPos: number[] = [];
  const starCol: number[] = [];
  for (let i = 0; i < 2600; i++) {
    const theta = r() * Math.PI * 2;
    const y = 0.08 + r() * 0.92;
    const rad = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(theta) * rad * 1500, y * 1500, Math.sin(theta) * rad * 1500);
    const b = 0.4 + r() * r() * 2.2;
    const warm = r();
    starCol.push(b * (0.8 + warm * 0.2), b * 0.9, b * (1.1 - warm * 0.2));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starCol, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  stars.renderOrder = -9;
  group.add(stars);

  // Mountain ridges in layers.
  const ridge = (z: number, base: number, height: number, color: string, seed: number) => {
    const rr = rand(seed);
    const shape = new THREE.Shape();
    const x0 = -900;
    const x1 = 1400;
    shape.moveTo(x0, base - 200);
    let h = height * 0.5;
    for (let x = x0; x <= x1; x += 14) {
      h += (rr() - 0.5) * height * 0.22;
      h = Math.max(height * 0.15, Math.min(height, h));
      const peak = Math.sin(x * 0.004 + seed) * height * 0.3;
      shape.lineTo(x, base + h + peak);
    }
    shape.lineTo(x1, base - 200);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color }));
    m.position.z = z;
    group.add(m);
  };
  ridge(-900, -20, 220, '#0b1026', 3);
  ridge(-600, -20, 150, '#0a0d1f', 11);
  ridge(-380, -15, 80, '#080a17', 19);

  // Background ground plane.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 1200),
    new THREE.MeshStandardMaterial({ color: '#07080c', roughness: 0.55, metalness: 0.2 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(200, -8, -600);
  ground.receiveShadow = true;
  group.add(ground);

  // Industrial skyline with procedural lit windows.
  const cityMat = new THREE.MeshStandardMaterial({ color: '#0d1018', roughness: 0.7, metalness: 0.3 });
  cityMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos2;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos2 = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos2;\nfloat hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec2 cell = vec2(floor((vWorldPos2.x + vWorldPos2.z) / 2.4), floor(vWorldPos2.y / 3.2));
        vec2 f = vec2(fract((vWorldPos2.x + vWorldPos2.z) / 2.4), fract(vWorldPos2.y / 3.2));
        float win = step(0.25, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.75);
        float lit = step(0.8, hh(cell)) * (0.35 + 0.65 * hh(cell + 7.7));
        vec3 wc = mix(vec3(1.0,0.75,0.45), vec3(0.6,0.85,1.0), hh(cell + 3.1));
        totalEmissiveRadiance += wc * win * lit * 0.55;`,
      );
  };
  const rc = rand(42);
  const count = 170;
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMat, count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const x = -160 + rc() * 760;
    const z = -70 - rc() * 190;
    const w = 8 + rc() * 22;
    const d = 8 + rc() * 20;
    const h = 8 + rc() * rc() * 80;
    m4.makeScale(w, h, d);
    m4.setPosition(x, -8 + h / 2, z);
    city.setMatrixAt(i, m4);
  }
  group.add(city);

  // Red aircraft warning lights on top of the tallest buildings.
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.2) });
  const beacons: THREE.Mesh[] = [];
  for (let i = 0; i < 18; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), beaconMat);
    b.position.set(-120 + rc() * 700, 40 + rc() * 50, -80 - rc() * 100);
    group.add(b);
    beacons.push(b);
  }

  buildLaunchSite(group);

  return {
    update: (t, camX) => {
      sky.position.x = camX;
      stars.position.x = camX;
      const on = Math.sin(t * 2.2) > 0.2;
      beacons.forEach((b, i) => (b.visible = on !== (i % 2 === 0)));
    },
  };
}

/** Stainless-steel launch vehicle on its mount next to a lattice tower, behind the finish. */
function buildLaunchSite(group: THREE.Group): void {
  const steel = new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 1, roughness: 0.28, envMapIntensity: 1.2 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1c22', metalness: 0.8, roughness: 0.5 });
  const x = 420;
  const z = -34;
  const baseY = 30;

  // Mount platform.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(70, 46, 40), new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.85 }));
  pad.position.set(x, baseY - 23, z);
  pad.receiveShadow = true;
  group.add(pad);
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 8, 32), dark);
  mount.position.set(x, baseY + 4, z);
  group.add(mount);

  // Booster + ship stack.
  const R = 4.5;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 70, 48, 20), steel);
  body.position.set(x, baseY + 8 + 35, z);
  body.castShadow = true;
  group.add(body);
  // Panel rings.
  for (let i = 1; i < 14; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.02, 0.06, 6, 48), dark);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, baseY + 8 + i * 5, z);
    group.add(ring);
  }
  const nosePts: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    nosePts.push(new THREE.Vector2(R * Math.cos(t * Math.PI * 0.5) ** 0.8, t * 12));
  }
  const nose = new THREE.Mesh(new THREE.LatheGeometry(nosePts, 48), steel);
  nose.position.set(x, baseY + 8 + 70, z);
  group.add(nose);
  // Flaps.
  for (const [y, s] of [[baseY + 70, 0.6], [baseY + 14, 1]] as const) {
    for (const side of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(5 * s, 9 * s, 0.4), dark);
      flap.position.set(x + side * (R + 2.2 * s), y, z);
      group.add(flap);
    }
  }
  // Booster engine glow.
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.6, 1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 0.4) }));
  glow.position.set(x, baseY + 7.6, z);
  group.add(glow);

  // Lattice tower.
  const tx = x - 16;
  const towerH = 92;
  const beamMat = new THREE.MeshStandardMaterial({ color: '#3a3f48', metalness: 0.9, roughness: 0.45 });
  const beams: THREE.Matrix4[] = [];
  const add = (sx: number, sy: number, sz: number, px: number, py: number, pz: number, rz = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz));
    beams.push(m);
  };
  const w = 8;
  for (const cx of [-w / 2, w / 2]) for (const cz of [-w / 2, w / 2]) add(0.7, towerH, 0.7, tx + cx, baseY + towerH / 2, z + cz);
  for (let y = 0; y < towerH; y += 6) {
    for (const cz of [-w / 2, w / 2]) {
      add(w, 0.35, 0.35, tx, baseY + y, z + cz);
      add(Math.hypot(w, 6), 0.25, 0.25, tx, baseY + y + 3, z + cz, Math.atan2(6, w) * (y % 12 === 0 ? 1 : -1));
    }
    add(0.35, 0.35, w, tx - w / 2, baseY + y, z);
    add(0.35, 0.35, w, tx + w / 2, baseY + y, z);
  }
  // Catch arms.
  add(14, 1.6, 1.6, tx + 9, baseY + 64, z - 4);
  add(14, 1.6, 1.6, tx + 9, baseY + 64, z + 4);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), beamMat, beams.length);
  beams.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.castShadow = true;
  group.add(inst);
  const towerLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2) });
  for (let y = 10; y < towerH; y += 18) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), towerLight);
    l.position.set(tx + w / 2 + 0.5, baseY + y, z + w / 2);
    group.add(l);
  }

  // Floodlights washing the stack.
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight('#dfe8ff', 6000, 160, 0.32, 0.6, 1.6);
    spot.position.set(x + side * 30, baseY + 2, z + 26);
    spot.target.position.set(x, baseY + 50, z);
    group.add(spot);
    group.add(spot.target);
  }
}
