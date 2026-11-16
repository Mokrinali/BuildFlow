// Usage: node export.js <svgDir> <repoRoot>
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const fs = require('fs');
const path = require('path');

const [, , SVGDIR, ROOT] = process.argv;
const OFF_WHITE = '#F5F7FA';
const rd = (f) => fs.readFileSync(path.join(SVGDIR, f));
const mark = rd('buildflow-mark.svg');
const icon = rd('buildflow-mark-icon.svg');
const lockup = rd('buildflow-lockup.svg');
const out = (...p) => { const f = path.join(ROOT, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
const written = [];
const note = (f) => written.push(path.relative(ROOT, f).replace(/\\/g, '/'));

// Render an SVG to an n x n PNG; the art occupies `fill` of the side, centred.
async function square(svg, n, { fill = 1, bg = null } = {}) {
  const inner = Math.round(n * fill);
  const art = await sharp(svg, { density: Math.max(1, (72 * 4 * inner) / vbOf(svg)[2]) })
    .resize(inner, inner, { fit: 'contain', background: '#0000' }).png().toBuffer();
  let img = sharp({ create: { width: n, height: n, channels: 4, background: bg || '#0000' } })
    .composite([{ input: art, gravity: 'center' }]);
  if (bg) img = img.flatten({ background: bg });
  return img.png({ compressionLevel: 9 }).toBuffer();
}
// Pick a render density that rasterises at ~4x the target, then downsample (crisp edges, bounded size).
const vbOf = (svg) => /viewBox="([^"]+)"/.exec(svg.toString())[1].split(/\s+/).map(Number);
async function toHeight(svg, h) {
  const d = Math.max(1, (72 * 4 * h) / vbOf(svg)[3]);
  return sharp(svg, { density: d }).resize({ height: h }).png({ compressionLevel: 9 }).toBuffer();
}
async function toWidth(svg, w) {
  const d = Math.max(1, (72 * 4 * w) / vbOf(svg)[2]);
  return sharp(svg, { density: d }).resize({ width: w }).png({ compressionLevel: 9 }).toBuffer();
}
async function save(buf, ...p) { const f = out(...p); fs.writeFileSync(f, buf); note(f); }

(async () => {
  // Source vectors (approved)
  await save(mark, 'branding', 'buildflow-mark.svg');
  await save(lockup, 'branding', 'buildflow-lockup.svg');
  await save(icon, 'branding', 'buildflow-mark-icon.svg');

  // Favicons: icon variant (white frame), transparent background
  await save(icon, 'public', 'favicon.svg');
  const ico = await pngToIco(await Promise.all([16, 32, 48].map((n) => square(icon, n))));
  await save(ico, 'public', 'favicon.ico');
  await save(await square(icon, 32), 'public', 'favicon-32.png');

  // Web app icons
  await save(await square(icon, 192, { fill: 0.92 }), 'public', 'icons', 'icon-192.png');
  await save(await square(icon, 512, { fill: 0.92 }), 'public', 'icons', 'icon-512.png');
  // Maskable: square art with half-diagonal <= 40% of side -> side <= 0.8/sqrt(2) = 0.565
  await save(await square(icon, 512, { fill: 0.56, bg: OFF_WHITE }), 'public', 'icons', 'maskable-512.png');

  // Apple touch (opaque) and 1024 opaque master
  await save(await square(icon, 180, { fill: 0.76, bg: OFF_WHITE }), 'public', 'apple-touch-icon.png');
  await save(await square(icon, 1024, { fill: 0.76, bg: OFF_WHITE }), 'branding', 'exports', 'app-icon-1024.png');

  // Header assets
  await save(lockup, 'public', 'brand', 'buildflow-lockup.svg');
  await save(mark, 'public', 'brand', 'buildflow-mark.svg');
  await save(await toHeight(lockup, 32), 'public', 'brand', 'buildflow-lockup-32.png');
  await save(await toHeight(lockup, 64), 'public', 'brand', 'buildflow-lockup-32@2x.png');
  await save(await toHeight(mark, 24), 'public', 'brand', 'buildflow-mark-24.png');
  await save(await toHeight(mark, 48), 'public', 'brand', 'buildflow-mark-24@2x.png');

  // Branding: transparent PNG at 1024 and 2048 width, vector PDF
  await save(await toWidth(lockup, 1024), 'branding', 'exports', 'buildflow-lockup-1024.png');
  await save(await toWidth(lockup, 2048), 'branding', 'exports', 'buildflow-lockup-2048.png');
  const vb = /viewBox="([^"]+)"/.exec(lockup.toString())[1].split(/\s+/).map(Number);
  const pdfW = 600, pdfH = (pdfW * vb[3]) / vb[2];
  const pdfFile = out('branding', 'exports', 'buildflow-lockup.pdf');
  await new Promise((res, rej) => {
    const doc = new PDFDocument({ size: [pdfW, pdfH], margin: 0, info: { Title: 'BuildFlow' } });
    const s = fs.createWriteStream(pdfFile); s.on('finish', res); s.on('error', rej);
    doc.pipe(s); SVGtoPDF(doc, lockup.toString(), 0, 0, { width: pdfW, height: pdfH }); doc.end();
  });
  note(pdfFile);

  // Web manifest
  const manifest = {
    name: 'BuildFlow', short_name: 'BuildFlow', lang: 'ka', start_url: '/', display: 'standalone',
    background_color: OFF_WHITE, theme_color: '#092648',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  await save(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 'public', 'manifest.webmanifest');

  console.log(written.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
