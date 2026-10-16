// 2D collision geometry for the side-scrolling world (x right, y up).

export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  // Outward unit normal (solid is on the opposite side).
  nx: number;
  ny: number;
  len: number;
  solidId: number;
}

export interface RayHit {
  x: number;
  y: number;
  nx: number;
  ny: number;
  dist: number;
  seg: Segment;
}

export interface CircleContact {
  nx: number;
  ny: number;
  depth: number;
  px: number;
  py: number;
}

/** Vertex of a solid polygon outline; `r` is the fillet radius used at that corner. */
export interface PolyVertex {
  x: number;
  y: number;
  r?: number;
}

/**
 * Replaces each corner with a circular fillet so the outline becomes smooth.
 * Expects counter-clockwise vertices. Works for both convex and concave corners.
 */
export function roundPolygon(verts: PolyVertex[], defaultRadius = 0.25, arcSteps = 6): Vec2[] {
  const out: Vec2[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const prev = verts[(i + n - 1) % n];
    const cur = verts[i];
    const next = verts[(i + 1) % n];
    let r = cur.r ?? defaultRadius;
    const d1x = prev.x - cur.x;
    const d1y = prev.y - cur.y;
    const d2x = next.x - cur.x;
    const d2y = next.y - cur.y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (r <= 0.001 || l1 < 1e-6 || l2 < 1e-6) {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }
    const u1x = d1x / l1;
    const u1y = d1y / l1;
    const u2x = d2x / l2;
    const u2y = d2y / l2;
    const cos = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const angle = Math.acos(cos);
    if (angle > Math.PI - 0.01 || angle < 0.01) {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }
    // Distance from the corner to the tangent points.
    let t = r / Math.tan(angle / 2);
    const maxT = Math.min(l1, l2) * 0.49;
    if (t > maxT) {
      t = maxT;
      r = t * Math.tan(angle / 2);
    }
    const p1x = cur.x + u1x * t;
    const p1y = cur.y + u1y * t;
    const p2x = cur.x + u2x * t;
    const p2y = cur.y + u2y * t;
    const bisx = u1x + u2x;
    const bisy = u1y + u2y;
    const bl = Math.hypot(bisx, bisy);
    const cd = r / Math.sin(angle / 2);
    const cx = cur.x + (bisx / bl) * cd;
    const cy = cur.y + (bisy / bl) * cd;
    let a1 = Math.atan2(p1y - cy, p1x - cx);
    let a2 = Math.atan2(p2y - cy, p2x - cx);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const steps = Math.max(2, Math.ceil((arcSteps * Math.abs(da)) / (Math.PI / 2)));
    for (let s = 0; s <= steps; s++) {
      const a = a1 + (da * s) / steps;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    a1 = a2;
  }
  return out;
}

export function polygonArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const CELL = 8;

/** Static collision world made of polygon outlines with a uniform-grid broadphase. */
export class CollisionWorld {
  readonly segments: Segment[] = [];
  private grid = new Map<string, Segment[]>();
  private stamp = 0;
  private marks = new WeakMap<Segment, number>();

  addPolygon(points: Vec2[], solidId: number): void {
    const ccw = polygonArea(points) > 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      // For a CCW polygon the outward normal is the right-hand perpendicular.
      const nx = ccw ? dy / len : -dy / len;
      const ny = ccw ? -dx / len : dx / len;
      const seg: Segment = { ax: a.x, ay: a.y, bx: b.x, by: b.y, nx, ny, len, solidId };
      this.segments.push(seg);
      this.insert(seg);
    }
  }

  private insert(seg: Segment): void {
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / CELL);
    const x1 = Math.floor(Math.max(seg.ax, seg.bx) / CELL);
    const y0 = Math.floor(Math.min(seg.ay, seg.by) / CELL);
    const y1 = Math.floor(Math.max(seg.ay, seg.by) / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const key = `${gx},${gy}`;
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(seg);
      }
    }
  }

  private query(minX: number, minY: number, maxX: number, maxY: number, cb: (s: Segment) => void): void {
    this.stamp++;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const y0 = Math.floor(minY / CELL);
    const y1 = Math.floor(maxY / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const list = this.grid.get(`${gx},${gy}`);
        if (!list) continue;
        for (const s of list) {
          if (this.marks.get(s) === this.stamp) continue;
          this.marks.set(s, this.stamp);
          cb(s);
        }
      }
    }
  }

  /** Casts a ray and returns the closest front-facing hit. */
  raycast(ox: number, oy: number, dx: number, dy: number, maxDist: number, filter?: (s: Segment) => boolean): RayHit | null {
    const ex = ox + dx * maxDist;
    const ey = oy + dy * maxDist;
    let best: RayHit | null = null;
    this.query(Math.min(ox, ex), Math.min(oy, ey), Math.max(ox, ex), Math.max(oy, ey), (s) => {
      if (s.nx * dx + s.ny * dy >= 0) return;
      if (filter && !filter(s)) return;
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-9) return;
      const qx = s.ax - ox;
      const qy = s.ay - oy;
      const t = (qx * sy - qy * sx) / denom;
      const u = (qx * dy - qy * dx) / denom;
      if (t < 0 || t > maxDist || u < -1e-6 || u > 1 + 1e-6) return;
      if (!best || t < best.dist) {
        best = { x: ox + dx * t, y: oy + dy * t, nx: s.nx, ny: s.ny, dist: t, seg: s };
      }
    });
    return best;
  }

  /** Collects penetration contacts for a circle against all nearby segments. */
  circleContacts(cx: number, cy: number, r: number, out: CircleContact[]): void {
    out.length = 0;
    this.query(cx - r, cy - r, cx + r, cy + r, (s) => {
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      let t = ((cx - s.ax) * sx + (cy - s.ay) * sy) / (s.len * s.len);
      t = Math.max(0, Math.min(1, t));
      const px = s.ax + sx * t;
      const py = s.ay + sy * t;
      const dx = cx - px;
      const dy = cy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return;
      // Ignore contacts from the inside of a solid (back faces).
      const side = dx * s.nx + dy * s.ny;
      if (side < -0.05) return;
      const d = Math.sqrt(d2);
      let nx: number;
      let ny: number;
      if (d > 1e-5 && t > 0 && t < 1) {
        nx = s.nx;
        ny = s.ny;
      } else if (d > 1e-5) {
        nx = dx / d;
        ny = dy / d;
      } else {
        nx = s.nx;
        ny = s.ny;
      }
      const depth = t > 0 && t < 1 ? r - side : r - d;
      if (depth <= 0) return;
      out.push({ nx, ny, depth, px, py });
    });
  }

  /** Closest point on any front-facing surface within maxDist. */
  nearestSurface(cx: number, cy: number, maxDist: number, filter?: (s: Segment) => boolean): RayHit | null {
    let best: RayHit | null = null;
    this.query(cx - maxDist, cy - maxDist, cx + maxDist, cy + maxDist, (s) => {
      if (filter && !filter(s)) return;
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      let t = ((cx - s.ax) * sx + (cy - s.ay) * sy) / (s.len * s.len);
      t = Math.max(0, Math.min(1, t));
      const px = s.ax + sx * t;
      const py = s.ay + sy * t;
      const dx = cx - px;
      const dy = cy - py;
      if (dx * s.nx + dy * s.ny < 0) return;
      const d = Math.hypot(dx, dy);
      if (d > maxDist) return;
      if (!best || d < best.dist) {
        best = { x: px, y: py, nx: s.nx, ny: s.ny, dist: d, seg: s };
      }
    });
    return best;
  }
}
