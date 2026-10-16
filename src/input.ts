// Keyboard + gamepad input with edge detection.

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
  jumpHeld: boolean;
}

/** Virtual key code for the reset shortcut (Ctrl+R / ⌘R, gamepad Y). */
export const RESET = 'Reset';

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const RESET_LABEL = IS_MAC ? '⌘R' : 'Ctrl+R';

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  /** When set (autopilot / recording), replaces live keyboard and gamepad state. */
  override: InputState | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Reset needs a modifier so it can't be hit by accident; also stops the browser from reloading.
      if (e.code === 'KeyR' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!e.repeat) this.pressed.add(RESET);
        return;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.held.has(e.code)) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      // macOS drops keyup for other keys while ⌘ is down, so drop everything when it is released.
      if (e.key === 'Meta') this.held.clear();
      else this.held.delete(e.code);
    });
    window.addEventListener('blur', () => this.held.clear());
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p) return p;
    return null;
  }

  state(): InputState {
    if (this.override) return this.override;
    const k = (c: string) => this.held.has(c);
    const pad = this.pad();
    const ax = pad ? pad.axes[0] ?? 0 : 0;
    const ay = pad ? pad.axes[1] ?? 0 : 0;
    const btn = (i: number) => !!pad?.buttons[i]?.pressed;
    return {
      left: k('KeyA') || k('ArrowLeft') || ax < -0.4 || btn(14),
      right: k('KeyD') || k('ArrowRight') || ax > 0.4 || btn(15),
      up: k('KeyW') || k('ArrowUp') || ay < -0.4 || btn(12) || btn(7),
      down: k('KeyS') || k('ArrowDown') || ay > 0.4 || btn(13),
      boost: k('ShiftLeft') || k('ShiftRight') || btn(5),
      jumpHeld: k('Space') || btn(0),
    };
  }

  /** Queues a key press as if it had been typed. */
  inject(code: string): void {
    this.pressed.add(code);
  }

  /** True once per key press. Gamepad buttons are mapped to key codes. */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  /** Call once per frame before reading presses to fold gamepad edges into key presses. */
  pollPad(): void {
    const pad = this.pad();
    if (!pad) return;
    const map: Record<number, string> = { 0: 'Space', 2: 'KeyQ', 1: 'KeyE', 3: RESET, 9: 'Enter' };
    for (const [i, code] of Object.entries(map)) {
      const idx = Number(i);
      const now = !!pad.buttons[idx]?.pressed;
      if (now && !this.padPrev[idx]) this.pressed.add(code);
      this.padPrev[idx] = now;
    }
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
