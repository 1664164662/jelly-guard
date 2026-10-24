# 试玩广告 QA Checklist

> 用法：每次构建后先跑 `npm run qa && npm test`，再用下面的清单做人工 / 真机验收。  
> P0 = 不通过不能发；P1 = 影响体验，尽量当天修；P2 = 优化项。

## 0. 构建与体积

- [ ] P0 `npm run build` 成功，`dist/build-report.json` 生成
- [ ] P0 单文件 ≤ 150 KB
- [ ] P0 gzip ≤ 50 KB
- [ ] P0 外部资源引用 = 0
- [ ] P0 `dist/play/index.html` 可直接通过 `file://` 打开（无模块 / CORS 依赖）
- [ ] P1 构建版本号与 `dist/index.html` 显示一致
- [ ] P1 构建后 `src/` 外链全部被内联

## 1. 首屏与启动

- [ ] P0 3 秒内看到主按钮，无 blank / 加载态
- [ ] P0 点击开始后 200ms 内可操作
- [ ] P0 首次点击前没有声音
- [ ] P0 点击开始后音频正常，无爆音
- [ ] P1 静音状态刷新后保持
- [ ] P1 开始页在 390×844 / 360×800 / 320×568 下不裁切
- [ ] P2 减少动态效果（`prefers-reduced-motion`）下不震动

## 2. 核心交互

- [ ] P0 可以拖动炮台；松手后回到合法槽位
- [ ] P0 同色合并，等级 +1，分数增加
- [ ] P0 不同色交换位置，不丢失炮台
- [ ] P0 拖拽过程中页面不滚动
- [ ] P0 `pointercancel` / 手指移出 Canvas 后不卡在拖拽态
- [ ] P0 6.2 秒无操作自动完成第一次合成
- [ ] P1 连续快速拖拽不会产生重复炮台
- [ ] P1 拖到空槽位可以换位
- [ ] P2 拖拽时同色槽位有高亮 / 文案提示

## 3. 战斗与结算

- [ ] P0 炮台会自动攻击，敌人会掉血
- [ ] P0 敌人到达底线会扣生命，生命为 0 进入失败
- [ ] P0 30 秒结束进入胜利
- [ ] P0 胜利 / 失败都能显示 End Card
- [ ] P0 End Card 分数、合并数、击杀数正确
- [ ] P0 点击“再玩一次”完全重置（生命、分数、炮台、计时器）
- [ ] P1 Boss 出现时血条 / 提示正常，不遮挡 HUD
- [ ] P1 糖爆满能量可释放，释放后能量清空
- [ ] P1 糖爆命中多个敌人，事件 targets > 0
- [ ] P2 全合成到 Lv.5 后仍能防守（跨轨兜底）

## 4. End Card 与广告桥

- [ ] P0 CTA 只触发一次，不会连续跳转
- [ ] P0 无广告桥时只显示 toast，不导航
- [ ] P0 MRAID 环境下调用 `mraid.open(url)` 且只调用一次
- [ ] P0 Google 环境调用 `ExitApi.exit()`
- [ ] P0 TikTok 环境调用 `playableSDK.openAppStore()`
- [ ] P1 CTA 点击埋点包含 `cta_click` + `store_open`
- [ ] P1 下载 URL 可配置（不要把 example.com 带上线）
- [ ] P2 End Card 出现后 Canvas 停止重绘

## 5. 埋点与数据

- [ ] P0 `ad_impression` 只上报一次
- [ ] P0 `ad_start` 包含 seed / duration
- [ ] P0 `merge` / `sugar_burst` / `ad_complete` / `ad_fail` 字段完整
- [ ] P1 `postMessage` 在 iframe 和独立页都能工作
- [ ] P1 `perf` 事件包含 fps / entities / dpr / quality
- [ ] P2 埋点不会因为父页面跨域而报错

## 6. 性能

- [ ] P0 游戏过程中不持续掉到 30fps 以下
- [ ] P1 页面切后台再回来，时间不跳变
- [ ] P1 连续玩 3 局无内存明显增长
- [ ] P1 iPhone Safari / Android Chrome 触摸正常
- [ ] P2 低端机自动降低 DPR / 粒子
- [ ] P2 End Card 出现后主线程不再 60fps 重绘

## 7. 兼容与平台

- [ ] P0 广告平台 iframe 内无横向滚动
- [ ] P0 安全区（刘海 / 底部手势条）不遮挡按钮
- [ ] P0 320 宽设备上 CTA 不出屏
- [ ] P1 `prefers-reduced-motion` / 静音 / 低电量模式不崩
- [ ] P1 无网络时仍可完整试玩
- [ ] P2 横屏时提示竖屏或保持布局不崩

## 8. 测试命令

```bash
npm run build
npm run qa
npm test
```

预期：

```text
18/18 checks passed
5/5 smoke checks passed · console clean
```

## 9. 真机矩阵（建议）

| 设备 | 系统 | 关注点 |
| --- | --- | --- |
| iPhone 12 / 13 | iOS 17+ | 音频解锁、安全区、触摸 |
| iPhone SE | iOS 16 | 320×568 布局 |
| Redmi Note 系列 | Android 12 | 低端机 FPS、震动 |
| 一加 / 小米高刷 | Android 14 | 高刷下的计时 |
| iPad | iPadOS | 大屏 letterbox |

## 10. 发版前最后三问

1. 一个没看过的人，能否在 10 秒内完成第一次合成？
2. CTA 在真实广告容器里，是否只跳一次？
3. 如果明天要出 5 个新变体，我是否只需要改 JSON / 重新构建？
