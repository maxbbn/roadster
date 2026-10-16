import * as THREE from 'three';

// Procedural textures generated on canvases so the demo ships without binary assets.

function hash(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fractal noise in [0, 1]. */
function fbm(x: number, y: number, size: number, octaves: number, seed: number, baseFreq = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise((x / size) * freq, (y / size) * freq, freq, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

interface MaterialMaps {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

/**
 * Builds albedo, roughness and normal maps from a height function.
 * `sample` returns [height 0..1, albedo rgb 0..1, roughness 0..1].
 */
function buildMaps(size: number, sample: (x: number, y: number) => [number, number, number, number, number]): MaterialMaps {
  const heights = new Float32Array(size * size);
  const albedo = document.createElement('canvas');
  const rough = document.createElement('canvas');
  const normal = document.createElement('canvas');
  for (const c of [albedo, rough, normal]) {
    c.width = size;
    c.height = size;
  }
  const actx = albedo.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const nctx = normal.getContext('2d')!;
  const aImg = actx.createImageData(size, size);
  const rImg = rctx.createImageData(size, size);
  const nImg = nctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [h, r, g, b, ro] = sample(x, y);
      const i = y * size + x;
      heights[i] = h;
      aImg.data[i * 4] = Math.min(255, r * 255);
      aImg.data[i * 4 + 1] = Math.min(255, g * 255);
      aImg.data[i * 4 + 2] = Math.min(255, b * 255);
      aImg.data[i * 4 + 3] = 255;
      const rv = Math.min(255, ro * 255);
      rImg.data[i * 4] = rv;
      rImg.data[i * 4 + 1] = rv;
      rImg.data[i * 4 + 2] = rv;
      rImg.data[i * 4 + 3] = 255;
    }
  }
  const strength = 3.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = heights[y * size + ((x - 1 + size) % size)];
      const hr = heights[y * size + ((x + 1) % size)];
      const hu = heights[((y - 1 + size) % size) * size + x];
      const hd = heights[((y + 1) % size) * size + x];
      let nx = (hl - hr) * strength;
      let ny = (hd - hu) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      nImg.data[i] = (nx * 0.5 + 0.5) * 255;
      nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nImg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nImg.data[i + 3] = 255;
    }
  }
  actx.putImageData(aImg, 0, 0);
  rctx.putImageData(rImg, 0, 0);
  nctx.putImageData(nImg, 0, 0);
  const wrap = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: wrap(albedo, true), roughnessMap: wrap(rough, false), normalMap: wrap(normal, false) };
}

let cache: { asphalt: MaterialMaps; panels: MaterialMaps; metal: MaterialMaps } | null = null;

export function getTextures() {
  if (cache) return cache;
  const S = 512;
  // Wet asphalt deck: dark aggregate with puddle-smooth patches.
  const asphalt = buildMaps(S, (x, y) => {
    const n = fbm(x, y, S, 6, 1, 16);
    const grain = hash(x, y, 9);
    const puddle = fbm(x, y, S, 3, 5, 2);
    const wet = puddle > 0.55 ? 1 : puddle > 0.5 ? (puddle - 0.5) / 0.05 : 0;
    const base = 0.07 + n * 0.06 + grain * 0.04;
    const c = base * (1 - wet * 0.35);
    const lane = (x % 256 > 120 && x % 256 < 136 && y % 128 < 70) ? 0.5 : 0;
    const h = n * 0.6 + grain * 0.4 - wet * 0.5;
    return [h, c + lane * 0.6, c + lane * 0.55, c * 1.05 + lane * 0.3, 0.75 - wet * 0.65 + grain * 0.1 - lane * 0.2];
  });
  // Industrial wall panels with seams, bolts and grime.
  const panels = buildMaps(S, (x, y) => {
    const px = x % 128;
    const py = y % 256;
    const seam = px < 3 || py < 3 ? 1 : 0;
    const boltX = (px - 10) ** 2 + ((py % 64) - 10) ** 2 < 9 ? 1 : 0;
    const grime = fbm(x, y, S, 5, 3, 4);
    const streak = fbm(x * 0.2, y * 3, S, 3, 11, 8);
    const panelTone = hash(Math.floor(x / 128), Math.floor(y / 256), 4) * 0.05;
    const base = 0.16 + panelTone + grime * 0.08 - streak * 0.05;
    const h = 0.5 - seam * 0.5 + boltX * 0.4 + grime * 0.1;
    const c = base * (1 - seam * 0.6) + boltX * 0.1;
    return [h, c * 0.95, c, c * 1.1, 0.55 + grime * 0.3 - boltX * 0.3 + seam * 0.2];
  });
  // Brushed metal for props.
  const metal = buildMaps(256, (x, y) => {
    const brush = fbm(x * 0.05, y * 4, 256, 4, 21, 8);
    const c = 0.55 + brush * 0.15;
    return [brush, c, c, c * 1.02, 0.25 + brush * 0.2];
  });
  cache = { asphalt, panels, metal };
  return cache;
}

/** Canvas texture with text, used for in-world tutorial signs. */
export function makeSignTexture(lines: string[], accent: string, width = 1024, height = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, 'rgba(8,14,30,0.92)');
  g.addColorStop(1, 'rgba(4,8,18,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, width - 28, height - 28);
  ctx.fillStyle = accent;
  ctx.fillRect(14, 14, 18, height - 28);
  ctx.textBaseline = 'middle';
  const lh = (height - 80) / lines.length;
  lines.forEach((line, i) => {
    const isTitle = i === 0;
    ctx.font = `${isTitle ? 800 : 600} ${isTitle ? 92 : 64}px "PingFang SC", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = isTitle ? accent : '#e8eefc';
    ctx.fillText(line, 70, 40 + lh * (i + 0.5));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft radial sprite used for glows and particles. */
export function makeGlowTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
