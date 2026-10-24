/* =========================================================
   Portfolio interactions: reveal, A/B switcher, live telemetry
   ========================================================= */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // ---------------------------------------------------------
  // Reveal-on-scroll
  // ---------------------------------------------------------
  document.body.classList.add('is-reveal-ready');
  const revealItems = $$('.reveal');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach((item) => observer.observe(item));
  }

  // ---------------------------------------------------------
  // Variant switcher
  // ---------------------------------------------------------
  const VARIANTS = {
    mint: {
      label: '薄荷实验室',
      desc: '薄荷实验室：冷色霓虹，突出「合成升级」的清爽反馈。',
    },
    berry: {
      label: '莓莓风暴',
      desc: '莓莓风暴：粉紫色 B 面，文案更甜，适合偏女性向的素材测试。',
    },
    sunset: {
      label: '日落汽水',
      desc: '日落汽水：AI 辅助生成的主题与文案，暖色对比，替代冷色主视觉。',
    },
  };

  const frame = $('#game-frame');
  const liveVariant = $('#live-variant');
  const variantDesc = $('#variant-desc');
  const variantOpen = $('#variant-open');
  const tabs = $$('.variant-tab');
  let activeVariant = 'mint';

  function setVariant(id, { reload = true } = {}) {
    if (!VARIANTS[id]) return;
    activeVariant = id;
    tabs.forEach((tab) => {
      const active = tab.dataset.variant === id;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    variantDesc.textContent = VARIANTS[id].desc;
    liveVariant.textContent = `VARIANT / ${id.toUpperCase()}`;
    variantOpen.href = `play/?variant=${id}&quality=high`;
    if (reload) {
      clearLog(`加载 ${VARIANTS[id].label}…`);
      frame.src = `play/?variant=${id}&quality=high`;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.variant === activeVariant) return;
      setVariant(tab.dataset.variant);
    });
  });

  // ---------------------------------------------------------
  // Live telemetry from the iframe
  // ---------------------------------------------------------
  const logEl = $('#event-log');
  const fpsEl = $('#live-fps');
  const eventNames = new Set([
    'ad_impression', 'ad_start', 'tutorial_complete', 'merge', 'supply_drop',
    'sugar_burst', 'boss_spawn', 'boss_kill', 'enemy_leak', 'ad_complete',
    'ad_fail', 'end_card_view', 'cta_click', 'store_open', 'replay',
    'quality_adapt', 'pause_hidden', 'resume_visible', 'mraid_ready',
  ]);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function formatTime(ms) {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function pickProps(event) {
    switch (event.name) {
      case 'merge': return { lv: event.level, auto: Boolean(event.auto) };
      case 'sugar_burst': return { targets: event.targets };
      case 'supply_drop': return { col: event.col, row: event.row };
      case 'boss_spawn': return { t: event.t };
      case 'ad_complete':
      case 'ad_fail': return { score: event.score, merges: event.merges, kills: event.kills };
      case 'cta_click': return { score: event.score };
      case 'quality_adapt': return { fps: event.fps, q: 'balanced' };
      case 'mraid_ready': return { bridge: 'mraid' };
      default: return {};
    }
  }

  function clearLog(message = '等待试玩开始…') {
    logEl.innerHTML = `<div class="log-line log-line--muted"><span class="log-t">00:00</span><span class="log-evt">${escapeHtml(message)}</span></div>`;
  }

  function appendLog(event) {
    const props = pickProps(event);
    const propText = Object.keys(props).length
      ? `{ ${Object.entries(props).map(([key, value]) => `${key}: ${value}`).join(', ')} }`
      : '';
    const hot = event.name === 'ad_fail' || event.name === 'enemy_leak';
    const warm = ['merge', 'sugar_burst', 'boss_kill', 'boss_spawn', 'supply_drop'].includes(event.name);
    const line = document.createElement('div');
    line.className = `log-line${hot ? ' log-line--hot' : warm ? ' log-line--warm' : ''}`;
    line.innerHTML = `<span class="log-t">${formatTime(event.t)}</span><span class="log-evt">${escapeHtml(event.name)}</span><span class="log-props">${escapeHtml(propText)}</span>`;
    if (logEl.children.length === 1 && logEl.firstElementChild.classList.contains('log-line--muted')) {
      logEl.innerHTML = '';
    }
    logEl.appendChild(line);
    while (logEl.children.length > 7) logEl.firstElementChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  window.addEventListener('message', (message) => {
    const data = message.data;
    if (!data || data.source !== 'jelly-guard') return;
    if (data.type === 'perf') {
      if (data.data && Number.isFinite(data.data.fps)) {
        fpsEl.textContent = `${Math.round(data.data.fps)} FPS`;
        fpsEl.style.color = data.data.fps < 45 ? 'var(--coral)' : 'var(--mint)';
      }
      return;
    }
    if (data.type === 'event') {
      const event = data.event;
      if (!event || !event.name) return;
      if (event.name === 'perf') return;
      if (event.name === 'ad_impression') {
        if (event.variant) liveVariant.textContent = `VARIANT / ${String(event.variant).toUpperCase()}`;
        appendLog(event);
        return;
      }
      if (!eventNames.has(event.name)) return;
      appendLog(event);
      if (event.name === 'ad_complete') {
        fpsEl.textContent = 'COMPLETE';
        fpsEl.style.color = 'var(--gold)';
      }
      if (event.name === 'ad_fail') {
        fpsEl.textContent = 'RETRY?';
        fpsEl.style.color = 'var(--coral)';
      }
      return;
    }
    if (data.type === 'result') {
      appendLog({
        name: data.result === 'win' ? 'result_win' : 'result_lose',
        t: 0,
        score: data.stats?.score,
        merges: data.stats?.merges,
        kills: data.stats?.kills,
      });
    }
  });

  frame.addEventListener('load', () => {
    fpsEl.textContent = '60 FPS';
    fpsEl.style.color = 'var(--mint)';
  });

  // ---------------------------------------------------------
  // Build report → real size numbers
  // ---------------------------------------------------------
  function formatKb(bytes) {
    if (!Number.isFinite(bytes)) return null;
    return (bytes / 1024).toFixed(1).replace(/\.0$/, '');
  }

  fetch('build-report.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('no root report');
      return response.json();
    })
    .catch(() => fetch('dist/build-report.json', { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error('no build report');
      return response.json();
    }))
    .then((report) => {
      const raw = formatKb(report?.playable?.rawBytes);
      const gzip = formatKb(report?.playable?.gzipBytes);
      if (raw) {
        $('#size-stat').innerHTML = `${raw}<span>KB</span>`;
        $('#budget-size').textContent = `${raw} KB`;
        $('#aside-size').textContent = `${raw} KB`;
      }
      if (gzip) {
        $('#budget-gzip').textContent = `${gzip} KB`;
        $('#aside-gzip').textContent = `${gzip} KB`;
      }
      $$('.size-live').forEach((el) => { el.textContent = `${raw || '—'} KB`; });
    })
    .catch(() => {
      // The page is fully usable without the build report; keep the design-time
      // numbers visible rather than showing an error to a recruiter.
    });

  // Pause the iframe's audio when the user switches tabs? The game handles
  // visibility itself, so no extra bridge is required here.
})();
