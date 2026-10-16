import type { PolyVertex } from './geometry';

// Demo level "Launch Complex": drive -> ramp jump -> vacuum wall climb -> ceiling run
// -> jet flight through laser gates -> vacuum tower climb -> launch pad finish.

export type SurfaceStyle = 'road' | 'wall' | 'ceiling' | 'pillar' | 'tower';

export interface SolidDef {
  verts: PolyVertex[];
  style: SurfaceStyle;
  radius?: number;
  accent?: string;
}

export interface HazardDef {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface LaserGateDef {
  x: number;
  yMin: number;
  yMax: number;
  gapCenter: number;
  gapSize: number;
  amplitude: number;
  speed: number;
  phase: number;
}

export interface SignDef {
  x: number;
  y: number;
  lines: string[];
  accent: string;
}

export interface CheckpointDef {
  x: number;
  y: number;
}

export interface LevelData {
  name: string;
  start: { x: number; y: number };
  killY: number;
  finishX: number;
  finishY: number;
  solids: SolidDef[];
  hazards: HazardDef[];
  lasers: LaserGateDef[];
  cells: { x: number; y: number }[];
  fuelPods: { x: number; y: number }[];
  checkpoints: CheckpointDef[];
  signs: SignDef[];
  lamps: { x: number; y: number; color: string }[];
}

const BOTTOM = -40;

export const DEMO_LEVEL: LevelData = {
  name: 'DEMO · 发射基地',
  start: { x: -14, y: 0 },
  killY: -18,
  finishX: 402,
  finishY: 34,
  solids: [
    // Start road with a back wall, a bump and the launch ramp.
    {
      style: 'road',
      verts: [
        { x: -44, y: BOTTOM, r: 0 },
        { x: 76, y: BOTTOM, r: 0 },
        { x: 76, y: 3.4, r: 0.25 },
        { x: 58, y: 0, r: 10 },
        { x: 36, y: 0, r: 3 },
        { x: 31, y: 0.9, r: 4 },
        { x: 26, y: 0, r: 3 },
        { x: -30, y: 0, r: 4 },
        { x: -30, y: 14, r: 0.6 },
        { x: -44, y: 14, r: 0 },
      ],
    },
    // Landing strip and the vacuum wall up to the high deck.
    {
      style: 'road',
      verts: [
        { x: 92, y: BOTTOM, r: 0 },
        { x: 160, y: BOTTOM, r: 0 },
        { x: 160, y: 16, r: 0.6 },
        { x: 124, y: 16, r: 1.0 },
        { x: 124, y: 0, r: 0.25 },
        { x: 92, y: 0, r: 0.6 },
      ],
      accent: '#3fe6ff',
    },
    // Ceiling over the second plasma pit, with a hanging block to wrap around.
    {
      style: 'ceiling',
      verts: [
        { x: 148, y: 22, r: 0.8 },
        { x: 181, y: 22, r: 0.25 },
        { x: 181, y: 17.6, r: 0.8 },
        { x: 190, y: 17.6, r: 0.8 },
        { x: 190, y: 22, r: 0.25 },
        { x: 228, y: 22, r: 0.8 },
        { x: 228, y: 31, r: 0.5 },
        { x: 148, y: 31, r: 0.5 },
      ],
      accent: '#3fe6ff',
    },
    // Drop zone below the ceiling exit, also the jet launch deck.
    {
      style: 'road',
      verts: [
        { x: 208, y: BOTTOM, r: 0 },
        { x: 250, y: BOTTOM, r: 0 },
        { x: 250, y: 12, r: 0.5 },
        { x: 208, y: 12, r: 0.5 },
      ],
    },
    // Refuel pillar in the middle of the chasm.
    {
      style: 'pillar',
      verts: [
        { x: 281, y: BOTTOM, r: 0 },
        { x: 290, y: BOTTOM, r: 0 },
        { x: 290, y: 6, r: 0.6 },
        { x: 281, y: 6, r: 0.6 },
      ],
      accent: '#ffb547',
    },
    // Far side, launch tower and the end wall.
    {
      style: 'tower',
      verts: [
        { x: 334, y: BOTTOM, r: 0 },
        { x: 446, y: BOTTOM, r: 0 },
        { x: 446, y: 70, r: 0.5 },
        { x: 432, y: 70, r: 0.5 },
        { x: 432, y: 34, r: 3 },
        { x: 360, y: 34, r: 1.0 },
        { x: 360, y: 14, r: 0.25 },
        { x: 334, y: 14, r: 0.5 },
      ],
      accent: '#3fe6ff',
    },
  ],
  hazards: [
    { x0: 76, x1: 92, y0: BOTTOM, y1: -3.5 },
    { x0: 160, x1: 208, y0: BOTTOM, y1: -2 },
    { x0: 250, x1: 334, y0: BOTTOM, y1: -4 },
  ],
  lasers: [
    { x: 262, yMin: -4, yMax: 44, gapCenter: 12, gapSize: 7.5, amplitude: 4, speed: 1.1, phase: 0 },
    { x: 304, yMin: -4, yMax: 44, gapCenter: 13, gapSize: 7, amplitude: 5, speed: 1.4, phase: 1.7 },
    { x: 322, yMin: -4, yMax: 44, gapCenter: 16, gapSize: 7, amplitude: 4, speed: 1.8, phase: 3.1 },
  ],
  cells: [
    { x: 6, y: 1.4 },
    { x: 12, y: 1.4 },
    { x: 18, y: 1.4 },
    { x: 31, y: 2.6 },
    { x: 80, y: 7.2 },
    { x: 84, y: 8 },
    { x: 88, y: 7.2 },
    { x: 108, y: 1.4 },
    { x: 123.1, y: 5 },
    { x: 123.1, y: 9 },
    { x: 123.1, y: 13 },
    { x: 140, y: 17.4 },
    { x: 166, y: 21 },
    { x: 174, y: 21 },
    { x: 185.5, y: 16.6 },
    { x: 200, y: 21 },
    { x: 214, y: 21 },
    { x: 228, y: 13.4 },
    { x: 256, y: 14 },
    { x: 272, y: 11 },
    { x: 285.5, y: 7.6 },
    { x: 296, y: 12 },
    { x: 313, y: 15 },
    { x: 345, y: 15.4 },
    { x: 359, y: 20 },
    { x: 359, y: 25 },
    { x: 359, y: 30 },
    { x: 378, y: 35.4 },
  ],
  fuelPods: [
    { x: 270, y: 14 },
    { x: 285.5, y: 10 },
    { x: 313, y: 20 },
  ],
  checkpoints: [
    { x: 98, y: 0 },
    { x: 136, y: 16 },
    { x: 216, y: 12 },
    { x: 340, y: 14 },
  ],
  signs: [
    { x: -4, y: 0, lines: ['欢迎来到发射基地', 'A / D  或  ← / →  驾驶', 'Shift 加速 · Space 跳跃'], accent: '#ff3b3b' },
    { x: 50, y: 0, lines: ['前方：等离子坑', '全速冲上坡道飞越'], accent: '#ffb547' },
    { x: 110, y: 0, lines: ['真空吸附 · VACUUM', '按 Q 开启风扇吸附', '直接驶上垂直墙面'], accent: '#3fe6ff' },
    { x: 146, y: 16, lines: ['倒挂行驶', '吸附模式下 Space 跳向天花板', '到达对岸再按 Q 释放'], accent: '#3fe6ff' },
    { x: 232, y: 12, lines: ['喷气模式 · JET', '按 E 展开冷气推进器', 'W / ↑ 升力 · A / D 平推'], accent: '#8fc8ff' },
    { x: 348, y: 14, lines: ['最后一段：发射塔', '吸附或喷气 — 你来选', '登顶即可完成 Demo'], accent: '#ff3b3b' },
  ],
  lamps: [
    { x: -20, y: 0, color: '#ffd8a8' },
    { x: 22, y: 0, color: '#ffd8a8' },
    { x: 64, y: 0, color: '#ff8a5c' },
    { x: 104, y: 0, color: '#9fe8ff' },
    { x: 152, y: 16, color: '#9fe8ff' },
    { x: 238, y: 12, color: '#ffd8a8' },
    { x: 350, y: 14, color: '#ffd8a8' },
    { x: 392, y: 34, color: '#ff5050' },
  ],
};
