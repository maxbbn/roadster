import type { CollisionWorld, CircleContact, RayHit, Segment } from '../level/geometry';
import { HALF_WHEELBASE, WHEEL_RADIUS } from './roadster-model';
import type { InputState } from '../input';

// Arcade 2D vehicle physics that can follow any surface (floor, wall, ceiling).
// Frame: f = (cos a, sin a) points along the surface, u = (-sin a, cos a) is the car's up.
// `facing` decides whether the nose points along +f or -f.

export type CarMode = 'drive' | 'vacuum' | 'jet';

const G = 20;
const ACCEL = 18;
const BOOST_ACCEL = 30;
const MAX_SPEED = 34;
const BOOST_SPEED = 48;
const REVERSE_SPEED = 12;
const BRAKE = 42;
const COAST = 3;
const JUMP = 9.5;
const VACUUM_SEEK_RANGE = 7.5;
const VACUUM_PULL = 30;
const JET_UP = 36;
const JET_SIDE = 24;
const JET_MAX_X = 30;
const DETACH_UP = 0.35;

const BODY_CIRCLES: [number, number, number][] = [
  [-HALF_WHEELBASE, 0, WHEEL_RADIUS + 0.01],
  [HALF_WHEELBASE, 0, WHEEL_RADIUS + 0.01],
  [0, 0.28, 0.55],
  [-1.95, 0.12, 0.34],
  [2.0, 0.0, 0.3],
];

export interface CarEvents {
  onLand?: (impact: number) => void;
  onJump?: () => void;
  onTransition?: () => void;
  onModeChange?: (mode: CarMode, reason?: string) => void;
}

const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class CarController {
  x = 0;
  y = 0;
  angle = 0;
  facing = 1;
  vx = 0;
  vy = 0;
  speed = 0; // signed speed along f while grounded
  grounded = false;
  mode: CarMode = 'drive';
  fan = 100;
  fuel = 100;
  boosting = false;
  surfaceUp = 1; // u.y of the surface we stand on

  // Visual smoothing offsets that decay after snaps and transitions.
  offX = 0;
  offY = 0;
  offAngle = 0;
  yawVisual = 0;

  // Telemetry for visuals/audio.
  thrustUp = 0;
  thrustFwd = 0;
  thrustBack = 0;
  throttle = 0;
  braking = 0;
  accelSignal = 0;
  wheelSpin = 0;
  airTime = 0;
  seeking = false;

  private jumpTimer = 0;
  private forwardKey = 1;
  private jumpNormal = { x: 0, y: 1 };
  private contacts: CircleContact[] = [];
  private lastSegment: Segment | null = null;

  constructor(private world: CollisionWorld, private events: CarEvents = {}) {}

  get fx() {
    return Math.cos(this.angle);
  }
  get fy() {
    return Math.sin(this.angle);
  }
  get ux() {
    return -Math.sin(this.angle);
  }
  get uy() {
    return Math.cos(this.angle);
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y + WHEEL_RADIUS;
    this.angle = 0;
    this.facing = 1;
    this.forwardKey = 1;
    this.yawVisual = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.grounded = true;
    this.mode = 'drive';
    this.fan = 100;
    this.fuel = 100;
    this.offX = this.offY = this.offAngle = 0;
    this.jumpTimer = 0;
    this.airTime = 0;
    this.senseGround(0.6);
  }

  setMode(mode: CarMode, reason?: string): void {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'jet' && this.grounded) {
      // Lift off on the vertical thrusters.
      this.detach(this.fx * this.speed + this.ux * 7, this.fy * this.speed + this.uy * 7);
      this.jumpTimer = 0.25;
      this.jumpNormal = { x: this.ux, y: this.uy };
    }
    if (prev === 'vacuum' && this.grounded && this.uy < DETACH_UP) {
      this.detach(this.fx * this.speed + this.ux * 1.5, this.fy * this.speed + this.uy * 1.5);
    }
    this.events.onModeChange?.(mode, reason);
  }

  /** Velocity in world space regardless of state. */
  velocity(): [number, number] {
    return this.grounded ? [this.fx * this.speed, this.fy * this.speed] : [this.vx, this.vy];
  }

  step(dt: number, input: InputState, jumpPressed: boolean): void {
    this.jumpTimer = Math.max(0, this.jumpTimer - dt);
    this.thrustUp = this.thrustFwd = this.thrustBack = 0;
    this.braking = 0;
    this.boosting = false;
    this.seeking = false;
    const prevSpeed = this.speed;

    if (this.grounded) this.stepGround(dt, input, jumpPressed);
    else this.stepAir(dt, input);

    // Resources.
    const onFloor = this.grounded && this.uy > 0.6;
    if (this.mode === 'vacuum') {
      const steep = this.grounded && this.uy < 0.6;
      if (steep) this.fan -= 9 * dt;
      else if (this.seeking) this.fan -= 6 * dt;
      else if (onFloor) this.fan = Math.min(100, this.fan + 30 * dt);
      if (this.fan <= 0) {
        this.fan = 0;
        this.setMode('drive', 'fan');
      }
    } else if (this.grounded) {
      this.fan = Math.min(100, this.fan + 35 * dt);
    }
    if (this.grounded && !this.boosting) this.fuel = Math.min(100, this.fuel + 32 * dt);

    this.accelSignal = this.grounded ? (this.speed - prevSpeed) / dt : 0;
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // Decay visual offsets.
    const k = Math.exp(-dt * 13);
    this.offX *= k;
    this.offY *= k;
    this.offAngle *= k;
    const yawTarget = this.facing > 0 ? 0 : Math.PI;
    this.yawVisual += (yawTarget - this.yawVisual) * (1 - Math.exp(-dt * 9));
  }

  /**
   * Maps left/right to throttle. On floors "forward" is the key pointing where the nose points;
   * on walls and ceilings the mapping sticks, so holding the same key keeps driving forward.
   */
  private driveInput(input: InputState): number {
    if (this.uy > 0.7) this.forwardKey = this.facing * Math.sign(this.fx || 1);
    return ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * this.forwardKey;
  }

  private stepGround(dt: number, input: InputState, jumpPressed: boolean): void {
    let drive = this.driveInput(input);
    const forwardSpeed = this.speed * this.facing;
    // On flat ground, holding the opposite direction while slow turns the car around.
    if (this.uy > 0.7 && drive < 0 && forwardSpeed < 1.5) {
      this.facing = -this.facing;
      this.forwardKey = -this.forwardKey;
      drive = -drive;
    }
    const vacuum = this.mode === 'vacuum';
    const wantsBoost = input.boost && drive > 0 && this.fuel > 1;
    this.boosting = wantsBoost;
    if (wantsBoost) this.fuel -= 22 * dt;
    const maxF = wantsBoost ? BOOST_SPEED : MAX_SPEED;
    let fs = this.speed * this.facing; // speed in nose direction
    if (drive > 0) {
      if (fs < 0) {
        fs += BRAKE * dt;
        this.braking = 1;
      } else if (fs < maxF) fs = Math.min(maxF, fs + (wantsBoost ? BOOST_ACCEL : ACCEL) * dt);
      else fs = Math.max(maxF, fs - COAST * 2 * dt);
    } else if (drive < 0) {
      if (fs > 0) {
        fs = Math.max(0, fs - BRAKE * dt);
        this.braking = 1;
      } else fs = Math.max(-REVERSE_SPEED, fs - ACCEL * 0.6 * dt);
    } else {
      const c = vacuum ? COAST * 3 : COAST;
      fs = fs > 0 ? Math.max(0, fs - c * dt) : Math.min(0, fs + c * dt);
    }
    this.throttle = drive;
    this.speed = fs * this.facing;

    // Gravity along the surface. The fan's suction partly counters it.
    const gAlong = -G * this.fy;
    if (vacuum) {
      if (drive === 0 && Math.abs(this.speed) < 2.5) this.speed *= Math.exp(-dt * 6);
      else this.speed += gAlong * 0.4 * dt;
    } else {
      this.speed += gAlong * dt;
    }

    if (jumpPressed) {
      const jv = vacuum ? JUMP * 1.05 : JUMP;
      this.detach(this.fx * this.speed + this.ux * jv, this.fy * this.speed + this.uy * jv);
      this.jumpTimer = 0.18;
      this.jumpNormal = { x: this.ux, y: this.uy };
      this.events.onJump?.();
      return;
    }

    // Wall ahead in the direction of travel.
    const dir = Math.sign(this.speed) || this.facing;
    const probeLen = (dir > 0 ? 2.3 : 2.25) + 0.12;
    const ox = this.x + this.ux * 0.32;
    const oy = this.y + this.uy * 0.32;
    const wall = this.world.raycast(ox, oy, this.fx * dir, this.fy * dir, probeLen + Math.abs(this.speed) * dt);
    if (wall && wall.nx * this.ux + wall.ny * this.uy < 0.6) {
      if (vacuum && this.innerTransition(wall)) return;
      // Blocked: stop against the wall.
      const push = probeLen - wall.dist;
      if (push > 0) {
        this.x -= this.fx * dir * push;
        this.y -= this.fy * dir * push;
      }
      if (Math.abs(this.speed) > 8) this.events.onLand?.(Math.abs(this.speed) * 0.4);
      this.speed = -this.speed * 0.15;
    }

    this.x += this.fx * this.speed * dt;
    this.y += this.fy * this.speed * dt;

    const snap = vacuum ? 1.3 : 0.5;
    if (!this.senseGround(snap, dir)) return;

    // Without suction, steep walls and ceilings cannot hold the car.
    if (!vacuum && this.uy < DETACH_UP) {
      this.detach(this.fx * this.speed + this.ux * 0.5, this.fy * this.speed + this.uy * 0.5);
    }
  }

  private wheelRay(side: number, snap: number): RayHit | null {
    const cx = this.x + this.fx * HALF_WHEELBASE * side;
    const cy = this.y + this.fy * HALF_WHEELBASE * side;
    const lift = 0.9;
    const hit = this.world.raycast(cx + this.ux * lift, cy + this.uy * lift, -this.ux, -this.uy, lift + WHEEL_RADIUS + snap);
    if (!hit) return null;
    if (hit.nx * this.ux + hit.ny * this.uy < 0.3) return null;
    return hit;
  }

  /** Snaps the car onto the surface below its wheels. Returns false if it became airborne. */
  private senseGround(snap: number, moveDir = 1): boolean {
    const rear = this.wheelRay(-1, snap);
    const front = this.wheelRay(1, snap);
    if (rear && front) {
      const dx = front.x - rear.x;
      const dy = front.y - rear.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.5) {
        const target = Math.atan2(dy, dx);
        this.angle += wrapAngle(target - this.angle);
      }
      const mx = (rear.x + front.x) / 2;
      const my = (rear.y + front.y) / 2;
      this.x = mx + this.ux * WHEEL_RADIUS;
      this.y = my + this.uy * WHEEL_RADIUS;
      this.surfaceUp = (rear.ny + front.ny) / 2;
      this.lastSegment = front.seg;
      return true;
    }
    const one = rear ?? front;
    if (one) {
      const leadingMissing = (moveDir > 0 && !front) || (moveDir < 0 && !rear);
      if (this.mode === 'vacuum' && leadingMissing && Math.abs(this.speed) > 0.3 && this.outerTransition(one, moveDir)) return true;
      // Keep the remaining wheel on the surface.
      const side = one === rear ? -1 : 1;
      const wx = this.x + this.fx * HALF_WHEELBASE * side;
      const wy = this.y + this.fy * HALF_WHEELBASE * side;
      const along = (one.x - wx) * this.ux + (one.y - wy) * this.uy + WHEEL_RADIUS;
      this.x += this.ux * along;
      this.y += this.uy * along;
      this.surfaceUp = one.ny;
      return true;
    }
    this.detach(this.fx * this.speed, this.fy * this.speed);
    return false;
  }

  /** Concave corner: rotate onto the wall ahead. */
  private innerTransition(wall: RayHit): boolean {
    const ux = this.ux;
    const uy = this.uy;
    const gx = this.x - ux * WHEEL_RADIUS;
    const gy = this.y - uy * WHEEL_RADIUS;
    const corner = intersectLines(gx, gy, ux, uy, wall.x, wall.y, wall.nx, wall.ny);
    if (!corner) return false;
    // New direction of travel: along the new surface, away from the old one.
    let tx = wall.ny;
    let ty = -wall.nx;
    if (tx * ux + ty * uy < 0) {
      tx = -tx;
      ty = -ty;
    }
    this.applyTransition(corner.x, corner.y, wall.nx, wall.ny, tx, ty, Math.abs(this.speed) * 0.92);
    return true;
  }

  /** Convex corner: wrap around the edge the leading wheel just rolled off. */
  private outerTransition(support: RayHit, dir: number): boolean {
    const mx = this.fx * dir;
    const my = this.fy * dir;
    const lx = this.x + mx * HALF_WHEELBASE - this.ux * (WHEEL_RADIUS + 0.35);
    const ly = this.y + my * HALF_WHEELBASE - this.uy * (WHEEL_RADIUS + 0.35);
    const side = this.world.raycast(lx, ly, -mx, -my, HALF_WHEELBASE * 2 + 0.5);
    if (!side) return false;
    if (side.nx * mx + side.ny * my < 0.5) return false;
    const corner = intersectLines(support.x, support.y, support.nx, support.ny, side.x, side.y, side.nx, side.ny);
    if (!corner) return false;
    const tx = -this.ux;
    const ty = -this.uy;
    this.applyTransition(corner.x, corner.y, side.nx, side.ny, tx, ty, Math.max(4, Math.abs(this.speed) * 0.95));
    return true;
  }

  private applyTransition(cx: number, cy: number, nx: number, ny: number, tx: number, ty: number, speedAbs: number): void {
    const oldX = this.x;
    const oldY = this.y;
    const oldA = this.angle;
    this.angle = Math.atan2(-nx, ny);
    // Place the car with its trailing wheel just past the corner.
    this.x = cx + nx * WHEEL_RADIUS + tx * (HALF_WHEELBASE + 0.2);
    this.y = cy + ny * WHEEL_RADIUS + ty * (HALF_WHEELBASE + 0.2);
    const along = tx * this.fx + ty * this.fy;
    this.speed = speedAbs * Math.sign(along);
    // facing stays: the nose keeps pointing in the travel direction when moving forward.
    this.offX += oldX - this.x;
    this.offY += oldY - this.y;
    this.offAngle += wrapAngle(oldA - this.angle);
    this.senseGround(1.3, Math.sign(this.speed) || 1);
    this.events.onTransition?.();
  }

  private detach(vx: number, vy: number): void {
    if (this.grounded) this.jumpNormal = { x: this.ux, y: this.uy };
    this.grounded = false;
    this.vx = vx;
    this.vy = vy;
    this.lastSegment = null;
  }

  private stepAir(dt: number, input: InputState): void {
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.vy -= G * dt;

    if (this.mode === 'jet') {
      const up = input.up || input.jumpHeld;
      if (this.fuel > 0) {
        if (up) {
          this.vy += JET_UP * dt;
          this.thrustUp = 1;
          this.fuel -= 19 * dt;
        }
        if (ix !== 0) {
          if (Math.sign(this.vx) !== ix || Math.abs(this.vx) < JET_MAX_X) this.vx += ix * JET_SIDE * dt;
          this.fuel -= 7 * dt;
          if (ix === this.facing) this.thrustFwd = 1;
          else this.thrustBack = 1;
        }
        if (input.down) this.vy -= 12 * dt;
        this.fuel = Math.max(0, this.fuel);
      }
      this.vx *= Math.exp(-dt * 0.35);
      this.vy *= Math.exp(-dt * 0.25);
      if (ix !== 0 && ix !== this.facing && Math.abs(this.vx) < 6) this.facing = ix;
      // Nose pitches with vertical speed like a hovering craft.
      const target = this.facing * Math.max(-0.35, Math.min(0.35, this.vy * 0.025));
      this.angle += wrapAngle(target - this.angle) * (1 - Math.exp(-dt * 5));
    } else if (this.mode === 'vacuum' && this.seekSurface(dt)) {
      // seekSurface handles attraction and orientation.
    } else {
      // W/S pitch the nose; otherwise the car levels itself for a clean landing.
      const pitch = (input.up ? 1 : 0) - (input.down ? 1 : 0);
      if (pitch !== 0) this.angle += pitch * this.facing * 3.2 * dt;
      else this.angle += wrapAngle(0 - this.angle) * (1 - Math.exp(-dt * 2.2));
      if (ix !== 0 && Math.abs(this.vx) < MAX_SPEED) this.vx += ix * 4 * dt;
    }

    // Move in substeps proportional to speed to avoid tunnelling.
    const dist = Math.hypot(this.vx, this.vy) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.2));
    for (let i = 0; i < n; i++) {
      this.x += (this.vx * dt) / n;
      this.y += (this.vy * dt) / n;
      if (this.resolveAirCollisions()) return;
    }
  }

  /** Vacuum in the air: pull toward the nearest surface and turn the wheels to face it. */
  private seekSurface(dt: number): boolean {
    // Prefer surfaces other than the one we jumped from; fall back to it after a short delay.
    const jn = this.jumpNormal;
    let hit = this.world.nearestSurface(this.x, this.y, VACUUM_SEEK_RANGE, (s) => s.nx * jn.x + s.ny * jn.y <= 0.7);
    if (!hit && this.jumpTimer <= 0 && this.airTime > 0.45) hit = this.world.nearestSurface(this.x, this.y, VACUUM_SEEK_RANGE);
    if (!hit) return false;
    this.seeking = true;
    const dx = hit.x - this.x;
    const dy = hit.y - this.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const pull = VACUUM_PULL * Math.min(1, 2.5 / Math.max(1, d - 1)) + 8;
    this.vx += (dx / d) * pull * dt;
    this.vy += (dy / d) * pull * dt;
    const target = Math.atan2(-hit.nx, hit.ny);
    this.angle += wrapAngle(target - this.angle) * (1 - Math.exp(-dt * 9));
    return true;
  }

  /** Returns true if the car landed. */
  private resolveAirCollisions(): boolean {
    const fx = this.fx;
    const fy = this.fy;
    const ux = this.ux;
    const uy = this.uy;
    let landNormal: { x: number; y: number; impact: number } | null = null;
    for (const [lf, lu, r] of BODY_CIRCLES) {
      const cx = this.x + fx * lf + ux * lu;
      const cy = this.y + fy * lf + uy * lu;
      this.world.circleContacts(cx, cy, r, this.contacts);
      for (const c of this.contacts) {
        this.x += c.nx * c.depth;
        this.y += c.ny * c.depth;
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= c.nx * vn * 1.05;
          this.vy -= c.ny * vn * 1.05;
        }
        const canLand = this.jumpTimer <= 0 && (this.mode === 'vacuum' || c.ny > 0.4);
        if (canLand && (!landNormal || -vn > landNormal.impact)) landNormal = { x: c.nx, y: c.ny, impact: Math.max(0, -vn) };
      }
    }
    if (!landNormal) return false;
    this.land(landNormal.x, landNormal.y, landNormal.impact);
    return true;
  }

  private land(nx: number, ny: number, impact: number): void {
    const oldA = this.angle;
    this.angle = Math.atan2(-nx, ny);
    this.offAngle += wrapAngle(oldA - this.angle);
    this.grounded = true;
    this.speed = this.vx * this.fx + this.vy * this.fy;
    if (this.mode === 'jet') this.setMode('drive');
    // The nose follows the travel direction, so landing on a ceiling rolls the car over instead of reversing it.
    if (Math.abs(this.speed) > 3) this.facing = Math.sign(this.speed);
    const ox = this.x;
    const oy = this.y;
    if (!this.senseGround(1.0)) {
      this.grounded = true;
      this.speed = this.vx * this.fx + this.vy * this.fy;
    }
    this.offX += ox - this.x;
    this.offY += oy - this.y;
    this.events.onLand?.(impact);
  }

  /** Points used for hazard and pickup checks. */
  samplePoints(): [number, number][] {
    const pts: [number, number][] = [];
    for (const [lf, lu] of BODY_CIRCLES) pts.push([this.x + this.fx * lf + this.ux * lu, this.y + this.fy * lf + this.uy * lu]);
    return pts;
  }

  currentSegment(): Segment | null {
    return this.lastSegment;
  }
}

function intersectLines(ax: number, ay: number, anx: number, any: number, bx: number, by: number, bnx: number, bny: number): { x: number; y: number } | null {
  // Lines: dot(p - a, an) = 0 and dot(p - b, bn) = 0.
  const det = anx * bny - any * bnx;
  if (Math.abs(det) < 0.15) return null;
  const c1 = ax * anx + ay * any;
  const c2 = bx * bnx + by * bny;
  return { x: (c1 * bny - any * c2) / det, y: (anx * c2 - c1 * bnx) / det };
}
