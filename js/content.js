/*
 * Brief — content.js
 * Injected into all HTTP(S) pages.
 * Handles: AMP canonical redirect · nag removal · theme color relay · focus reading mode.
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
    const meta  = document.querySelector('meta[name="theme-color"]');
    const color = meta?.content?.trim();
    if (color && /^#[0-9a-f]{3,6}$/i.test(color)) {
      chrome.runtime.sendMessage({ what: 'brief:setThemeColor', hex: color, source: 'meta' });
      return;
    }

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
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
        if (!n) return;
        const hex = '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
        chrome.runtime.sendMessage({ what: 'brief:setThemeColor', hex, source: 'favicon' });
      } catch {}
    };
    img.src = link.href;
  }

  // ── Focus Reading Mode ─────────────────────────────────────────────────────
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

  // ── Trigger Region selection from popup message ────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startRegionSelect') {
      if (typeof window.__briefStartRegionSelect === 'function') {
        window.__briefStartRegionSelect();
      }
    }
  });

  // ── Startup ────────────────────────────────────────────────────────────────
  function onStartup() {
    checkAmp();
    sweepNags();
    relayThemeColor();
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
