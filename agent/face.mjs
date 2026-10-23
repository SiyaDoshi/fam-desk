// The picture your caller sees while no snapshot is shown: a simple animated face.
// Frames are drawn once and cached (a few blink and mouth shapes), so the agent spends
// almost no CPU on video. Plain JavaScript with no dependencies.
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 10;

const BACKGROUND = [16, 40, 52], FACE = [141, 224, 196], INK = [16, 40, 52];
const MOUTHS = [4, 9, 14, 19];          // mouth heights: closed, then three open sizes
const cache = new Map();

function render(blink, mouth) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const cx = WIDTH / 2, cy = HEIGHT / 2 - 10, radius = HEIGHT * 0.36;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let color = BACKGROUND;
      if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) color = FACE;
      const eye = Math.abs(x - (cx - 45)) < 10 || Math.abs(x - (cx + 45)) < 10;
      if (eye && Math.abs(y - (cy - 35)) < (blink ? 2 : 14)) color = INK;
      if (((x - cx) / 48) ** 2 + ((y - (cy + 45)) / mouth) ** 2 < 1) color = INK;
      const i = (y * WIDTH + x) * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** One RGBA frame. `tick` counts frames; `speaking` opens and moves the mouth. */
export function drawFace(tick, speaking) {
  const blink = tick % 40 < 2;                                            // a short blink every 4 s
  const mouth = speaking ? MOUTHS[1 + (Math.floor(tick / 2) % 3)] : MOUTHS[0];
  const key = `${blink}-${mouth}`;
  if (!cache.has(key)) cache.set(key, render(blink, mouth));
  return cache.get(key);
}
