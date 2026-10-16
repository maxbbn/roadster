import type { Game } from '../game';
import type { InputState } from '../input';
import { DEMO_LEVEL } from '../level/level-data';

// Scripted driver that plays the demo level start to finish. Used to record the showcase video.

interface Waypoint {
  x: number;
  target: (game: Game, x: number, vx: number) => number;
}

export class Autopilot {
  private t = 0;
  private flags = new Set<string>();
  private waypoints: Waypoint[] = [];

  constructor(private titleTime = 3) {}

  private once(flag: string, fn: () => void): void {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    fn();
  }

  private buildWaypoints(game: Game): void {
    const wps: Waypoint[] = [];
    for (const gate of game.level.lasers) {
      const d = gate.def;
      wps.push({
        x: d.x + 2.6,
        target: (g, x, vx) => {
          // Aim for where the gap will be when the car arrives.
          const tArr = Math.max(0, (d.x - x) / Math.max(vx, 3));
          return d.gapCenter + Math.sin((g.clock + tArr) * d.speed + d.phase) * d.amplitude;
        },
      });
    }
    for (const pod of DEMO_LEVEL.fuelPods) wps.push({ x: pod.x, target: () => pod.y });
    wps.push({ x: 338, target: () => 17.5 });
    this.waypoints = wps.sort((a, b) => a.x - b.x);
  }

  update(game: Game, dt: number): void {
    this.t += dt;
    if (!this.waypoints.length) this.buildWaypoints(game);
    const s: InputState = { left: false, right: false, up: false, down: false, boost: false, jumpHeld: false };
    game.input.override = s;
    const press = (code: string) => game.input.inject(code);

    if (game.state === 'title') {
      if (this.t > this.titleTime) this.once('start', () => press('Enter'));
      return;
    }
    if (game.state !== 'play') return;

    const c = game.car;
    const { x, y } = c;

    if (c.mode === 'jet') {
      const vxT = 11;
      if (c.vx < vxT - 1) s.right = true;
      else if (c.vx > vxT + 1.5) s.left = true;
      const wp = this.waypoints.find((w) => w.x > x);
      const target = wp ? wp.target(game, x, c.vx) : 0;
      const descend = !wp || x > 337;
      if (!descend && (target - y) * 3 - c.vy * 1.4 > 0) s.up = true;
      return;
    }

    s.right = true;
    if (this.flags.has('start') && !this.flags.has('boostDone')) {
      s.boost = x < 4;
      if (x >= 4) this.flags.add('boostDone');
    }
    // Vacuum on before the first wall.
    if (x > 100 && x < 122) this.once('vac1', () => press('KeyQ'));
    // Hop from the high deck onto the ceiling.
    if (x > 150 && x < 159 && c.grounded && y > 15 && y < 17.5) this.once('ceiling', () => press('Space'));
    // Let go of the ceiling over the drop zone.
    if (x > 200 && c.grounded && c.uy < -0.5) this.once('drop', () => press('KeyQ'));
    // Drop zone: bleed off speed, then take off on the thrusters.
    if (this.flags.has('drop') && x > 212 && x < 251 && c.grounded && y > 11 && y < 13.5) {
      if (c.speed > 13 && x < 240) {
        s.right = false;
        s.left = true;
      } else this.once('jet', () => press('KeyE'));
    }
    // Final tower climb.
    if (x > 337 && x < 358 && c.grounded && y < 15) this.once('vac2', () => press('KeyQ'));
  }
}
