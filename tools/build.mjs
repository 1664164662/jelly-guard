#!/usr/bin/env node
/**
 * 单文件试玩构建 + 作品集静态站点输出。
 *
 * 产出：
 *   dist/play/index.html              可直接投放的单文件试玩
 *   dist/jelly-guard-playable.html    同一文件的可分享副本
 *   dist/index.html                   作品集落地页
 *   dist/src/*.css|js                 落地页静态资源
 *   dist/build-report.json            尺寸 / gzip / hash / 检查项
 *
 * 零第三方依赖。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadVariants } from './gen-variants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PLAY_TEMPLATE = path.join(ROOT, 'play', 'index.html');
const LANDING_TEMPLATE = path.join(ROOT, 'index.html');
const CSS_FILE = path.join(ROOT, 'src', 'game.css');
const VARIANTS_FILE = path.join(ROOT, 'src', 'generated-variants.js');
const GAME_FILE = path.join(ROOT, 'src', 'game.js');
const LANDING_CSS = path.join(ROOT, 'src', 'landing.css');
const LANDING_JS = path.join(ROOT, 'src', 'landing.js');

const RAW_BUDGET = 150 * 1024;
const GZIP_BUDGET = 50 * 1024;
const VERSION = '1.0.0';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length;
}

function replaceOnce(haystack, needle, replacement) {
  if (!haystack.includes(needle)) throw new Error(`构建模板缺少占位：${needle}`);
  return haystack.replace(needle, () => replacement);
}

async function read(file) {
  return fs.readFile(file, 'utf8');
}

async function copyIfExists(source, destination) {
  try {
    await fs.access(source);
    await fs.cp(source, destination, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function buildPlayable() {
  const [template, css, variantsJs, gameJs] = await Promise.all([
    read(PLAY_TEMPLATE), read(CSS_FILE), read(VARIANTS_FILE), read(GAME_FILE),
  ]);
  const sourceHash = sha256(`${css}\n${variantsJs}\n${gameJs}`).slice(0, 8);
  const buildLabel = `v${VERSION}+${sourceHash}`;

  let html = template;
  html = replaceOnce(html, '<link rel="stylesheet" href="../src/game.css">', `<style>\n${css}\n</style>`);
  html = replaceOnce(
    html,
    '<script src="../src/generated-variants.js"></script>',
    `<script>\nwindow.JELLY_BUILD = ${JSON.stringify(buildLabel)};\n${variantsJs}</script>`,
  );
  html = replaceOnce(html, '<script src="../src/game.js"></script>', `<script>\n${gameJs}\n</script>`);
  html = html.replace('</head>', `  <!-- Built ${buildLabel} · single-file playable · no external requests -->\n</head>`);

  const raw = Buffer.from(html, 'utf8');
  const gzip = gzipSize(raw);
  const hash = sha256(raw);

  const externalRefs = [
    /<script[^>]+src=["']https?:/i,
    /<link[^>]+href=["']https?:/i,
    /<img[^>]+src=["']https?:/i,
    /@import\s+url\(["']?https?:/i,
  ].filter((pattern) => pattern.test(html)).length;

  return {
    html: raw,
    meta: {
      build: buildLabel,
      rawBytes: raw.length,
      gzipBytes: gzip,
      sha256: hash,
      sourceHash,
      externalResourceRefs: externalRefs,
      underRawBudget: raw.length <= RAW_BUDGET,
      underGzipBudget: gzip <= GZIP_BUDGET,
    },
  };
}

async function main() {
  const variants = await loadVariants();
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, 'play'), { recursive: true });
  await fs.mkdir(path.join(DIST, 'src'), { recursive: true });

  const { html, meta } = await buildPlayable();
  await fs.writeFile(path.join(DIST, 'play', 'index.html'), html);
  await fs.writeFile(path.join(DIST, 'jelly-guard-playable.html'), html);

  const landing = await read(LANDING_TEMPLATE);
  await fs.writeFile(path.join(DIST, 'index.html'), landing);
  await fs.copyFile(LANDING_CSS, path.join(DIST, 'src', 'landing.css'));
  await fs.copyFile(LANDING_JS, path.join(DIST, 'src', 'landing.js'));

  // The built site can fetch its own report to display real sizes.
  const report = {
    project: 'jelly-guard',
    title: '果冻防线 · 30s H5 playable ad',
    version: VERSION,
    builtAt: new Date().toISOString(),
    playable: {
      file: 'play/index.html',
      shareFile: 'jelly-guard-playable.html',
      build: meta.build,
      rawBytes: meta.rawBytes,
      gzipBytes: meta.gzipBytes,
      sha256: meta.sha256,
      sourceHash: meta.sourceHash,
    },
    budgets: {
      rawBytes: RAW_BUDGET,
      gzipBytes: GZIP_BUDGET,
    },
    checks: {
      singleFile: true,
      externalResourceRefs: meta.externalResourceRefs,
      underRawBudget: meta.underRawBudget,
      underGzipBudget: meta.underGzipBudget,
      variantCount: variants.length,
    },
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      source: variant.source,
      accent: variant.theme.accent,
    })),
  };

  await fs.writeFile(path.join(DIST, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(ROOT, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  await fs.writeFile(path.join(DIST, 'README.md'), `# 果冻防线 · 单文件试玩

- 构建：${meta.build}
- 单文件 raw：${(meta.rawBytes / 1024).toFixed(1)} KB
- 单文件 gzip：${(meta.gzipBytes / 1024).toFixed(1)} KB
- SHA-256：\`${meta.sha256}\`
- 外部资源引用：${meta.externalResourceRefs}

## 本地预览

\`\`\`bash
node tools/serve.mjs --port 4173
# http://127.0.0.1:4173/
\`\`\`

\`dist/play/index.html\` 是完整试玩；\`dist/index.html\` 是作品集页。
试玩支持 query 参数：\`?variant=mint|berry|sunset\`、\`?debug=1\`、\`?seed=7\`。
`);

  await copyIfExists(path.join(ROOT, 'docs'), path.join(DIST, 'docs'));
  await copyIfExists(path.join(ROOT, 'README.md'), path.join(DIST, 'PROJECT.md'));
  await copyIfExists(path.join(ROOT, 'assets', 'showcase'), path.join(DIST, 'assets', 'showcase'));

  const warnings = [];
  if (!meta.underRawBudget) warnings.push(`raw ${(meta.rawBytes / 1024).toFixed(1)} KB > ${RAW_BUDGET / 1024} KB`);
  if (!meta.underGzipBudget) warnings.push(`gzip ${(meta.gzipBytes / 1024).toFixed(1)} KB > ${GZIP_BUDGET / 1024} KB`);
  if (meta.externalResourceRefs !== 0) warnings.push(`${meta.externalResourceRefs} external resource refs`);

  console.log(`✓ ${path.relative(ROOT, path.join(DIST, 'play', 'index.html'))}`);
  console.log(`  raw  ${(meta.rawBytes / 1024).toFixed(1)} KB`);
  console.log(`  gzip ${(meta.gzipBytes / 1024).toFixed(1)} KB`);
  console.log(`  sha  ${meta.sha256.slice(0, 16)}…`);
  console.log(`  build ${meta.build}`);
  console.log(`✓ ${path.relative(ROOT, path.join(DIST, 'index.html'))} + dist/src/*`);
  console.log(`✓ variants: ${variants.map((variant) => variant.id).join(', ')}`);
  if (warnings.length) {
    console.warn('! budget warnings:');
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
    process.exitCode = 1;
  } else {
    console.log('✓ budget + external requests: PASS');
  }
}

main().catch((error) => {
  console.error(`✗ build failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
