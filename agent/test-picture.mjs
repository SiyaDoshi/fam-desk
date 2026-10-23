// Preview what the caller sees when the agent points at something, without a call.
//   npm run test:picture -- photo.jpg 0.7 0.4     (x, y of the target in 0..1)
// Writes pointer-preview.jpg next to this file. With no photo, uses a test pattern.
import { readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { HEIGHT, WIDTH } from './face.mjs';
import { annotate, shrink } from './image.mjs';

const [file, xs = '0.7', ys = '0.4'] = process.argv.slice(2);
let img;
if (file) {
  const decoded = jpeg.decode(readFileSync(file), { useTArray: true });
  img = { data: decoded.data, width: decoded.width, height: decoded.height };
} else {
  const width = 480, height = 640, data = new Uint8Array(width * height * 4);   // portrait, like a phone camera
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = 60 + x / 4; data[i + 1] = 90 + y / 5; data[i + 2] = 140; data[i + 3] = 255;
  }
  img = { data, width, height };
}
const pixels = annotate(shrink(img, 640), { x: Number(xs), y: Number(ys) }, WIDTH, HEIGHT);
const out = jpeg.encode({ data: Buffer.from(pixels), width: WIDTH, height: HEIGHT }, 85);
const path = new URL('./pointer-preview.jpg', import.meta.url);
writeFileSync(path, out.data);
console.log('Wrote', path.pathname);
