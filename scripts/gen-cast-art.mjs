/**
 * Generates the 2D Sketch performer artwork with Gemini image generation
 * ("nano banana") and writes cut-out PNGs into public/cast/ plus the face
 * measurements the renderer needs in src/utils/castArt.json.
 *
 *   node scripts/gen-cast-art.mjs              # every character
 *   node scripts/gen-cast-art.mjs marcus       # just one
 *   node scripts/gen-cast-art.mjs --model gemini-3.1-flash-image
 *   node scripts/gen-cast-art.mjs --measure    # also re-measure the faces
 *   node scripts/gen-cast-art.mjs --measure-only   # measure the committed art
 *
 * The performers are drawn mouthless on purpose: the mouth is animated at
 * runtime from the audio envelope (see drawMouth in ThreeCharacterSegment),
 * which needs the lower face to stay blank skin.
 *
 * The API only returns JPEG, so the character is generated over a flat green
 * screen that gets keyed out here into a transparent PNG.
 *
 * Face anchors are measured by asking Gemini to point at the landmarks, which
 * gets close but wanders by a few percent between runs - enough to land a mouth
 * somewhere that isn't the mouth. So anchors are measured once, committed, and
 * left alone unless asked for: check /tmp/cast-anchors-*.png, which marks them
 * on the artwork, before trusting a fresh measurement.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const REFS = path.join(import.meta.dirname, 'refs');
/**
 * Local cache of the green-screen originals, so a face can be re-measured
 * without paying to redraw it. Not committed: generate before --measure-only.
 */
const RENDER_DIR = path.join(import.meta.dirname, 'renders');
const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'cast');
const MANIFEST = path.join(import.meta.dirname, '..', 'src', 'utils', 'castArt.json');

/** Shared so both performers read as one illustrated set. */
const STYLE = `
STYLE (match the first reference image exactly):
- Modern flat vector character illustration, the polished editorial look of the first reference.
- Flat fills only: no gradients, no airbrush, no painterly shading, no 3D, no photo realism.
- Confident uniform dark outlines on the silhouette and features, softer thin lines inside.
- Warm limited palette, simple cel shapes for hair volume, gentle rounded cartoon proportions
  with a slightly oversized head. Charming and friendly, not chibi, not anime, not clip art.
- Clean geometry and deliberate line weight: this must look drawn by an illustrator,
  not assembled from primitive shapes.

FRAMING (identical for every character so the set matches):
- Exactly one person in the frame. Never a pair, a before and after, a comparison, a
  variant sheet, or the same character drawn twice.
- Chest-up bust portrait, facing the viewer straight on, symmetrical.
- Dead centre in the square frame with equal green margins on the left and the right.
- Hair top about 10% down from the top edge; hair top to chin about 45% of the frame height.
- Relaxed shoulders, arms down and out of frame. No hands, no arms, no gestures, no props.
- The figure must not touch the left or right edge. Leave at least 12% of the frame width as
  plain green margin outside each shoulder. Only the lower chest runs off the bottom edge.
- Calm, open, welcoming expression. No frown, no furrowed brow, no squint.
- Smooth cheeks: no smile creases, no nasolabial folds, no dimples near the mouth area.

CRITICAL - THE FACE HAS NO MOUTH:
- Draw eyes, brows, nose, ears, cheeks as normal, then leave the whole area below the
  nose as smooth blank skin. No lips, no teeth, no smile line, no shading there.
- Exactly like the mouthless head in the first reference image, whose mouth shapes are
  drawn separately beside it. The mouth is animated later, so that area must stay empty.

BACKGROUND:
- Fill every pixel that is not the character with pure saturated green (#00FF00).
- No shadow, no props, no text, no mouth chart, no frame, no vignette, no gradient.
`;

const CHARACTERS = {
  marcus: {
    refs: ['style-lipsync-kit.png', 'marcus-likeness.png'],
    prompt: `Illustrate the man in the second reference photo as a warm, likeable character.

LIKENESS (from the second reference photo):
- Dark brown hair, side parted, medium length, falling in a soft sweep across his forehead.
- Large square glasses with pale translucent tan / clear frames, thin rims, sitting mid face.
- Clear green eyes, fair skin, relaxed friendly expression, level relaxed brows.
- Clean shaven, with no facial hair of any kind, so nothing covers the blank mouth area.
- A plain black quilted puffer jacket with a high collar, over a dark top. The jacket is
  completely unbranded: no logo, no badge, no lettering, no chest mark.`,
  },
  sienna: {
    refs: ['style-lipsync-kit.png', 'sienna-likeness.png'],
    prompt: `Illustrate the woman in the second reference photo as a warm, likeable character.

LIKENESS (from the second reference photo):
- Near black straight glossy hair to just below the shoulders.
- A blunt straight fringe cut across the forehead just above the brows - it is her signature
  feature, so make it crisp, heavy and unmistakable.
- Bright, wide open dark almond eyes, full dark brows, warm mid tone skin, soft blush.
- Small delicate hoop earrings.
- A simple cream crew neck top, shoulders relaxed, arms out of frame.`,
  },
};

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const MODEL = opt('model', 'gemini-3.1-flash-image');
const MEASURE_MODEL = opt('measure-model', 'gemini-3.8-flash');
/** Longest edge of the shipped PNG. The stage never draws them larger. */
const MAX_SIDE = Number(opt('max-side', 1100));
const targets = args.filter((a) => CHARACTERS[a]);
const ids = targets.length ? targets : Object.keys(CHARACTERS);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function refPart(file) {
  return {
    inlineData: {
      mimeType: 'image/png',
      data: readFileSync(path.join(REFS, file)).toString('base64'),
    },
  };
}

async function generate(character) {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          ...character.refs.map(refPart),
          { text: `${character.prompt}\n${STYLE}` },
        ],
      },
    ],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: '2K' },
    },
  });

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image) {
    const text = parts.map((p) => p.text).filter(Boolean).join(' ');
    throw new Error(`no image returned${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return Buffer.from(image.inlineData.data, 'base64');
}

/** Green enough to be screen rather than artwork. Tolerant: JPEG rings hard on flat green. */
function isScreen(r, g, b) {
  return g > 70 && g - r > 45 && g - b > 45;
}

/**
 * Keys out the green screen. Flood fills inward from the border instead of
 * testing every pixel, so green in the artwork itself survives, then feathers
 * and despills the boundary that JPEG left smeared.
 */
function cutOut({ data, width, height }) {
  const n = width * height;
  const bg = new Uint8Array(n);
  const stack = [];

  for (let x = 0; x < width; x++) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }

  while (stack.length) {
    const i = stack.pop();
    if (bg[i]) continue;
    const p = i * 4;
    if (!isScreen(data[p], data[p + 1], data[p + 2])) continue;
    bg[i] = 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - width);
    if (y < height - 1) stack.push(i + width);
  }

  const out = Buffer.alloc(n * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    let a = bg[i] ? 0 : 255;

    if (a > 0) {
      // Green spill on the contour: fade it out and pull the hue back to neutral
      // so the cut edge does not glow against the backdrop card.
      const spill = g - Math.max(r, b);
      if (spill > 18) {
        const t = Math.min(1, (spill - 18) / 55);
        a = Math.round(255 * (1 - t));
        g = Math.round(g - spill * 0.9);
      }
    }

    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = a;

    if (a > 8) {
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('keyed image is empty - the whole frame read as green screen');

  return { minX, minY, maxX, maxY, pixels: out };
}

/**
 * Area-average downscale. The renderer never draws these much over 800px, so
 * shipping the raw 2K render would be megabytes of detail nobody sees.
 */
function resize(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = (sy * srcW + sx) * 4;
          const alpha = src[p + 3];
          // Weight colour by coverage so transparent pixels don't wash the edge.
          r += src[p] * alpha;
          g += src[p + 1] * alpha;
          b += src[p + 2] * alpha;
          a += alpha;
          n++;
        }
      }

      const p = (y * dstW + x) * 4;
      if (a > 0) {
        out[p] = Math.round(r / a);
        out[p + 1] = Math.round(g / a);
        out[p + 2] = Math.round(b / a);
        out[p + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

/**
 * Snaps each channel to a 6-bit step. Invisible on flat artwork, but it turns
 * the JPEG's noisy near-identical pixels back into long identical runs, which
 * is most of the PNG size.
 */
function quantise(pixels) {
  for (let p = 0; p < pixels.length; p += 4) {
    if (pixels[p + 3] === 0) continue;
    pixels[p] = (pixels[p] >> 2) << 2;
    pixels[p + 1] = (pixels[p + 1] >> 2) << 2;
    pixels[p + 2] = (pixels[p + 2] >> 2) << 2;
    if (pixels[p + 3] > 250) pixels[p + 3] = 255;
  }
}

/** Crops the keyed pixels down to the artwork and scales it to MAX_SIDE. */
function finish(keyed, width, height) {
  const pad = 4;
  const minX = Math.max(0, keyed.minX - pad);
  const minY = Math.max(0, keyed.minY - pad);
  const maxX = Math.min(width - 1, keyed.maxX + pad);
  const maxY = Math.min(height - 1, keyed.maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropped = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const src = ((y + minY) * width + minX) * 4;
    keyed.pixels.copy(cropped, y * cropW * 4, src, src + cropW * 4);
  }

  const shrink = Math.min(1, MAX_SIDE / Math.max(cropW, cropH));
  const outW = Math.round(cropW * shrink);
  const outH = Math.round(cropH * shrink);
  const pixels = shrink < 1 ? resize(cropped, cropW, cropH, outW, outH) : cropped;
  quantise(pixels);

  const png = new PNG({ width: outW, height: outH });
  pixels.copy(png.data);
  return { png, width: outW, height: outH, crop: { x: minX, y: minY, width: cropW, height: cropH } };
}

const LANDMARKS = [
  ['mouth', 'the centre of the blank skin area where the mouth should be, midway between the base of the nose and the chin'],
  ['noseBase', 'the base of the nose, where the nostrils are'],
  ['chin', 'the bottom of the chin, on the jaw outline'],
  ['leftEye', 'the centre of the pupil of the eye on the left hand side of the picture'],
  ['rightEye', 'the centre of the pupil of the eye on the right hand side of the picture'],
];

/**
 * Asks Gemini to point at the face landmarks. Uses the documented pointing
 * convention ([y, x] normalised to 0-1000) because accuracy drops off sharply
 * with made-up coordinate formats.
 */
async function locateLandmarks(rawJpeg) {
  const res = await ai.models.generateContent({
    model: MEASURE_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: rawJpeg.toString('base64') } },
          {
            text:
              'Point at these locations on the illustrated character. The character has no mouth drawn on purpose.\n' +
              LANDMARKS.map(([key, description]) => `- "${key}": ${description}`).join('\n') +
              '\nReturn one entry per label, with "point" as [y, x] normalised to 0-1000.',
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', enum: LANDMARKS.map(([key]) => key) },
            point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          },
          required: ['label', 'point'],
        },
      },
    },
  });

  const points = {};
  for (const entry of JSON.parse(res.text)) {
    const [y, x] = entry.point;
    points[entry.label] = { x: x / 1000, y: y / 1000 };
  }
  for (const [key] of LANDMARKS) {
    if (!points[key]) throw new Error(`landmark "${key}" was not located`);
  }
  return points;
}

const hex = (r, g, b) =>
  `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;

/** Average of an opaque patch, used to sample the flat fills out of the artwork. */
function samplePatch(png, nx, ny, radius) {
  const cx = Math.round(nx * png.width);
  const cy = Math.round(ny * png.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const p = (y * png.width + x) * 4;
      if (png.data[p + 3] < 250) continue;
      r += png.data[p];
      g += png.data[p + 1];
      b += png.data[p + 2];
      n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 240, g: 200, b: 180 };
}

/** Most common near-black colour: the outline ink the illustration was drawn with. */
function sampleInk(png) {
  const buckets = new Map();
  for (let p = 0; p < png.data.length; p += 4) {
    if (png.data[p + 3] < 250) continue;
    const [r, g, b] = [png.data[p], png.data[p + 1], png.data[p + 2]];
    if (0.299 * r + 0.587 * g + 0.114 * b > 70) continue;
    const key = `${r >> 3}:${g >> 3}:${b >> 3}`;
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n++;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.n > best.n) best = bucket;
  }
  if (!best) return '#1a1a1a';
  return hex(best.r / best.n, best.g / best.n, best.b / best.n);
}

/** Marks the measured anchors so a human can eyeball whether they landed right. */
function writeAnchorProof(id, source, anchors) {
  const png = new PNG({ width: source.width, height: source.height });
  source.data.copy(png.data);
  for (const [key, point] of Object.entries(anchors)) {
    const cx = Math.round(point.x * png.width);
    const cy = Math.round(point.y * png.height);
    const arm = key === 'mouth' ? 26 : 16;
    for (let d = -arm; d <= arm; d++) {
      for (const [x, y] of [
        [cx + d, cy],
        [cx, cy + d],
      ]) {
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        const p = (y * png.width + x) * 4;
        png.data[p] = 255;
        png.data[p + 1] = 0;
        png.data[p + 2] = 0;
        png.data[p + 3] = 255;
      }
    }
  }
  writeFileSync(`/tmp/cast-anchors-${id}.png`, PNG.sync.write(png));
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RENDER_DIR, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

for (const id of ids) {
  const rawFile = path.join(RENDER_DIR, `${id}.raw.jpg`);
  let raw;

  if (flag('measure-only')) {
    process.stdout.write(`${id}: reusing existing render… `);
    raw = readFileSync(rawFile);
  } else {
    process.stdout.write(`${id}: generating with ${MODEL}… `);
    raw = await generate(CHARACTERS[id]);
    writeFileSync(rawFile, raw);
  }

  const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });
  const { png, width, height, crop } = finish(cutOut(decoded), decoded.width, decoded.height);
  writeFileSync(path.join(OUT_DIR, `${id}.png`), PNG.sync.write(png));
  process.stdout.write(`cut out ${width}x${height}, `);

  const known = manifest[id]?.anchors;
  let anchors = known;

  if (!known || flag('measure') || flag('measure-only')) {
    process.stdout.write('measuring… ');
    // Landmarks come back in the uncropped frame, so shift them into the PNG's.
    const located = await locateLandmarks(raw);
    anchors = {};
    for (const [key, point] of Object.entries(located)) {
      anchors[key] = {
        x: (point.x * decoded.width - crop.x) / crop.width,
        y: (point.y * decoded.height - crop.y) / crop.height,
      };
    }
  } else {
    process.stdout.write('keeping committed anchors (--measure to redo them), ');
  }

  writeAnchorProof(id, png, anchors);

  // Skin is sampled from the mouth area itself, so the patch that hides any
  // stray lip line the model drew is an exact match.
  const skin = samplePatch(png, anchors.mouth.x, anchors.mouth.y, Math.round(width * 0.012));
  const ink = sampleInk(png);

  manifest[id] = {
    image: `/cast/${id}.png`,
    width,
    height,
    anchors,
    palette: {
      skin: hex(skin.r, skin.g, skin.b),
      skinShadow: hex(skin.r * 0.87, skin.g * 0.83, skin.b * 0.83),
      ink,
      mouth: hex(skin.r * 0.3, skin.g * 0.17, skin.b * 0.2),
      tongue: hex(skin.r * 0.8, skin.g * 0.5, skin.b * 0.5),
      teeth: '#fffaf4',
    },
  };

  console.log(`done (check the anchors: /tmp/cast-anchors-${id}.png)`);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), MANIFEST)}`);
