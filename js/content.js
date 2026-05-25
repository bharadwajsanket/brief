/*
 * Brief — content.js
 * Injected into all HTTP(S) pages.
 * Handles: AMP canonical redirect · nag removal · selection bubble ·
 *           theme color relay · focus reading mode.
 */

(function () {
  'use strict';

  // ── AMP canonical detection ────────────────────────────────────────────────
  function checkAmp() {
    const ampMeta = document.querySelector('html[amp], html[⚡]');
    if (!ampMeta) return;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical?.href) return;
    const dest = canonical.href;
    if (dest === location.href) return;
    chrome.runtime.sendMessage({ what: 'cc:ampRedirect', canonical: dest });
  }

  // ── Hygiene: nag removal ───────────────────────────────────────────────────
  const NAG_SELECTORS = [
    '[class*="newsletter-popup"]', '[class*="email-capture"]',
    '[class*="open-in-app"]', '[class*="app-banner"]:not([class*="hero"])',
    '.branch-journeys-top', '.smartbanner', '#smartbanner',
    '[data-testid="OpenInApp"]', '.tp-modal', '#tp-modal', '.tp-backdrop',
    '[id*="newsletter-popup"]', '[id*="email-capture"]',
  ].join(',');

  function sweepNags(root = document) {
    try {
      root.querySelectorAll(NAG_SELECTORS).forEach(el => {
        if (el._briefHidden) return;
        el._briefHidden = true;
        el.style.setProperty('display', 'none', 'important');
      });
    } catch {}
  }

  // ── Theme color relay ──────────────────────────────────────────────────────
  function relayThemeColor() {
    // Try <meta name="theme-color"> first
    const meta  = document.querySelector('meta[name="theme-color"]');
    const color = meta?.content?.trim();
    if (color && /^#[0-9a-f]{3,6}$/i.test(color)) {
      chrome.runtime.sendMessage({ what: 'brief:setThemeColor', hex: color, source: 'meta' });
      return;
    }

    // Fallback: sample favicon dominant color via canvas
    const link = document.querySelector('link[rel~="icon"][href]');
    if (!link?.href) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 16;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const px = ctx.getImageData(0, 0, 16, 16).data;
        // Average non-transparent pixels
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue; // skip transparent
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
        if (!n) return;
        const hex = '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
        chrome.runtime.sendMessage({ what: 'brief:setThemeColor', hex, source: 'favicon' });
      } catch {}
    };
    img.src = link.href;
  }

  // ── Selection bubble ───────────────────────────────────────────────────────
  let bubble    = null;
  let hideTimer = null;

  const BUBBLE_STYLE = [
    'position:fixed', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'gap:0',
    'border-radius:20px',
    'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif',
    'font-size:12px', 'font-weight:600', 'letter-spacing:0.01em',
    'color:#fff',
    'background:rgba(18,18,20,0.90)',
    'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)',
    'box-shadow:0 4px 20px rgba(0,0,0,0.30),0 1px 6px rgba(0,0,0,0.18)',
    'cursor:default', 'user-select:none', '-webkit-user-select:none',
    'pointer-events:auto',
    'transform:translateY(6px)', 'opacity:0',
    'transition:opacity 0.16s ease,transform 0.16s ease',
  ].join(';');

  const BTN_BASE = [
    'display:inline-flex', 'align-items:center', 'justify-content:center',
    'padding:5px 11px', 'border:none', 'background:none',
    'font-family:inherit', 'font-size:12px', 'font-weight:600',
    'color:#fff', 'cursor:pointer', 'white-space:nowrap',
    'transition:background 0.12s',
    'border-radius:20px',
  ].join(';');

  function makeBubbleBtn(label, action, isFirst) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.action = action;
    btn.style.cssText = BTN_BASE + (isFirst ? ';padding-left:13px' : '');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
    btn.addEventListener('mousedown', e => e.stopPropagation());
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onAction(action); });
    return btn;
  }

  function makeSep() {
    const s = document.createElement('span');
    s.style.cssText = 'width:1px;height:14px;background:rgba(255,255,255,0.18);flex-shrink:0;';
    return s;
  }

  function createBubble() {
    const el = document.createElement('div');
    el.id = '__brief_bubble__';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Brief actions');
    el.style.cssText = BUBBLE_STYLE;

    // Icon + brand
    const brand = document.createElement('span');
    brand.style.cssText = 'padding:5px 10px 5px 13px;display:flex;align-items:center;gap:5px;';
    const spark = document.createElement('span');
    spark.textContent = '⚡'; spark.style.cssText = 'font-size:11px;line-height:1;';
    const lbl = document.createElement('span');
    lbl.textContent = 'Brief'; lbl.id = '__brief_lbl__';
    brand.appendChild(spark); brand.appendChild(lbl);

    // The brand area itself is the default click target for long selections
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onAction('explain'); });

    el._brand  = brand;
    el._actions = document.createElement('div');
    el._actions.id = '__brief_actions__';
    el._actions.style.cssText = 'display:flex;align-items:center;';

    el.appendChild(brand);
    el.appendChild(el._actions);

    el.addEventListener('mousedown', e => e.stopPropagation());
    return el;
  }

  function showBubble(x, y, selectedText) {
    if (!bubble) {
      bubble = createBubble();
      document.documentElement.appendChild(bubble);
    }

    bubble.dataset.selection = selectedText.slice(0, 1500);
    const wordCount = selectedText.trim().split(/\s+/).length;
    const isShort   = wordCount <= 3; // single word or very short phrase

    // Update actions based on selection length
    bubble._actions.innerHTML = '';
    if (isShort) {
      bubble._brand.querySelector('#__brief_lbl__').textContent = 'Brief';
      bubble._brand.style.cursor = 'default';
      bubble._brand.onclick = null;

      const actions = [
        { label: 'Define',   action: 'define'   },
        { label: 'Synonyms', action: 'synonyms' },
        { label: 'Explain',  action: 'explain'  },
      ];
      actions.forEach((a, i) => {
        bubble._actions.appendChild(makeSep());
        bubble._actions.appendChild(makeBubbleBtn(a.label, a.action, false));
      });
    } else {
      bubble._brand.querySelector('#__brief_lbl__').textContent = 'Brief';
      bubble._brand.style.cursor = 'pointer';
      // Show Explain and Ask for long selections
      const actions = [
        { label: 'Explain', action: 'explain' },
        { label: 'Ask AI',  action: 'ask'     },
      ];
      actions.forEach(a => {
        bubble._actions.appendChild(makeSep());
        bubble._actions.appendChild(makeBubbleBtn(a.label, a.action, false));
      });
    }

    // Position above selection endpoint, clamped to viewport
    const bw = isShort ? 240 : 170, bh = 32, margin = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(x - bw / 2, vw - bw - margin);
    let top  = y - bh - 12;
    if (left < margin) left = margin;
    if (top  < margin) top  = y + 20;

    bubble.style.left = `${left}px`;
    bubble.style.top  = `${top}px`;

    requestAnimationFrame(() => {
      bubble.style.opacity   = '1';
      bubble.style.transform = 'translateY(0)';
    });

    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBubble, 5000);
  }

  function hideBubble() {
    if (!bubble) return;
    bubble.style.opacity   = '0';
    bubble.style.transform = 'translateY(6px)';
  }

  function onAction(action) {
    hideBubble();
    const text = bubble?.dataset.selection ?? '';
    if (!text) return;

    if (typeof window.__briefShowResultPanel === 'function') {
      const labelMap = {
        define: 'Definition',
        synonyms: 'Synonyms',
        explain: 'Explanation',
        ask: 'Answer'
      };
      const title = labelMap[action] || 'Brief Selection';
      window.__briefShowResultPanel(title, text, action);
    } else {
      // Fallback to popup
      chrome.runtime.sendMessage({ what: 'brief:setSelection', selection: text, action });
      chrome.runtime.sendMessage({ what: 'brief:openPopup' });
    }
  }

  // Listen for text selection
  document.addEventListener('selectionchange', () => {
    const sel  = window.getSelection();
    const text = sel?.toString().trim() ?? '';

    if (text.length < 3) { hideBubble(); return; } // allow single words (≥3 chars)

    try {
      const range = sel.getRangeAt(0);
      const rect  = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      showBubble(rect.left + rect.width / 2, rect.top, text);
    } catch {}
  });

  // Hide on click elsewhere
  document.addEventListener('mousedown', e => {
    if (e.target?.closest?.('#__brief_bubble__')) return;
    hideBubble();
  });

  // ── Focus Reading Mode ─────────────────────────────────────────────────────
  // Callable via executeScript from background/popup
  window.__briefFocusMode = function (enable) {
    const ATTR   = 'data-brief-focus';
    const STYLE_ID = '__brief_focus_css__';

    if (enable) {
      if (document.documentElement.hasAttribute(ATTR)) return false;
      document.documentElement.setAttribute(ATTR, '1');

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        [data-brief-focus] {
          --bf-bg: #f8f6f2;
          background: var(--bf-bg) !important;
        }
        [data-brief-focus] body {
          background: var(--bf-bg) !important;
        }
        [data-brief-focus] header:not(article header),
        [data-brief-focus] footer:not(article footer),
        [data-brief-focus] nav,
        [data-brief-focus] aside,
        [data-brief-focus] [class*="sidebar"],
        [data-brief-focus] [class*="-ad-"],
        [data-brief-focus] [class*="banner"],
        [data-brief-focus] [class*="social"],
        [data-brief-focus] [class*="recommend"],
        [data-brief-focus] [class*="related"],
        [data-brief-focus] [class*="comment"] {
          opacity: 0.04 !important;
          pointer-events: none !important;
          transition: opacity 0.5s ease !important;
        }
        [data-brief-focus] article,
        [data-brief-focus] main,
        [data-brief-focus] [role="main"],
        [data-brief-focus] .post-content,
        [data-brief-focus] .article-content {
          max-width: 680px !important;
          margin: 48px auto !important;
          font-size: 19px !important;
          line-height: 1.85 !important;
          color: #1a1a1c !important;
          font-family: Georgia, "Times New Roman", serif !important;
          padding: 0 24px !important;
          transition: all 0.5s ease !important;
        }
      `;
      document.head.appendChild(style);
      return true;
    } else {
      document.documentElement.removeAttribute(ATTR);
      document.getElementById(STYLE_ID)?.remove();
      return false;
    }
  };

  // ── Floating Orb & Utility Palette ──────────────────────────────────────────
  function getSelectedText() {
    const sel = window.getSelection();
    return sel ? sel.toString().trim() : '';
  }

  function getThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = meta?.content?.trim();
    if (color && /^#[0-9a-f]{3,8}$/i.test(color)) {
      return color;
    }
    return '#0a84ff'; // default Brief blue
  }

  function hexToRgba(hex, alpha) {
    let c = hex.substring(1);
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  console.log('[Brief] content.js loaded');

  function initBriefUI() {
    if (window.__briefOrbInjected) return;

    console.log('[Brief] injecting orb');

    // Inject styles for Orb and Palette into head
    const style = document.createElement('style');
    style.id = 'brief-orb-palette-styles';
    style.textContent = `
      #brief-orb-debug {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 999999;
        background: #111;
        color: #fff;
        padding: 12px 16px;
        border-radius: 999px;
        font-family: sans-serif;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      .brief-palette-debug {
        position: fixed;
        right: 20px;
        bottom: 75px;
        width: 180px;
        background: #111;
        color: #fff;
        border-radius: 8px;
        z-index: 999999;
        padding: 8px;
        display: none;
        flex-direction: column;
        gap: 4px;
        font-family: sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        border: 1px solid #333;
      }
      .brief-palette-debug.visible {
        display: flex;
      }
      .brief-palette-btn-debug {
        background: none;
        border: none;
        color: #fff;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.12s;
      }
      .brief-palette-btn-debug:hover {
        background: #222;
      }
      .brief-palette-btn-debug.active {
        background: #333;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);

    // Create Orb
    const orb = document.createElement('div');
    orb.id = 'brief-orb-debug';
    orb.textContent = '⚡ Brief';
    console.log('[Brief] orb shown');

    // Create Palette
    const palette = document.createElement('div');
    palette.id = 'brief-palette-debug';
    palette.className = 'brief-palette-debug';

    orb.onclick = (e) => {
      e.stopPropagation();
      const visible = palette.classList.contains('visible');
      if (visible) {
        palette.classList.remove('visible');
        console.log('[Brief] palette closed');
      } else {
        updatePaletteContent(palette);
        palette.classList.add('visible');
        console.log('[Brief] palette opened');
      }
    };

    document.body.appendChild(orb);
    document.body.appendChild(palette);
    window.__briefOrbInjected = true;

    // Click outside to close palette
    window.addEventListener('click', e => {
      if (e.target.closest('#brief-orb-debug') || e.target.closest('#brief-palette-debug')) return;
      if (palette.classList.contains('visible')) {
        palette.classList.remove('visible');
        console.log('[Brief] palette closed');
      }
    });

    // Esc to close palette
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (palette.classList.contains('visible')) {
          palette.classList.remove('visible');
          console.log('[Brief] palette closed');
        }
      }
    });
  }

  function updatePaletteContent(palette) {
    const selText = getSelectedText();
    const isFocusActive = document.documentElement.hasAttribute('data-brief-focus');

    let html = `
      <button class="brief-palette-btn-debug" id="btn-summarize">Summarize Page</button>
      <button class="brief-palette-btn-debug${isFocusActive ? ' active' : ''}" id="btn-focus">
        ${isFocusActive ? 'Exit Focus Mode' : 'Focus Mode'}
      </button>
      <button class="brief-palette-btn-debug" id="btn-clean">Clean URL</button>
      <button class="brief-palette-btn-debug" id="btn-region">Understand Region</button>
    `;

    if (selText.length >= 3) {
      html += `<button class="brief-palette-btn-debug" id="btn-define">Define Selection</button>`;
    }

    palette.innerHTML = html;

    palette.querySelector('#btn-summarize').addEventListener('click', () => {
      palette.classList.remove('visible');
      runSummarizePage();
    });

    palette.querySelector('#btn-focus').addEventListener('click', () => {
      const isAct = document.documentElement.hasAttribute('data-brief-focus');
      window.__briefFocusMode(!isAct);
      updatePaletteContent(palette);
    });

    palette.querySelector('#btn-clean').addEventListener('click', () => {
      palette.classList.remove('visible');
      chrome.runtime.sendMessage({ what: 'cc:copyCleanUrl' });
    });

    palette.querySelector('#btn-region').addEventListener('click', () => {
      palette.classList.remove('visible');
      if (typeof window.__briefStartRegionSelect === 'function') {
        window.__briefStartRegionSelect();
      } else {
        console.error('[Brief] window.__briefStartRegionSelect is not defined');
      }
    });

    if (selText.length >= 3) {
      palette.querySelector('#btn-define').addEventListener('click', () => {
        palette.classList.remove('visible');
        if (typeof window.__briefShowResultPanel === 'function') {
          window.__briefShowResultPanel('Selection Definition', selText, 'define');
        }
      });
    }
  }

  async function runSummarizePage() {
    try {
      const res = await chrome.runtime.sendMessage({ what: 'cc:extractPage' });
      if (typeof window.__briefShowResultPanel === 'function') {
        window.__briefShowResultPanel('Page Summary', res?.data?.text || 'Could not extract page text content.', 'summarize');
      }
    } catch (err) {
      console.error('[Brief] runSummarizePage failed:', err);
    }
  }

  // ── Startup ────────────────────────────────────────────────────────────────
  function onStartup() {
    checkAmp();
    sweepNags();
    relayThemeColor();
    if (document.body) {
      initBriefUI();
    } else {
      document.addEventListener('DOMContentLoaded', initBriefUI);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onStartup);
  } else {
    onStartup();
  }

  // Watch for dynamically injected nags (disconnect after 30s)
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) { if (m.addedNodes.length) { sweepNags(); break; } }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);

})();
