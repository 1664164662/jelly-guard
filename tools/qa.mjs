#!/usr/bin/env node
/**
 * 构建产物验收：尺寸、gzip、外部引用、关键能力、文件一致性。
 * 用法：npm run qa
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadVariants } from './gen-variants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition), detail });
}

async function main() {
  const variants = await loadVariants();
  const playablePath = path.join(DIST, 'play', 'index.html');
  const landingPath = path.join(DIST, 'index.html');
  const reportPath = path.join(DIST, 'build-report.json');

  let playable = '';
  let landing = '';
  let report = null;
  try { playable = await fs.readFile(playablePath, 'utf8'); } catch (_) { /* handled below */ }
  try { landing = await fs.readFile(landingPath, 'utf8'); } catch (_) { /* handled below */ }
  try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); } catch (_) { /* handled below */ }

  check('dist/play/index.html 存在', playable.length > 0);
  check('dist/index.html 存在', landing.length > 0);
  check('build-report.json 可解析', Boolean(report));

  if (playable) {
    const raw = Buffer.from(playable, 'utf8');
    const gzip = zlib.gzipSync(raw, { level: 9 });
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    check('单文件 ≤ 150 KB', raw.length <= 150 * 1024, `${(raw.length / 1024).toFixed(1)} KB`);
    check('gzip ≤ 50 KB', gzip.length <= 50 * 1024, `${(gzip.length / 1024).toFixed(1)} KB`);
    check('无外部 script/link/img 引用', !/<script[^>]+src=["']https?:/i.test(playable)
      && !/<link[^>]+href=["']https?:/i.test(playable)
      && !/<img[^>]+src=["']https?:/i.test(playable));
    check('已内联构建版本', /window\.JELLY_BUILD\s*=/.test(playable));
    check('已内联全部变体', variants.every((variant) => playable.includes(`"${variant.id}"`)));
    check('包含广告下载桥', /mraid/.test(playable) && /ExitApi/.test(playable) && /playableSDK/.test(playable));
    check('包含触控与生命周期处理', /pointerdown/.test(playable) && /visibilitychange/.test(playable));
    check('不再引用 src/ 外链', !/\.\.\/src\//.test(playable));
    check('SHA-256 与报告一致', report?.playable?.sha256 === hash);
    check('gzip 与报告一致', report?.playable?.gzipBytes === gzip.length);
    check('尺寸预算标记为 PASS', report?.checks?.underRawBudget === true && report?.checks?.underGzipBudget === true);
    check('外部资源检查为 0', report?.checks?.externalResourceRefs === 0);
  }

  if (landing) {
    check('落地页包含 iframe 试玩', /id="game-frame"/.test(landing) && /play\/\?variant=/.test(landing));
    check('落地页包含变体切换', /data-variant="mint"/.test(landing) && /data-variant="sunset"/.test(landing));
    check('落地页无未解析模板占位', !/\{\{[^}]+\}\}/.test(landing));
  }

  const failures = results.filter((result) => !result.pass);
  results.forEach((result) => {
    console.log(`${result.pass ? '✓' : '✗'} ${result.name}${result.detail ? `  ${result.detail}` : ''}`);
  });
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ QA failed: ${error.message}`);
  process.exitCode = 1;
});
