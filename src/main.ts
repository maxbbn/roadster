import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const game = new Game(canvas, hud);

// Exposed for debugging in the browser console.
(window as unknown as { game: Game }).game = game;

// ?autopilot enables the scripted run used for recording the showcase video.
if (new URLSearchParams(location.search).has('autopilot')) {
  void import('./dev/autopilot').then(({ Autopilot }) => {
    game.autopilot = new Autopilot();
  });
}
