import * as THREE from 'three';
import { Stage } from './render/stage';
import { ParticleSystem } from './render/particles';
import { buildLevel, type BuiltLevel } from './level/level-builder';
import { buildBackground } from './level/background';
import { DEMO_LEVEL } from './level/level-data';
import { CarController, type CarMode } from './car/car-controller';
import { RoadsterModel, WHEEL_RADIUS } from './car/roadster-model';
import { Input, type InputState } from './input';
import { Hud, PAINTS } from './hud';
import { GameAudio } from './audio';

type GameState = 'title' | 'play' | 'dead' | 'finish';

const STEP = 1 / 120;
const NO_INPUT: InputState = { left: false, right: false, up: false, down: false, boost: false, jumpHeld: false };

export class Game {
  private stage: Stage;
  private level: BuiltLevel;
  private car: CarController;
  private model: RoadsterModel;
  private glow = new ParticleSystem(2500, true);
  private smoke = new ParticleSystem(900, false);
  private background: { update: (t: number, camX: number) => void };
  private input = new Input();
  private hud: Hud;
  private audio = new GameAudio();

  private state: GameState = 'title';
  private clock = 0;
  private runTime = 0;
  private cells = 0;
  private deaths = 0;
  private checkpoint = -1;
  private stateTimer = 0;
  private accumulator = 0;
  private last = performance.now();

  private cam = new THREE.Vector3(0, 4, 26);
  private camLook = new THREE.Vector3();
  private shake = 0;
  private vacuumVis = 0;
  private jetVis = 0;
  private pitch = 0;
  private pitchVel = 0;
  private lift = 0;
  private liftVel = 0;
  private emitCarry = 0;
  debugCam: [number, number, number] | null = null;
  paused = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.stage = new Stage(canvas);
    const scene = this.stage.scene;
    this.background = buildBackground(scene);
    this.level = buildLevel(scene, DEMO_LEVEL);
    this.model = new RoadsterModel(PAINTS[0].color);
    scene.add(this.model.root);
    scene.add(this.glow.points, this.smoke.points);

    this.car = new CarController(this.level.world, {
      onLand: (impact) => {
        if (impact > 6) {
          this.liftVel -= Math.min(1.6, impact * 0.08);
          this.audio.land(impact);
          this.dust(impact);
          this.shake = Math.max(this.shake, Math.min(0.35, impact * 0.02));
        }
      },
      onJump: () => {
        this.audio.jump();
        this.puff(14);
      },
      onTransition: () => this.sparks(10, '#7ff4ff'),
      onModeChange: (mode, reason) => this.announceMode(mode, reason),
    });
    this.car.reset(DEMO_LEVEL.start.x, DEMO_LEVEL.start.y);

    this.hud = new Hud(hudRoot);
    this.hud.onPaint = (c) => this.model.setPaint(c);
    this.hud.onStart = () => this.startRun();
    this.hud.showTitle(true);

    requestAnimationFrame((t) => this.frame(t));
  }

  private announceMode(mode: CarMode, reason?: string): void {
    if (this.state !== 'play') return;
    this.audio.mode(mode !== 'drive');
    if (reason === 'fan') this.hud.toast('风扇过热 · FAN OVERHEAT', '#ff6a5a');
    else if (mode === 'vacuum') this.hud.toast('VACUUM ON', '#3fe6ff');
    else if (mode === 'jet') this.hud.toast('JET MODE', '#9fd0ff');
  }

  private startRun(): void {
    this.audio.start();
    this.hud.showTitle(false);
    this.hud.showFinish(null);
    this.state = 'play';
    this.paused = false;
    this.runTime = 0;
    this.cells = 0;
    this.deaths = 0;
    this.checkpoint = -1;
    for (const p of this.level.pickups) {
      p.taken = false;
      p.mesh.visible = true;
    }
    for (const c of this.level.checkpoints) {
      c.active = false;
      c.lamp.color.setRGB(2.5, 0.6, 0.3);
    }
    this.respawn();
    this.model.headlight.intensity = 90;
  }

  private respawn(): void {
    const cp = this.checkpoint >= 0 ? this.level.checkpoints[this.checkpoint] : { x: DEMO_LEVEL.start.x, y: DEMO_LEVEL.start.y };
    this.car.reset(cp.x, cp.y);
    this.model.root.visible = true;
    this.glow.clear();
    this.smoke.clear();
    this.hud.fade(false);
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.input.pollPad();
    this.handleKeys();

    const inputState = this.state === 'play' ? this.input.state() : this.state === 'finish' ? { ...NO_INPUT, up: true } : NO_INPUT;
    let jump = this.state === 'play' && this.input.consume('Space');

    if ((this.state === 'play' && !this.paused) || this.state === 'finish') {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.car.step(STEP, inputState, jump);
        jump = false;
        this.accumulator -= STEP;
      }
    }
    if (this.state === 'play' && !this.paused) {
      this.runTime += dt;
      this.checkWorld();
    } else if (this.state === 'dead') {
      this.stateTimer -= dt;
      if (this.stateTimer < 0.4) this.hud.fade(true);
      if (this.stateTimer <= 0) {
        this.respawn();
        this.state = 'play';
      }
    } else if (this.state === 'finish') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0 && this.stateTimer > -dt * 1.5) this.hud.showFinish(this.hudState());
    }

    this.level.update(this.clock);
    this.updateCarVisuals(dt, inputState);
    this.updateCamera(dt);
    this.background.update(this.clock, this.stage.camera.position.x);
    this.glow.setViewportHeight(this.stage.viewportHeight);
    this.smoke.setViewportHeight(this.stage.viewportHeight);
    this.glow.update(dt);
    this.smoke.update(dt);

    const [vx, vy] = this.car.velocity();
    const speed = Math.hypot(vx, vy);
    const thrust = Math.max(this.car.thrustUp, this.car.thrustFwd, this.car.thrustBack, this.car.boosting ? 1 : 0);
    this.audio.update(speed, this.car.throttle, this.vacuumVis, thrust, this.state === 'play' || this.state === 'finish');
    this.hud.update(this.hudState());

    this.stage.render();
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private hudState() {
    const [vx, vy] = this.car.velocity();
    return {
      mode: this.car.mode,
      speedKmh: Math.hypot(vx, vy) * 3.6,
      fan: this.car.fan,
      fuel: this.car.fuel,
      time: this.runTime,
      cells: this.cells,
      totalCells: this.level.pickups.filter((p) => p.kind === 'cell').length,
      deaths: this.deaths,
    };
  }

  private handleKeys(): void {
    const i = this.input;
    if (i.consume('KeyM')) this.audio.toggleMute();
    if (i.consume('KeyH')) this.hud.toggleHelp();
    if (this.state === 'title') {
      if (i.consume('ArrowLeft') || i.consume('KeyA')) this.hud.selectPaint(this.hud.paintIndex - 1);
      if (i.consume('ArrowRight') || i.consume('KeyD')) this.hud.selectPaint(this.hud.paintIndex + 1);
      if (i.consume('Enter') || i.consume('Space')) this.startRun();
      return;
    }
    if (this.state === 'finish') {
      if (this.stateTimer < 0 && (i.consume('KeyR') || i.consume('Enter'))) this.startRun();
      return;
    }
    if (this.state !== 'play') return;
    if (i.consume('KeyP')) {
      this.paused = !this.paused;
      this.hud.toast(this.paused ? 'PAUSED' : 'GO', '#ffffff');
    }
    if (this.paused) return;
    if (i.consume('KeyR')) {
      this.respawn();
      return;
    }
    if (i.consume('Digit1')) this.car.setMode('drive');
    if (i.consume('Digit2')) this.car.setMode('vacuum');
    if (i.consume('Digit3')) this.car.setMode('jet');
    if (i.consume('KeyQ')) this.car.setMode(this.car.mode === 'vacuum' ? 'drive' : 'vacuum');
    if (i.consume('KeyE')) this.car.setMode(this.car.mode === 'jet' ? 'drive' : 'jet');
  }

  private checkWorld(): void {
    const car = this.car;
    const pts = car.samplePoints();
    for (const [px, py] of pts) {
      for (const h of DEMO_LEVEL.hazards) {
        if (px > h.x0 && px < h.x1 && py > h.y0 && py < h.y1 + 0.2) return this.die();
      }
      for (const g of this.level.lasers) {
        if (Math.abs(px - g.def.x) < 0.55 && py > g.def.yMin && py < g.def.yMax && (py < g.gapLow || py > g.gapHigh)) return this.die();
      }
    }
    if (car.y < DEMO_LEVEL.killY) return this.die();

    const cx = car.x + car.ux * 0.3;
    const cy = car.y + car.uy * 0.3;
    for (const p of this.level.pickups) {
      if (p.taken) continue;
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 < 1.9 * 1.9) {
        p.taken = true;
        p.mesh.visible = false;
        if (p.kind === 'cell') {
          this.cells++;
          this.audio.collect();
          this.sparks(26, '#5ff2ff', p.x, p.y);
        } else {
          car.fuel = 100;
          this.audio.fuel();
          this.sparks(26, '#ffb547', p.x, p.y);
          this.hud.toast('推进剂已补满', '#ffb547');
        }
      }
    }

    this.level.checkpoints.forEach((c, idx) => {
      if (idx <= this.checkpoint) return;
      if (car.x > c.x - 0.5 && Math.abs(car.y - c.y) < 8) {
        this.checkpoint = idx;
        c.active = true;
        c.lamp.color.setRGB(0.4, 3, 1.2);
        this.audio.checkpoint();
        this.hud.toast(`CHECKPOINT ${idx + 1}`, '#5dffa0');
      }
    });

    if (car.x >= DEMO_LEVEL.finishX && car.y > DEMO_LEVEL.finishY - 2) {
      this.state = 'finish';
      this.stateTimer = 2.6;
      this.audio.finish();
      this.hud.toast('LIFTOFF!', '#5dffa0');
      car.fuel = 100;
      car.setMode('jet');
      this.sparks(60, '#5dffa0');
    }
  }

  private die(): void {
    this.state = 'dead';
    this.stateTimer = 1.4;
    this.deaths++;
    this.audio.explode();
    this.shake = 0.8;
    const c = this.car;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 16;
      this.glow.emit({
        x: c.x, y: c.y + 0.3, z: (Math.random() - 0.5) * 2,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + 4, vz: (Math.random() - 0.5) * 8,
        life: 0.6 + Math.random() * 0.8, size: 0.25 + Math.random() * 0.4,
        color: Math.random() < 0.5 ? '#ff8a3a' : '#ffd27a', intensity: 3, drag: 1.5, gravity: 14,
      });
    }
    for (let i = 0; i < 30; i++) {
      this.smoke.emit({
        x: c.x + (Math.random() - 0.5) * 3, y: c.y + Math.random() * 2, z: (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: 0,
        life: 1.5 + Math.random(), size: 2 + Math.random() * 2, color: '#2a2a30', intensity: 1, drag: 1, grow: 1.5,
      });
    }
    this.model.root.visible = false;
  }

  /** Local car point (forward along the nose, up) to world space. */
  private local(fwd: number, up: number): [number, number] {
    const c = this.car;
    const f = fwd * c.facing;
    return [c.x + c.fx * f + c.ux * up, c.y + c.fy * f + c.uy * up];
  }

  private updateCarVisuals(dt: number, input: InputState): void {
    const c = this.car;
    const m = this.model;
    m.root.position.set(c.x + c.offX, c.y + c.offY, 0);
    m.root.rotation.z = c.angle + c.offAngle;
    m.yaw.rotation.y = c.yawVisual;

    const forwardSpeed = c.grounded ? c.speed * c.facing : 0;
    if (c.grounded) m.root.userData.spin = (m.root.userData.spin ?? 0) + (forwardSpeed * dt) / WHEEL_RADIUS;
    else m.root.userData.spin = (m.root.userData.spin ?? 0) + (input.right || input.left ? 30 : 4) * dt;

    // Suspension springs for body pitch and squat.
    const pitchTarget = c.grounded ? Math.max(-0.045, Math.min(0.045, c.accelSignal * c.facing * 0.0022)) : 0;
    this.pitchVel += ((pitchTarget - this.pitch) * 160 - this.pitchVel * 14) * dt;
    this.pitch += this.pitchVel * dt;
    this.liftVel += (-this.lift * 220 - this.liftVel * 16) * dt;
    this.lift += this.liftVel * dt;
    this.lift = Math.max(-0.08, Math.min(0.08, this.lift));

    const vacTarget = c.mode === 'vacuum' ? 1 : 0;
    this.vacuumVis += (vacTarget - this.vacuumVis) * (1 - Math.exp(-dt * 8));
    const jetTarget = c.mode === 'jet' || c.boosting ? 1 : 0;
    this.jetVis += (jetTarget - this.jetVis) * (1 - Math.exp(-dt * 7));
    const fwdThrust = Math.max(c.thrustFwd, c.boosting ? 1 : 0);
    m.update({
      wheelSpin: m.root.userData.spin,
      vacuum: this.vacuumVis,
      jetDeploy: this.jetVis,
      thrustUp: c.thrustUp,
      thrustFwd: fwdThrust,
      thrustBack: c.thrustBack,
      brake: c.braking,
      bodyPitch: this.pitch,
      bodyLift: this.lift,
      time: this.clock,
    });

    if (!m.root.visible) return;
    // Particle emitters.
    this.emitCarry += dt * 60;
    const n = Math.floor(this.emitCarry);
    this.emitCarry -= n;
    const [vx, vy] = c.velocity();
    for (let k = 0; k < n; k++) {
      if (c.thrustUp > 0) {
        for (const fx of [1.75, -1.75]) {
          const [x, y] = this.local(fx, -0.45);
          this.glow.emit({
            x, y, z: (Math.random() - 0.5) * 1.2,
            vx: vx * 0.3 - c.ux * 14 + (Math.random() - 0.5) * 3, vy: vy * 0.3 - c.uy * 14 + (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3,
            life: 0.25 + Math.random() * 0.2, size: 0.35, color: '#9fd4ff', intensity: 2.2, drag: 3,
          });
        }
        if (Math.random() < 0.5) {
          const [x, y] = this.local((Math.random() - 0.5) * 3.5, -0.8);
          this.smoke.emit({ x, y, z: (Math.random() - 0.5) * 2, vx: -c.ux * 6, vy: -c.uy * 6, vz: (Math.random() - 0.5) * 2, life: 1.0, size: 1.4, color: '#c8d2e6', intensity: 0.28, drag: 2.5, grow: 2.5 });
        }
      }
      if (fwdThrust > 0) {
        const [x, y] = this.local(-2.55, 0.06);
        const dx = -c.fx * c.facing;
        const dy = -c.fy * c.facing;
        this.glow.emit({
          x, y, z: (Math.random() - 0.5) * 0.8,
          vx: vx * 0.5 + dx * 18 + (Math.random() - 0.5) * 2, vy: vy * 0.5 + dy * 18 + (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
          life: 0.22 + Math.random() * 0.15, size: 0.32, color: c.boosting ? '#8fc0ff' : '#9fd4ff', intensity: 2.5, drag: 4,
        });
      }
      if (c.mode === 'vacuum' && Math.random() < 0.6) {
        // Air being drawn under the car.
        const side = Math.random() < 0.5 ? -1 : 1;
        const [x, y] = this.local((Math.random() - 0.5) * 4, -0.1);
        this.glow.emit({
          x: x + c.ux * 0.2, y: y + c.uy * 0.2, z: side * (2.0 + Math.random()),
          vx: vx - c.ux * 1.5, vy: vy - c.uy * 1.5, vz: -side * 6,
          life: 0.3, size: 0.09, color: '#55eaff', intensity: 2.5, drag: 0.5,
        });
      }
      if (c.grounded && c.braking && Math.abs(c.speed) > 6 && Math.random() < 0.5) {
        const [x, y] = this.local(-1.35 * Math.sign(c.speed * c.facing), -0.36);
        this.smoke.emit({ x, y, z: 0.9, vx: -vx * 0.1, vy: 0.6, vz: Math.random(), life: 0.9, size: 0.9, color: '#9aa0aa', intensity: 0.35, drag: 2, grow: 2 });
      }
    }
  }

  private updateCamera(dt: number): void {
    const c = this.car;
    const cam = this.stage.camera;
    if (this.debugCam) {
      // Fixed offset from the car, set from the console for inspection.
      const [ox, oy, oz] = this.debugCam;
      cam.position.set(c.x + ox, c.y + oy, oz);
      cam.lookAt(c.x, c.y + 0.2, 0);
      this.stage.followShadow(c.x, c.y);
      return;
    }
    if (this.state === 'title') {
      // Showroom orbit around the parked car.
      const a = Math.sin(this.clock * 0.25) * 0.75 + 0.35;
      const target = new THREE.Vector3(c.x + 0.2, c.y + 0.25, 0);
      cam.position.set(target.x + Math.sin(a) * 8.5, target.y + 1.6 + Math.sin(this.clock * 0.4) * 0.3, Math.cos(a) * 8.5);
      cam.lookAt(target);
      this.cam.copy(cam.position);
      this.camLook.copy(target);
      this.stage.followShadow(c.x, c.y);
      return;
    }
    const [vx, vy] = c.velocity();
    const speed = Math.hypot(vx, vy);
    // Narrow windows get a slightly wider pull-back so the car keeps some room around it.
    const aspect = cam.aspect;
    let dist = (19 + Math.min(7, speed * 0.16) + this.jetVis * 5) * Math.max(1, 1.5 / aspect);
    let height = 2.6;
    if (this.state === 'finish') {
      dist = 42;
      height = 6;
    }
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const halfW = halfH * aspect;
    const lookX = THREE.MathUtils.clamp(vx * 0.22, -halfW * 0.4, halfW * 0.4);
    const lookY = THREE.MathUtils.clamp(vy * 0.12, -halfH * 0.3, halfH * 0.35);
    const tx = c.x + lookX;
    const ty = c.y + lookY;
    const k = 1 - Math.exp(-dt * 4.5);
    this.camLook.x += (tx - this.camLook.x) * k;
    this.camLook.y += (ty - this.camLook.y) * k;
    this.cam.x += (this.camLook.x - this.cam.x) * k;
    this.cam.y += (this.camLook.y + height - this.cam.y) * k;
    this.cam.z += (dist - this.cam.z) * (1 - Math.exp(-dt * 2));
    this.shake *= Math.exp(-dt * 6);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    cam.position.set(this.cam.x + sx, this.cam.y + sy, this.cam.z);
    cam.lookAt(this.camLook.x + sx * 0.5, this.camLook.y + 0.8, 0);
    this.stage.followShadow(this.camLook.x, this.camLook.y);
  }

  private dust(impact: number): void {
    const n = Math.min(24, Math.floor(impact));
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1.35 : 1.35;
      const [x, y] = this.local(side, -0.36);
      this.smoke.emit({
        x, y, z: (Math.random() - 0.5) * 2.4,
        vx: (Math.random() - 0.5) * 6, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        life: 0.8 + Math.random() * 0.5, size: 0.8 + Math.random(), color: '#8b8f98', intensity: 0.3, drag: 3, grow: 2,
      });
    }
  }

  private puff(n: number): void {
    for (let i = 0; i < n; i++) {
      const [x, y] = this.local((Math.random() - 0.5) * 3.5, -0.4);
      this.smoke.emit({
        x, y, z: (Math.random() - 0.5) * 2,
        vx: -this.car.ux * 4 + (Math.random() - 0.5) * 3, vy: -this.car.uy * 4, vz: (Math.random() - 0.5) * 2,
        life: 0.6, size: 1, color: '#c8d2e6', intensity: 0.3, drag: 3, grow: 2,
      });
    }
  }

  private sparks(n: number, color: string, x = this.car.x, y = this.car.y): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 7;
      this.glow.emit({
        x, y, z: (Math.random() - 0.5) * 1.5,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: (Math.random() - 0.5) * 4,
        life: 0.4 + Math.random() * 0.4, size: 0.16, color, intensity: 3, drag: 2.5, gravity: 6,
      });
    }
  }
}
