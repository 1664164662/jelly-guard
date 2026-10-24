#!/usr/bin/env node
/**
 * 5 项 Chrome CDP 冒烟测试：
 *   1. 开始试玩 + 初始炮台
 *   2. 鼠标 / Pointer 拖拽合成
 *   3. 糖爆消耗与事件
 *   4. 失败 → 重开 → 胜利结算
 *   5. CTA 下载桥与埋点
 *
 * 零第三方依赖；自动启动本地 server 和 headless Chrome。
 * 用法：npm test
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPage, closePage } from '../tools/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PORT_START = 4183 + Math.floor(Math.random() * 30);
let SERVER_PORT = SERVER_PORT_START;
const CDP_PORT = 9360 + Math.floor(Math.random() * 30);
const PROFILE = path.join(os.tmpdir(), `jelly-smoke-${process.pid}-${Date.now()}`);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

let server = null;
let chrome = null;
let client = null;
let target = null;
let passed = 0;

function log(message) { console.log(message); }
function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

async function waitForHttp(url, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`等待超时：${url}`);
}

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_) { /* next */ }
  }
  throw new Error('找不到 Chrome/Edge。请设置 CHROME_PATH 环境变量。');
}

async function startServer() {
  // A random port can collide with another local tool. Try three neighbours
  // before failing, so the test is not flaky on a busy developer machine.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = SERVER_PORT_START + attempt;
    server = spawn(process.execPath, [
      path.join(ROOT, 'tools', 'serve.mjs'),
      '--port', String(port),
    ], {
      cwd: ROOT,
      stdio: 'ignore',
      windowsHide: true,
    });
    try {
      await waitForHttp(`http://127.0.0.1:${port}/play/?quality=high`, 5000);
      SERVER_PORT = port;
      return;
    } catch (_) {
      try { server.kill(); } catch (_) { /* ignore */ }
      server = null;
    }
  }
  throw new Error(`无法启动本地 preview server（尝试端口 ${SERVER_PORT_START}-${SERVER_PORT_START + 2}）`);
}

async function startChrome() {
  const executable = await findChrome();
  await fs.mkdir(PROFILE, { recursive: true });
  chrome = spawn(executable, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--window-size=390,844',
    '--force-device-scale-factor=2',
    'about:blank',
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20000);
}

async function stopChrome() {
  if (!chrome) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      chrome.kill('SIGKILL');
    }
  } catch (_) { /* already gone */ }
  chrome = null;
}

async function step(name, fn) {
  await fn();
  passed += 1;
  log(`✓ [${passed}/5] ${name}`);
}

async function run() {
  await startServer();
  log(`· preview http://127.0.0.1:${SERVER_PORT}/play/`);
  await startChrome();
  log(`· chrome cdp :${CDP_PORT}`);

  const page = await createPage(CDP_PORT, 'about:blank');
  client = page.client;
  target = page.target;
  const consoleErrors = [];
  client.on('Runtime.exceptionThrown', (params) => {
    consoleErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'exception');
  });
  client.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleErrors.push(params.entry.text || 'console error');
  });
  await client.setViewport(390, 844, 2, true);
  await client.navigate(`http://127.0.0.1:${SERVER_PORT}/play/?variant=mint&quality=high&debug=1&seed=11`);
  await client.waitFor('window.__JELLY_READY__ === true', 10000);

  await step('开始试玩 + 初始 5 座炮台', async () => {
    const before = await client.evaluate('window.__JELLY__.snapshot()');
    assert(before.phase === 'start', '初始状态应为 start');
    const rect = await client.evaluate(`(() => {
      const r = document.querySelector('#btn-start').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    await client.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
    const state = await client.waitFor(`(() => {
      const s = window.__JELLY__.snapshot();
      return s.phase === 'playing' && s.turrets.length === 5 ? s : null;
    })()`, 4000);
    assert(state.turrets.length === 5, '开局应有 5 座炮台');
    assert(state.hp === 4, '开局应有 4 点生命');
    assert(await client.evaluate('document.querySelector("#screen-start").classList.contains("is-hidden")'), '开始页应隐藏');
  });

  await step('拖拽同色炮台完成合成', async () => {
    await client.drag(55, 552, 195, 552, 10);
    const state = await client.waitFor(`(() => {
      const s = window.__JELLY__.snapshot();
      return s.merges >= 1 ? s : null;
    })()`, 3000);
    assert(state.score > 0, '合成后分数应增加');
    const events = await client.evaluate('window.__JELLY_EVENTS__.map(e => e.name)');
    assert(events.includes('merge'), '应上报 merge 事件');
    assert(events.includes('tutorial_complete'), '应上报 tutorial_complete 事件');
  });

  await step('糖爆清场与事件上报', async () => {
    await client.evaluate('window.__JELLY__.setTime(12)');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await client.evaluate('window.__JELLY__.addSugar(100)');
    const ready = await client.evaluate('window.__JELLY__.snapshot().sugarReady');
    assert(ready, '糖爆应处于就绪状态');
    await client.evaluate('window.__JELLY__.burst()');
    const state = await client.evaluate('window.__JELLY__.snapshot()');
    assert(state.sugar < 100, '释放后糖爆能量应清空');
    const burst = await client.evaluate('window.__JELLY_EVENTS__.filter(e => e.name === "sugar_burst").pop()');
    assert(burst && burst.targets > 0, '糖爆应命中敌人并上报 targets');
  });

  await step('失败 → 重开 → 胜利结算', async () => {
    await client.evaluate('window.__JELLY__.lose()');
    await client.waitFor('!document.querySelector("#screen-end").classList.contains("is-hidden")', 3000);
    assert(await client.evaluate('window.__JELLY__.snapshot().phase === "lose"'), '应进入 lose 状态');
    await client.evaluate('document.querySelector("#btn-retry").click()');
    const restarted = await client.waitFor(`(() => {
      const s = window.__JELLY__.snapshot();
      return s.phase === 'playing' ? s : null;
    })()`, 3000);
    assert(restarted.hp === 4 && restarted.merges === 0, '重开后状态应重置');
    await client.evaluate('window.__JELLY__.win()');
    await client.waitFor('!document.querySelector("#screen-end").classList.contains("is-hidden")', 3000);
    const finalState = await client.evaluate('window.__JELLY__.snapshot()');
    assert(finalState.phase === 'win', '应进入 win 状态');
    const title = await client.evaluate('document.querySelector("#end-title").textContent');
    assert(title.length > 0, '结算页应显示结果标题');
    assert(await client.evaluate('document.querySelector("#end-score").textContent.length > 0'), '结算页应显示分数');
  });

  await step('CTA 下载桥 + store_open 埋点', async () => {
    await client.evaluate('window.mraid = { open: (url) => { window.__opened = url; } }');
    const urlBefore = await client.evaluate('location.href');
    await client.evaluate('document.querySelector("#btn-cta").click()');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const opened = await client.evaluate('window.__opened');
    assert(typeof opened === 'string' && opened.includes('example.com'), '应调用 mraid.open');
    const events = await client.evaluate('window.__JELLY_EVENTS__');
    const cta = events.filter((event) => event.name === 'cta_click').pop();
    const store = events.filter((event) => event.name === 'store_open').pop();
    assert(cta, '应上报 cta_click');
    assert(store && store.bridge === 'mraid', '应上报 store_open / mraid');
    assert(await client.evaluate('location.href') === urlBefore, 'CTA 不应导致当前页跳转');
    const toast = await client.evaluate('getComputedStyle(document.querySelector("#toast")).opacity');
    assert(Number(toast) > 0, '应显示下载桥 toast');
  });

  assert(consoleErrors.length === 0, `控制台报错：\n${consoleErrors.join('\n')}`);
  log('\n5/5 smoke checks passed · console clean');
}

async function cleanup() {
  if (client) { try { client.close(); } catch (_) { /* ignore */ } }
  if (target) { try { await closePage(CDP_PORT, target.id); } catch (_) { /* ignore */ } }
  await stopChrome();
  if (server) { try { server.kill(); } catch (_) { /* ignore */ } }
  await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}

run()
  .catch(async (error) => {
    console.error(`\n✗ smoke failed (${passed}/5): ${error.message}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
