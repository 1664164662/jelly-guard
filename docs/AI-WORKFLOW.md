# AI 变体工作流

> 目标：让 LLM 参与“试玩广告的变体生产”，但不让不可控输出进入投放素材。

## 1. 设计原则

1. **模型只做候选**：主题、文案、难度参数；
2. **代码做约束**：schema、颜色格式、字数、数值范围、回退；
3. **人做判断**：可读性、情绪、是否值得 A/B；
4. **每次生成可追溯**：prompt、raw、normalized、错误都留档；
5. **构建永不因 AI 失败而中断**：本地 fallback recipe 兜底。

## 2. 流水线

```text
brief
  │
  ▼
ai/prompts/02-variant.md  ──▶  LLM (DeepSeek / OpenAI-compatible)
  │                                  │
  │                                  ▼
  │                            JSON 候选
  │                                  │
  ▼                                  ▼
tools/ai-variant.mjs  ──▶  validateVariant()
  │                          │        │
  │                       pass       fail
  │                          │        │
  │                          ▼        ▼
  │                    variants/  local recipe
  │                          │        │
  └──────────────────────────┴────────┘
                             │
                             ▼
                  src/generated-variants.js
                             │
                             ▼
                     tools/build.mjs
                             │
                             ▼
                dist/play/index.html (single file)
```

## 3. 变体 schema

完整 schema 在 `ai/prompts/02-variant.md`。核心字段：

```json
{
  "id": "sunset",
  "label": "日落汽水",
  "source": "ai-assisted",
  "theme": {
    "bg0": "#160b12",
    "bg1": "#2c1220",
    "bg2": "#4b2417",
    "accent": "#ffc857",
    "accent2": "#ff7a59",
    "enemy": "#7bddff",
    "enemy2": "#c2a1ff",
    "text": "#fff8ec",
    "muted": "#bea18e",
    "panel": "#220e13",
    "panel2": "#3a1a1a"
  },
  "copy": {
    "title": "果冻防线",
    "tagline": "落日之前，合成最后一道防线。",
    "startCta": "守住日落",
    "hint": "拖动同色炮台 → 合成升级",
    "winTitle": "守到日落！",
    "loseTitle": "太阳落山了",
    "cta": "免费下载",
    "sub": "30 秒 · 单手 · 即点即玩"
  },
  "balance": {
    "duration": 30,
    "baseHp": 4,
    "bossAt": 23,
    "sugarMax": 100
  }
}
```

## 4. 校验规则（代码强制）

`tools/gen-variants.mjs` 会检查：

- `id` 必须是 `[a-z][a-z0-9-]{1,23}`；
- 11 个主题色必须是 6 位 hex；
- `label` 2–20 字；
- `tagline` 4–32 字，`hint` 4–24 字，`title` 2–8 字；
- `duration` 20–45；
- `baseHp` 2–5；
- `bossAt` 必须大于 10 且小于 `duration`；
- `sugarMax` 60–200；
- 变体 id 不能重复。

校验失败不会写坏配置；AI 模式下会自动走本地 fallback。

## 5. 两种运行模式

### Live API

```bash
export DEEPSEEK_API_KEY=sk-...
npm run ai:variant -- --brief "夏日柠檬气泡，清爽、轻快" --id lemon
```

默认：

- endpoint：`https://api.deepseek.com/chat/completions`
- model：`deepseek-chat`
- 可通过 `AI_BASE_URL`、`AI_MODEL` 覆盖；
- 要求 `response_format: { type: "json_object" }`；
- 超时 30 秒；失败自动 fallback。

### Offline fallback

```bash
npm run ai:variant -- --brief "夏日落日、橘子汽水" --id sunset --offline --force
```

没有 API key 时也会自动走这个模式。

**重要说明**：仓库中的 `sunset` 变体是用离线 fallback 生成的，运行记录在 `ai/runs/`。它证明的是“流水线可运行、schema 可校验”，不是“这个配色由大模型想出”。接上 API 后，同一命令会走真实模型。

## 6. 运行记录

每次运行写入 `ai/runs/<timestamp>-<id>.json`：

```json
{
  "id": "sunset",
  "brief": "夏日落日、橘子汽水，暖色、轻快，适合信息流冷启动",
  "mode": "offline-fallback",
  "error": null,
  "meta": {},
  "prompt": "...",
  "raw": { "...": "..." },
  "normalized": { "...": "..." },
  "generatedAt": "2026-10-24T05:45:38.294Z"
}
```

这样面试时可以打开任意一次生成，回答：

- 当时给模型什么约束？
- 模型返回了什么？
- 哪些字段被代码改写了？
- 失败时怎么回退？

## 7. Prompt 库

| 文件 | 用途 |
| --- | --- |
| `ai/prompts/01-concept.md` | 从品类 / 人群发散 10 个 Hook，筛选 3 个 |
| `ai/prompts/02-variant.md` | 约束 LLM 输出主题 / 文案 / 难度 JSON |
| `ai/prompts/03-qa.md` | 生成 P0/P1/P2 QA 清单，人工再跑 |
| `ai/prompts/04-copy.md` | 为同一玩法生成不同语气的短文案 |

## 8. 如何扩展到“一键生成 20 个变体”

当前是一个一个生成。要批量化，可以加：

```text
briefs.csv
  → for each brief: ai-variant --id <slug>
  → gen-variants
  → build (one file per variant)
  → screenshot / size report
  → 生成一张 A/B 候选表
```

需要补的三件事：

1. 并发限制和 API 错误重试；
2. 变体截图自动化（CDP 已经具备能力）；
3. 变体命名和素材 ID 规范，和投放平台对齐。

## 9. 边界与反思

- LLM 不知道你的游戏好不好玩，它只能给出候选；
- 文案字数约束不能保证“在 390px 下一定不折行”，必须截图验收；
- 颜色对比度不能只靠 prompt，必须用实际渲染检查；
- “AI 生成”不等于“AI 决策”，人的判断仍然在关键路径上。

这也是我认为 AI 试玩岗位真正需要的能力：**不是会写 prompt，而是知道哪一段该交给模型、哪一段必须交给代码和人。**
