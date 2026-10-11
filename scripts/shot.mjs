/**
 * Screenshots the running app so visual changes can be checked without a
 * manual round trip. Requires the dev server to be running.
 *
 *   npm run shot                        # whole stage -> /tmp/table-read.png
 *   npm run shot -- --faces             # one close-up per performer
 *   npm run shot -- --play              # click Play first, then shoot
 *   npm run shot -- --play --burst 6    # 6 frames, for checking animation
 *   npm run shot -- --direction thriller  # re-read the scene, then shoot
 *   npm run shot -- --out ./look.png --wait 8000
 *
 * Env:
 *   SHOT_URL     page to open (default http://localhost:3100/)
 *   CHROME_PATH  browser binary, if not in a standard location
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const URL = process.env.SHOT_URL || 'http://localhost:3100/';
const OUT = opt('out', '/tmp/table-read.png');
const WAIT = Number(opt('wait', 6000));
const PLAY_WAIT = Number(opt('play-wait', 45000));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH to your browser binary.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: 'shell',
  args: [
    // SwiftShader so WebGL works in headless.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--hide-scrollbars',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({
    width: Number(opt('width', 1400)),
    height: Number(opt('height', 1100)),
    deviceScaleFactor: Number(opt('scale', flag('faces') ? 3 : 2)),
  });

  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, WAIT));

  // Opens a panel before shooting, e.g. --click '#btn-upload-script'.
  const click = opt('click', '');
  if (click) {
    await page.click(click);
    await new Promise((r) => setTimeout(r, 1200));
  }

  if (flag('play')) {
    await page.click('#btn-play-pause-stage');
    // Synthesis of a whole scene takes a while before audio starts.
    await new Promise((r) => setTimeout(r, PLAY_WAIT));
  }

  // Jump the transport to a given line from the script, to catch a specific
  // performer talking instead of waiting out the scene.
  const turn = Number(opt('turn', 0));
  if (turn > 0) {
    await page.click(`#script-pane button[title="Play from line ${turn}"]`);
    await new Promise((r) => setTimeout(r, Number(opt('turn-wait', 2500))));
  }

  // Re-read the same scene under a different direction, e.g. --direction
  // thriller. Voicing the line under the playhead has to finish first.
  const dir = opt('direction', '');
  if (dir) {
    await page.click(`#btn-direction-${dir}`);
    await new Promise((r) => setTimeout(r, Number(opt('direction-wait', 30000))));
  }

  const burst = Number(opt('burst', 0));
  const burstGap = Number(opt('burst-gap', 300));

  const shoot = async (suffix) => {
    if (flag('faces')) {
      const canvases = await page.$$('#stage canvas');
      for (let i = 0; i < canvases.length; i++) {
        const path = OUT.replace(/(\.png)?$/, `${suffix}-face${i}.png`);
        await canvases[i].screenshot({ path });
        console.log(`saved ${path}`);
      }
    } else {
      const path = suffix ? OUT.replace(/(\.png)?$/, `${suffix}.png`) : OUT;
      // Default to just the stage, which is what usually changes; --page for the
      // whole layout, including the masthead and nav.
      const stage = flag('page') ? null : await page.$('#stage');
      await (stage || page).screenshot({ path, fullPage: flag('page') });
      console.log(`saved ${path}`);
    }
  };

  if (burst > 0) {
    for (let i = 0; i < burst; i++) {
      await shoot(`-${i}`);
      if (i < burst - 1) await new Promise((r) => setTimeout(r, burstGap));
    }
  } else {
    await shoot('');
  }

  if (problems.length) console.log('page problems:\n' + problems.join('\n'));
} finally {
  await browser.close();
}
