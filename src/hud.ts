import type { CarMode } from './car/car-controller';
import { RESET_LABEL } from './input';

export const PAINTS: { name: string; color: string }[] = [
  { name: '珍珠白', color: '#dfe1e4' },
  { name: '烈焰红', color: '#b3121a' },
  { name: '曜石黑', color: '#16181c' },
  { name: '深海蓝', color: '#123a8c' },
  { name: '水银银', color: '#8e949c' },
];

export interface HudState {
  mode: CarMode;
  speedKmh: number;
  fan: number;
  fuel: number;
  time: number;
  cells: number;
  totalCells: number;
  deaths: number;
}

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export class Hud {
  private root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  paintIndex = 0;
  onPaint?: (color: string) => void;
  onStart?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="panel level">
          <div class="label">LEVEL</div>
          <div class="value" data-k="level">DEMO · 发射基地</div>
        </div>
        <div class="panel stat"><div class="label">TIME</div><div class="value mono" data-k="time">0:00.00</div></div>
        <div class="panel stat"><div class="label">CELLS</div><div class="value mono" data-k="cells">0/0</div></div>
      </div>
      <div class="speedo panel">
        <div class="mono speed" data-k="speed">0</div>
        <div class="label">KM/H</div>
      </div>
      <div class="toast" data-k="toast"></div>
      <div class="hud-bottom">
        <div class="modes">
          <div class="mode" data-mode="drive">DRIVE<small>驾驶</small></div>
          <div class="mode" data-mode="vacuum"><span class="key">Q</span>VACUUM<small>真空吸附</small></div>
          <div class="mode" data-mode="jet"><span class="key">E</span>JET<small>喷气</small></div>
        </div>
        <div class="bars">
          <div class="bar fan"><span>FAN</span><div class="track"><div class="fill" data-k="fan"></div></div></div>
          <div class="bar fuel"><span>THRUST</span><div class="track"><div class="fill" data-k="fuel"></div></div></div>
        </div>
      </div>
      <div class="help" data-k="help">
        <b>A/D</b> 驾驶 · <b>Shift</b> 加速 · <b>Space</b> 跳跃 / 喷气上升<br/>
        <b>Q</b> 真空吸附 · <b>E</b> 喷气（再按一次退出）<br/>
        <b>${RESET_LABEL}</b> 回到检查点 · <b>P</b> 暂停 · <b>M</b> 静音 · <b>H</b> 隐藏帮助
      </div>
      <div class="overlay" data-k="title">
        <div class="card">
          <div class="eyebrow">2.5D PLATFORMER · DEMO</div>
          <h1>ROADSTER<span>RUN</span></h1>
          <p>驶过发射基地：地面疾驰、真空吸附上墙倒挂、冷气推进飞越深渊。</p>
          <div class="paints" data-k="paints"></div>
          <button class="start" data-k="startBtn">开始 · Enter</button>
          <div class="keys">
            <div><b>A / D</b> 驾驶</div><div><b>Space</b> 跳跃 / 上升</div><div><b>Shift</b> 加速</div>
            <div><b>Q</b> 真空吸附</div><div><b>E</b> 喷气模式</div><div><b>${RESET_LABEL}</b> 重置</div>
          </div>
        </div>
      </div>
      <div class="overlay hidden" data-k="finish">
        <div class="card">
          <div class="eyebrow">LEVEL COMPLETE</div>
          <h1>发射成功</h1>
          <div class="results">
            <div><span>用时</span><b class="mono" data-k="rTime"></b></div>
            <div><span>能量电池</span><b class="mono" data-k="rCells"></b></div>
            <div><span>重来次数</span><b class="mono" data-k="rDeaths"></b></div>
            <div><span>评级</span><b class="rank" data-k="rRank"></b></div>
          </div>
          <button class="start" data-k="againBtn">再来一次 · Enter</button>
        </div>
      </div>
      <div class="fade" data-k="fade"></div>
    `;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    // Driven by the CSS animation itself so it also works when animations are stepped manually.
    this.el.toast.addEventListener('animationend', () => this.el.toast.classList.remove('show'));
    PAINTS.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' on' : '');
      b.style.setProperty('--c', p.color);
      b.title = p.name;
      b.innerHTML = `<i></i><span>${p.name}</span>`;
      b.onclick = () => this.selectPaint(i);
      this.el.paints.appendChild(b);
    });
    this.el.startBtn.onclick = () => this.onStart?.();
    this.el.againBtn.onclick = () => this.onStart?.();
  }

  selectPaint(i: number): void {
    this.paintIndex = (i + PAINTS.length) % PAINTS.length;
    [...this.el.paints.children].forEach((c, j) => c.classList.toggle('on', j === this.paintIndex));
    this.onPaint?.(PAINTS[this.paintIndex].color);
  }

  showTitle(show: boolean): void {
    this.el.title.classList.toggle('hidden', !show);
    this.root.classList.toggle('playing', !show);
  }

  showFinish(s: HudState | null): void {
    this.el.finish.classList.toggle('hidden', !s);
    if (!s) return;
    this.el.rTime.textContent = fmtTime(s.time);
    this.el.rCells.textContent = `${s.cells} / ${s.totalCells}`;
    this.el.rDeaths.textContent = String(s.deaths);
    const ratio = s.cells / s.totalCells;
    const rank = ratio >= 1 && s.deaths === 0 && s.time < 90 ? 'S' : ratio > 0.75 && s.time < 120 ? 'A' : ratio > 0.4 ? 'B' : 'C';
    this.el.rRank.textContent = rank;
  }

  toggleHelp(): void {
    this.el.help.classList.toggle('hidden');
  }

  toast(text: string, color = '#ffffff'): void {
    const t = this.el.toast;
    t.textContent = text;
    t.style.color = color;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  fade(on: boolean): void {
    this.el.fade.classList.toggle('on', on);
  }

  update(s: HudState): void {
    this.el.time.textContent = fmtTime(s.time);
    this.el.cells.textContent = `${s.cells}/${s.totalCells}`;
    this.el.speed.textContent = String(Math.round(s.speedKmh));
    (this.el.fan as HTMLElement).style.width = `${s.fan}%`;
    (this.el.fuel as HTMLElement).style.width = `${s.fuel}%`;
    this.el.fan.classList.toggle('low', s.fan < 25);
    this.el.fuel.classList.toggle('low', s.fuel < 25);
    this.root.querySelectorAll<HTMLElement>('.mode').forEach((m) => m.classList.toggle('on', m.dataset.mode === s.mode));
  }
}
