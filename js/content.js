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
  function getOrbStyles() {
    return `
      :host {
        --brief-accent: #0a84ff;
        --brief-accent-soft: rgba(10, 132, 255, 0.12);
        --brief-accent-glow: rgba(10, 132, 255, 0.28);
      }

      #brief-orb {
        position: fixed;
        bottom: calc(24px + env(safe-area-inset-bottom, 0px));
        right: calc(24px + env(safe-area-inset-right, 0px));
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483638;
        opacity: 0.45;
        transform: scale(1);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        animation: brief-orb-pulse 3s infinite ease-in-out;
      }

      #brief-orb:hover {
        opacity: 1;
        transform: scale(1.08);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12), 0 1px 6px rgba(0, 0, 0, 0.06);
      }

      #brief-orb.active {
        opacity: 1;
        transform: scale(0.92);
      }

      #brief-orb svg {
        width: 20px;
        height: 20px;
        color: var(--brief-accent);
        transition: transform 0.25s ease;
      }

      #brief-orb:hover svg {
        transform: rotate(8deg);
      }

      @keyframes brief-orb-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 0 var(--brief-accent-soft); }
        50% { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.10), 0 0 0 8px rgba(10, 132, 255, 0); }
      }

      @media (prefers-color-scheme: dark) {
        #brief-orb {
          background: rgba(30, 30, 32, 0.85);
          border-color: rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 1px 4px rgba(0, 0, 0, 0.15);
        }
        @keyframes brief-orb-pulse {
          0%, 100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 0 0 0 var(--brief-accent-soft); }
          50% { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.30), 0 0 0 8px rgba(10, 132, 255, 0); }
        }
      }

      .brief-palette {
        position: fixed;
        bottom: calc(78px + env(safe-area-inset-bottom, 0px));
        right: calc(24px + env(safe-area-inset-right, 0px));
        width: 220px;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        color: #1c1c1e;
        padding: 8px;
        z-index: 2147483639;
        display: flex;
        flex-direction: column;
        gap: 4px;
        opacity: 0;
        transform: translateY(12px) scale(0.96);
        pointer-events: none;
        transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .brief-palette.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      @media (prefers-color-scheme: dark) {
        .brief-palette {
          background: rgba(32, 32, 35, 0.88);
          border-color: rgba(255, 255, 255, 0.08);
          color: #f2f2f7;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.20);
        }
      }

      .brief-palette-header {
        padding: 6px 8px 4px 8px;
        font-size: 10px;
        font-weight: 700;
        color: #8e8e93;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      @media (prefers-color-scheme: dark) {
        .brief-palette-header {
          border-bottom-color: rgba(255, 255, 255, 0.04);
        }
      }

      .brief-palette-btn {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        background: none;
        border: none;
        border-radius: 8px;
        color: inherit;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        transition: background 0.12s, color 0.12s, transform 0.12s;
        box-sizing: border-box;
      }

      .brief-palette-btn:hover {
        background: var(--brief-accent-soft);
        color: var(--brief-accent);
      }

      .brief-palette-btn:active {
        transform: scale(0.98);
      }

      .brief-palette-btn svg {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        opacity: 0.8;
      }

      .brief-palette-btn:hover svg {
        opacity: 1;
      }

      .brief-palette-btn.active {
        background: var(--brief-accent-soft);
        color: var(--brief-accent);
        font-weight: 600;
      }
    `;
  }

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
    const orb = document.createElement('div');
    orb.id = 'brief-orb-debug';
    orb.textContent = '⚡ Brief';
    orb.style.position = 'fixed';
    orb.style.right = '20px';
    orb.style.bottom = '20px';
    orb.style.zIndex = '999999';
    orb.style.background = '#111';
    orb.style.color = '#fff';
    orb.style.padding = '12px 16px';
    orb.style.borderRadius = '999px';
    orb.style.fontFamily = 'sans-serif';
    orb.style.cursor = 'pointer';

    orb.onclick = () => alert('Brief working');

    document.body.appendChild(orb);
    window.__briefOrbInjected = true;
    console.log('[Brief] orb injected');
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
