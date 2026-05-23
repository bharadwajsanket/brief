/*
 * CleanCopy Pro — hygiene.js
 * CSS/JS injections for browser hygiene features:
 *   - "Open in App" overlay removal
 *   - Newsletter popup removal
 *   - Common modal/nag removal
 * Used by the scripting manager to inject on matching pages.
 */

// ── Hygiene CSS injections ─────────────────────────────────────────────────
// These are injected as USER-origin CSS (highest specificity, survives most overrides).
// Selectors are deliberately broad but safe — they target overlay patterns, not content.

export const HYGIENE_CSS = `
/* ── App install banners / smart banners ── */
#app-banner,
.app-banner,
.app-install-banner,
.smart-banner,
[id*="app-download-banner"],
[class*="app-download-banner"],
[id*="AppInstall"],
[class*="AppInstall"],
.branch-journeys-top,
.branch-journeys,
#smartbanner,
.smartbanner,
[id^="smart-app-banner"],
[class^="smart-app-banner"],
/* Medium app nag */
.branch-journeys-top { display: none !important; }

/* ── "Open in app" sticky bars ── */
[data-testid="OpenInApp"],
[aria-label*="Open in app"],
[aria-label*="open in app"],
[class*="open-in-app"],
[class*="openInApp"],
[id*="open-in-app"],
#open-in-app-nag { display: none !important; }

/* ── Newsletter / email capture modals ── */
[class*="newsletter-popup"],
[class*="NewsletterPopup"],
[id*="newsletter-popup"],
[class*="email-capture"],
[class*="EmailCapture"],
[class*="email-signup-modal"],
[class*="ModalNewsletter"],
[id*="mc_embed_signup"]:not(form),
/* Mailchimp embedded popups */
.mc-modal,
#mc-modal { display: none !important; }

/* ── Cookie consent nags (supplemental — EasyList covers most) ── */
[class*="cookie-banner"]:not([class*="content"]),
[id*="cookie-banner"],
[class*="CookieBanner"],
[id*="CookieBanner"],
[class*="cookie-consent"]:not(script),
#cookie-notice,
.cookie-notice,
[data-nosnippet*="cookie"] { display: none !important; }

/* ── Subscription / paywall soft-nag overlays ── */
[class*="paywall-overlay"],
[class*="PaywallOverlay"],
[class*="subscription-wall"],
.tp-modal,                 /* Piano / Tinypass */
#tp-modal,
.tp-backdrop { display: none !important; }

/* ── "Continue reading" scroll blockers ── */
[class*="reading-block"],
[class*="article-gate"],
[class*="ArticleGate"],
[class*="content-gate"] { display: none !important; }
`;

// ── Hygiene JS logic ───────────────────────────────────────────────────────
// Injected as a content script to handle dynamic / JS-rendered elements.
// Deliberately minimal: MutationObserver watching for overlay patterns.
export const HYGIENE_JS = `
(function() {
  'use strict';

  // Selectors that indicate overlay/nag elements when added dynamically
  const NAG_SELECTORS = [
    '[class*="newsletter-popup"]',
    '[class*="email-capture"]',
    '[class*="open-in-app"]',
    '[class*="app-banner"]',
    '.branch-journeys-top',
    '.smartbanner',
    '#smartbanner',
    '[data-testid="OpenInApp"]',
    '.tp-modal',
    '#tp-modal',
    '.tp-backdrop',
  ].join(',');

  // Check and hide matching nodes
  function sweepNags(root = document) {
    try {
      root.querySelectorAll(NAG_SELECTORS).forEach(el => {
        if (el._ccHidden) return;
        el._ccHidden = true;
        el.style.setProperty('display', 'none', 'important');
      });
    } catch {}
  }

  // Initial sweep
  sweepNags();

  // Watch for dynamically added elements
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.addedNodes.length === 0) continue;
      sweepNags(document);
      break; // one sweep per batch is enough
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Stop after 30s — page should be stable by then
  setTimeout(() => observer.disconnect(), 30000);
})();
`;
