// Usage: node trace.js <source.png> <outDir>
const sharp = require('sharp');
const { Potrace } = require('potrace');
const fs = require('fs');
const path = require('path');

const [, , SRC, OUT] = process.argv;
const NAVY = '#092648';
const ORANGE = '#FF7900';
const SCALE = 2; // upscale before tracing for smoother curves

function traceMask(mask, w, h) {
  return new Promise(async (resolve, reject) => {
    // mask: Uint8Array 1=ink. potrace wants dark ink on light bg.
    const px = Buffer.alloc(w * h);
    for (let i = 0; i < w * h; i++) px[i] = mask[i] ? 0 : 255;
    const png = await sharp(px, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
    const p = new Potrace({ threshold: 128, turdSize: 20, optTolerance: 0.3, alphaMax: 1.0, optCurve: true });
    p.loadImage(png, (err) => {
      if (err) return reject(err);
      const tag = p.getPathTag();
      const d = /d="([^"]+)"/.exec(tag)[1];
      resolve(d);
    });
  });
}

(async () => {
  const meta = await sharp(SRC).metadata();
  const W = meta.width * SCALE, H = meta.height * SCALE;
  const { data } = await sharp(SRC).resize(W, H, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const ink = new Uint8Array(W * H);    // any opaque pixel
  const orange = new Uint8Array(W * H); // orange pixels
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 128) continue;
    ink[i] = 1;
    if (r > 170 && g > 60 && g < 190 && b < 90) orange[i] = 1;
  }

  // Find gap column between mark and wordmark.
  const colInk = new Array(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) colInk[x]++;
  let first = colInk.findIndex((c) => c > 0);
  let x = first; while (colInk[x] > 0) x++; // end of mark run
  const markEnd = x; while (colInk[x] === 0) x++;
  const textStart = x;
  const split = Math.round((markEnd + textStart) / 2);

  function bbox(mask, x0, x1) {
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let xx = x0; xx < x1; xx++) if (mask[y * W + xx]) {
      if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
  }
  const markBox = bbox(ink, 0, split);
  const allBox = bbox(ink, 0, W);

  const markInk = ink.map((v, i) => (i % W < split ? v : 0));
  const textInk = ink.map((v, i) => (i % W >= split ? v : 0));
  const markOrange = orange.map((v, i) => (i % W < split ? v : 0));

  // Silhouette of the mark (holes filled), slightly eroded so white never peeks past the navy edge.
  // Flood-fill the exterior, limited to the mark box plus a 2px margin (everything beyond is exterior).
  const bx0 = markBox.minX - 2, bx1 = markBox.maxX + 2, by0 = markBox.minY - 2, by1 = markBox.maxY + 2;
  const outside = new Uint8Array(W * H).fill(1);
  for (let yy = by0; yy < by1; yy++) for (let xx = bx0; xx < bx1; xx++) outside[yy * W + xx] = 0;
  const stack = [by0 * W + bx0];
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || markInk[i]) continue;
    outside[i] = 1;
    const cx = i % W, cy = (i / W) | 0;
    if (cx > bx0) stack.push(i - 1); if (cx < bx1 - 1) stack.push(i + 1);
    if (cy > by0) stack.push(i - W); if (cy < by1 - 1) stack.push(i + W);
  }
  let sil = outside.map((v) => (v ? 0 : 1));
  for (let pass = 0; pass < 8; pass++) {
    const next = new Uint8Array(W * H);
    for (let yy = markBox.minY; yy < markBox.maxY; yy++) for (let xx = markBox.minX; xx < markBox.maxX; xx++) {
      const i = yy * W + xx;
      next[i] = sil[i] && sil[i - 1] && sil[i + 1] && sil[i - W] && sil[i + W] ? 1 : 0;
    }
    sil = next;
  }

  const [dMark, dText, dArrow, dSil] = await Promise.all([
    traceMask(markInk, W, H), traceMask(textInk, W, H), traceMask(markOrange, W, H), traceMask(sil, W, H),
  ]);

  const vb = (b, pad) => `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const svg = (viewBox, body, title) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}">\n<title>${title}</title>\n${body}\n</svg>\n`;
  const markBody = `<path fill="${NAVY}" fill-rule="evenodd" d="${dMark}"/>\n<path fill="${ORANGE}" fill-rule="evenodd" d="${dArrow}"/>`;
  const textBody = `<path fill="${NAVY}" fill-rule="evenodd" d="${dText}"/>`;

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'buildflow-mark.svg'), svg(vb(markBox, 0), markBody, 'BuildFlow'));
  fs.writeFileSync(path.join(OUT, 'buildflow-lockup.svg'), svg(vb(allBox, 0), markBody + '\n' + textBody, 'BuildFlow'));
  // Icon variant: white-filled frame so it reads on dark backgrounds (browser tabs, home screens).
  // Square viewBox centred on the mark.
  const mw = markBox.maxX - markBox.minX, mh = markBox.maxY - markBox.minY, side = Math.max(mw, mh);
  const sq = `${markBox.minX - (side - mw) / 2} ${markBox.minY - (side - mh) / 2} ${side} ${side}`;
  const iconBody = `<path fill="#FFFFFF" d="${dSil}"/>\n` + markBody;
  fs.writeFileSync(path.join(OUT, 'buildflow-mark-icon.svg'), svg(sq, iconBody, 'BuildFlow'));
  console.log(JSON.stringify({ W, H, split, markBox, allBox, sizes: { mark: dMark.length, arrow: dArrow.length, text: dText.length } }));
})().catch((e) => { console.error(e); process.exit(1); });
