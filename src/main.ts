import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const game = new Game(canvas, hud);

// Exposed for debugging in the browser console.
(window as unknown as { game: Game }).game = game;
