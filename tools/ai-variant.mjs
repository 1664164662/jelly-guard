#!/usr/bin/env node
/**
 * AI 变体生成器
 *
 * 用法：
 *   node tools/ai-variant.mjs --brief "夏日柠檬气泡" --id lemon
 *   node tools/ai-variant.mjs --brief "..." --id lemon --offline --force
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY / OPENAI_API_KEY
 *   AI_BASE_URL（默认 https://api.deepseek.com）
 *   AI_MODEL（默认 deepseek-chat）
 *
 * 设计原则：LLM 只产出主题/文案/难度参数；代码负责 schema 校验、回退和构建。
 * 无论 API 是否可用，最终写出的文件都经过同一套 validateVariant。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVariant, generate } from './gen-variants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARIANTS_DIR = path.join(ROOT, 'variants');
const RUNS_DIR = path.join(ROOT, 'ai', 'runs');
const PROMPT_FILE = path.join(ROOT, 'ai', 'prompts', '02-variant.md');

function parseArgs(argv) {
  const args = { brief: '', id: 'lemon', offline: false, force: false, dry: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--brief') args.brief = argv[++index] || '';
    else if (arg === '--id') args.id = argv[++index] || '';
    else if (arg === '--offline') args.offline = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--dry') args.dry = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`AI variant generator

  node tools/ai-variant.mjs --brief "夏日柠檬气泡" --id lemon
  node tools/ai-variant.mjs --brief "..." --id lemon --offline --force

Options:
  --brief <text>  创意 brief（默认：夏日柠檬气泡，清爽、轻快）
  --id <slug>     变体 id，小写 kebab-case（默认：lemon）
  --offline       跳过 API，使用本地 fallback recipe（仍会校验并留档）
  --force         覆盖已存在的 variants/<id>.json
  --dry           只生成和校验，不写文件

Env:
  DEEPSEEK_API_KEY / OPENAI_API_KEY
  AI_BASE_URL      默认 https://api.deepseek.com
  AI_MODEL         默认 deepseek-chat
`);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'variant';
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Deterministic local recipes. They are not "AI output" — they are the safety net
// that keeps the build green when the API is unavailable.
const RECIPES = {
  sunset: {
    label: '日落汽水',
    theme: {
      bg0: '#160b12', bg1: '#2c1220', bg2: '#4b2417',
      accent: '#ffc857', accent2: '#ff7a59',
      enemy: '#7bddff', enemy2: '#c2a1ff',
      text: '#fff8ec', muted: '#bea18e',
      panel: '#220e13', panel2: '#3a1a1a',
    },
    tagline: '落日之前，合成最后一道防线。',
    winTitle: '守到日落！',
    loseTitle: '太阳落山了',
  },
  lemon: {
    label: '柠檬气泡',
    theme: {
      bg0: '#0c1008', bg1: '#1d2410', bg2: '#3a3213',
      accent: '#e8ff6a', accent2: '#ffc857',
      enemy: '#ff7a9a', enemy2: '#8fe3ff',
      text: '#fbffe8', muted: '#a9b081',
      panel: '#14180c', panel2: '#242b11',
    },
    tagline: '把气泡合到满级，守住这一口夏天。',
    winTitle: '清爽守住！',
    loseTitle: '气泡漏光了',
  },
  ocean: {
    label: '深海气泡',
    theme: {
      bg0: '#041018', bg1: '#08263a', bg2: '#0b3550',
      accent: '#5ee7ff', accent2: '#8affc1',
      enemy: '#ff8d7a', enemy2: '#c2a1ff',
      text: '#effdff', muted: '#8ba8b5',
      panel: '#071923', panel2: '#0c2b3a',
    },
    tagline: '潜到最深处，合成你的防线。',
    winTitle: '深海守住！',
    loseTitle: '氧气不够了',
  },
};

function recipeFor(id, brief) {
  const known = RECIPES[id];
  if (known) {
    return {
      id,
      label: known.label,
      source: 'ai-assisted',
      theme: known.theme,
      copy: {
        title: '果冻防线',
        tagline: known.tagline,
        startCta: '开始防守',
        hint: '拖动同色炮台 → 合成升级',
        winTitle: known.winTitle,
        loseTitle: known.loseTitle,
        cta: '免费下载',
        sub: '30 秒 · 单手 · 即点即玩',
      },
      balance: { duration: 30, baseHp: 4, bossAt: 23, sugarMax: 100 },
    };
  }

  const hash = hashString(`${id}:${brief}`);
  const palettes = [
    { accent: '#8affd1', accent2: '#ffd166', enemy: '#ff7a9a', enemy2: '#b79aff', bgs: ['#07110f', '#0f211c', '#18352c'] },
    { accent: '#ffb3d1', accent2: '#ffe29a', enemy: '#6fe9c3', enemy2: '#8ab8ff', bgs: ['#140811', '#26101f', '#3d1a30'] },
    { accent: '#a8c7ff', accent2: '#ffd166', enemy: '#ff937a', enemy2: '#d39aff', bgs: ['#0a0d18', '#141a2e', '#212b48'] },
  ];
  const palette = palettes[hash % palettes.length];
  const [bg0, bg1, bg2] = palette.bgs;
  const shortBrief = brief.replace(/[，。,.!！\s]/g, '').slice(0, 10) || '糖果';
  return {
    id,
    label: `${id.replace(/-/g, ' ').slice(0, 10)} 实验`,
    source: 'ai-assisted',
    theme: {
      bg0,
      bg1,
      bg2,
      accent: palette.accent,
      accent2: palette.accent2,
      enemy: palette.enemy,
      enemy2: palette.enemy2,
      text: '#f7fff9',
      muted: '#96a0a4',
      panel: bg0,
      panel2: bg1,
    },
    copy: {
      title: '果冻防线',
      tagline: `合成同色炮台，守住${shortBrief}。`,
      startCta: '开始防守',
      hint: '拖动同色炮台 → 合成升级',
      winTitle: '防线守住！',
      loseTitle: '就差一点点',
      cta: '免费下载',
      sub: '30 秒 · 单手 · 即点即玩',
    },
    balance: { duration: 30, baseHp: 4, bossAt: 23, sugarMax: 100 },
  };
}

function buildPrompt(systemPrompt, brief) {
  return `${systemPrompt.trim()}

---

## Brief

${brief}

## 额外要求

- id 固定为 "{{id}}"。
- 只返回 JSON。
- 不要输出代码块标记。`;
}

async function callModel({ prompt, id, apiKey }) {
  const base = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const body = {
    model: process.env.AI_MODEL || 'deepseek-chat',
    temperature: 0.9,
    max_tokens: 1400,
    messages: [
      { role: 'system', content: prompt.replace('{{id}}', id) },
      { role: 'user', content: `请为这个 brief 生成变体，id = ${id}。` },
    ],
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${response.status}: ${text.slice(0, 240)}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API returned no content');
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return { raw: JSON.parse(cleaned), meta: { model: body.model, url } };
  } finally {
    clearTimeout(timeout);
  }
}

function normalize(raw, id) {
  const candidate = {
    ...raw,
    id,
    source: 'ai-assisted',
  };
  return validateVariant(candidate);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const brief = args.brief.trim() || '夏日柠檬气泡，清爽、轻快，适合信息流冷启动';
  const id = slugify(args.id || 'lemon');
  const file = path.join(VARIANTS_DIR, `${id}.json`);

  if (!args.force && !args.dry) {
    try {
      await fs.access(file);
      throw new Error(`variants/${id}.json 已存在。加 --force 覆盖，或换一个 --id。`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const systemPrompt = await fs.readFile(PROMPT_FILE, 'utf8');
  const prompt = buildPrompt(systemPrompt, brief);
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
  const mode = args.offline || !apiKey ? 'offline-fallback' : 'live-api';

  let raw = null;
  let normalized = null;
  let errorMessage = '';
  let meta = {};

  if (mode === 'live-api') {
    try {
      console.log(`→ 调用 ${process.env.AI_MODEL || 'deepseek-chat'} …`);
      const result = await callModel({ prompt, id, apiKey });
      raw = result.raw;
      meta = result.meta;
      normalized = normalize(raw, id);
      console.log('✓ 模型输出通过 schema 校验');
    } catch (error) {
      errorMessage = error.message;
      console.warn(`! API 失败，切换到本地 fallback：${error.message}`);
    }
  }

  if (!normalized) {
    raw = recipeFor(id, brief);
    normalized = normalize(raw, id);
    console.log('✓ 本地 fallback 通过 schema 校验');
  }

  await fs.mkdir(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runFile = path.join(RUNS_DIR, `${stamp}-${id}.json`);
  await fs.writeFile(runFile, `${JSON.stringify({
    id,
    brief,
    mode,
    error: errorMessage || null,
    meta,
    prompt,
    raw,
    normalized,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  if (!args.dry) {
    await fs.mkdir(VARIANTS_DIR, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await generate({ quiet: true });
    console.log(`✓ 写入 variants/${id}.json`);
    console.log(`✓ 已刷新 src/generated-variants.js`);
  } else {
    console.log('• dry run：未写入文件');
  }
  console.log(`✓ 运行记录 ${path.relative(ROOT, runFile)}`);
  console.log(`  ${normalized.label} / accent ${normalized.theme.accent} / tagline ${normalized.copy.tagline}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
