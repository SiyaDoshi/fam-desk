// Pixel helpers for the agent's video: rotate the caller's frame, fit it into the
// agent's 640x360 picture, draw a red circle and arrow, and encode JPEGs for the brain.
// Plain JavaScript on RGBA buffers, so it can be tested without a call.
import jpeg from 'jpeg-js';

/** An RGBA image: { data: Uint8Array, width, height }. */

/** Rotate an RGBA image clockwise by 0, 90, 180 or 270 degrees. */
export function rotate(img, degrees) {
  const d = ((degrees % 360) + 360) % 360;
  if (d === 0) return img;
  const { width: w, height: h, data } = img;
  const outW = d === 180 ? w : h, outH = d === 180 ? h : w;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (d === 90) { nx = h - 1 - y; ny = x; }
      else if (d === 180) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const s = (y * w + x) * 4, t = (ny * outW + nx) * 4;
      out[t] = data[s]; out[t + 1] = data[s + 1]; out[t + 2] = data[s + 2]; out[t + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/** Scale an image down (nearest neighbour) so its longest side is at most `max`. */
export function shrink(img, max) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1) return img;
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const s = (sy * img.width + sx) * 4, t = (y * w + x) * 4;
      out[t] = img.data[s]; out[t + 1] = img.data[s + 1]; out[t + 2] = img.data[s + 2]; out[t + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** JPEG bytes as base64, for sending a frame to the brain service. */
export function toJpegBase64(img, quality = 75) {
  const encoded = jpeg.encode({ data: Buffer.from(img.data), width: img.width, height: img.height }, quality);
  return Buffer.from(encoded.data).toString('base64');
}

/**
 * Fit `img` into a W x H canvas (letterboxed, dark background).
 * Returns the canvas plus the placement, so points on the image can be mapped onto it.
 */
export function fit(img, W, H, background = [16, 40, 52]) {
  const scale = Math.min(W / img.width, H / img.height);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const ox = Math.floor((W - w) / 2), oy = Math.floor((H - h) / 2);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = background[0]; out[i * 4 + 1] = background[1]; out[i * 4 + 2] = background[2]; out[i * 4 + 3] = 255;
  }
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const s = (sy * img.width + sx) * 4, t = ((y + oy) * W + (x + ox)) * 4;
      out[t] = img.data[s]; out[t + 1] = img.data[s + 1]; out[t + 2] = img.data[s + 2];
    }
  }
  return { canvas: { data: out, width: W, height: H }, ox, oy, w, h };
}

function dot(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; img.data[i + 3] = 255;
}

/** A ring centred on (cx, cy). */
export function ring(img, cx, cy, radius, thickness, color) {
  const r0 = (radius - thickness / 2) ** 2, r1 = (radius + thickness / 2) ** 2;
  for (let y = Math.floor(cy - radius - thickness); y <= cy + radius + thickness; y++) {
    for (let x = Math.floor(cx - radius - thickness); x <= cx + radius + thickness; x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d >= r0 && d <= r1) dot(img, x, y, color);
    }
  }
}

/** A thick line with a triangular head at (x1, y1). */
export function arrow(img, x0, y0, x1, y1, thickness, color) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const head = Math.min(28, len * 0.4);
  const bx = x1 - ux * head, by = y1 - uy * head;
  const steps = Math.ceil(len);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, px = x0 + (bx - x0) * t, py = y0 + (by - y0) * t;
    for (let dy = -thickness; dy <= thickness; dy++)
      for (let dx = -thickness; dx <= thickness; dx++)
        if (dx * dx + dy * dy <= thickness * thickness) dot(img, Math.round(px + dx), Math.round(py + dy), color);
  }
  // Head: fill the triangle (tip, base-left, base-right).
  const nx = -uy, ny = ux, half = head * 0.6;
  const ax = bx + nx * half, ay = by + ny * half, cx = bx - nx * half, cy = by - ny * half;
  const minX = Math.floor(Math.min(x1, ax, cx)), maxX = Math.ceil(Math.max(x1, ax, cx));
  const minY = Math.floor(Math.min(y1, ay, cy)), maxY = Math.ceil(Math.max(y1, ay, cy));
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d1 = sign(x, y, x1, y1, ax, ay), d2 = sign(x, y, ax, ay, cx, cy), d3 = sign(x, y, cx, cy, x1, y1);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) dot(img, x, y, color);
    }
  }
}

const RED = [255, 59, 48], WHITE = [255, 255, 255];

/**
 * The picture shown to the caller while pointing: their own snapshot, fitted to W x H,
 * with a red ring around the target and an arrow pointing at it.
 * `point` is { x, y } in 0..1 of the snapshot; `pulse` makes the ring larger on alternate frames.
 */
export function annotate(snapshot, point, W, H, pulse = false) {
  const { canvas, ox, oy, w, h } = fit(snapshot, W, H);
  const px = ox + point.x * w, py = oy + point.y * h;
  const radius = Math.max(22, Math.min(w, h) * 0.09) + (pulse ? 6 : 0);
  ring(canvas, px, py, radius + 3, 10, WHITE);        // white halo so red shows on any background
  ring(canvas, px, py, radius, 7, RED);
  // Arrow from whichever corner is farther, ending just outside the ring.
  const fromLeft = px > W / 2, fromTop = py > H / 2;
  const sx = fromLeft ? 30 : W - 30, sy = fromTop ? 30 : H - 30;
  const len = Math.hypot(px - sx, py - sy) || 1;
  const ex = px - ((px - sx) / len) * (radius + 12), ey = py - ((py - sy) / len) * (radius + 12);
  arrow(canvas, sx, sy, ex, ey, 6, WHITE);
  arrow(canvas, sx, sy, ex, ey, 4, RED);
  return canvas.data;
}
