// Headless screenshot helper for visual verification (adapted from Ballistic Armour Lab).
// usage: node scripts/shot.mjs <out.png> <script.js|-> [width] [height] [url]
// The script file body runs in the page as: async (app, sleep) => { ... }
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [, , out = 'shots/shot.png', scriptPath = '-', w = '1600', h = '900', url = 'http://localhost:5330/'] = process.argv;
const chromePaths = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = chromePaths.find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${w},${h}`],
  defaultViewport: { width: parseInt(w), height: parseInt(h) },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.__iron, { timeout: 30000 });
let shotN = 0;
await page.exposeFunction('__shot', async (name) => {
  const file = path.join(path.dirname(out), `${path.basename(out, '.png')}_${name ?? shotN++}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  return file;
});
let body = '';
if (scriptPath !== '-') body = fs.readFileSync(scriptPath, 'utf8');
const result = await page.evaluate(async (src) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fn = new Function('app', 'sleep', `return (async () => { ${src} })();`);
  try {
    const r = await fn(window.__iron, sleep);
    return r === undefined ? null : JSON.stringify(r, null, 1);
  } catch (e) {
    return 'ERROR: ' + e.message + '\n' + e.stack;
  }
}, body);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
if (result) console.log('RESULT:', result);
if (logs.length) console.log(logs.slice(-40).join('\n'));
console.log('saved', out);
