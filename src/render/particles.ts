import * as THREE from 'three';

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  color: THREE.ColorRepresentation;
  intensity?: number;
  drag?: number;
  gravity?: number;
  grow?: number;
}

const vertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, uSoft, d) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

/** CPU-simulated point sprites. Additive systems glow through bloom; normal ones are smoke/dust. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private grow: Float32Array;
  private cursor = 0;
  private tmpColor = new THREE.Color();
  private material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 0.0 : 0.2 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    if (!additive) {
      // Premultiplied output for normal blending.
      this.material.blending = THREE.CustomBlending;
      this.material.blendSrc = THREE.OneFactor;
      this.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 1.2;
  }

  emit(p: ParticleSpec): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx;
    this.vel[i * 3 + 1] = p.vy;
    this.vel[i * 3 + 2] = p.vz;
    this.tmpColor.set(p.color).multiplyScalar(p.intensity ?? 1);
    this.col[i * 3] = this.tmpColor.r;
    this.col[i * 3 + 1] = this.tmpColor.g;
    this.col[i * 3 + 2] = this.tmpColor.b;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.baseSize[i] = p.size;
    this.drag[i] = p.drag ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.grow[i] = p.grow ?? 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      this.alpha[i] = Math.max(0, this.life[i] > 0 ? (1 - t) * Math.min(1, t * 8 + 0.3) : 0);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}
