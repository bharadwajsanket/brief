/**
 * CleanCopy Pro — hygiene-inject.js
 * Content script: removes "Open in App" overlays, newsletter popups,
 * and common browser-hygiene annoyances dynamically.
 * Injected at document_start by the scripting manager registration.
 */
(function () {
  'use strict';

  // Bail if already injected (guards against double-injection)
  if (window.__ccHygieneInjected) return;
  window.__ccHygieneInjected = true;

  // Selectors that identify known overlay/nag patterns
  const NAG_SELECTORS = [
    // App install / smart banners
    '#app-banner', '.app-banner', '.app-install-banner', '.smart-banner',
    '#smartbanner', '.smartbanner', '[id^="smart-app-banner"]',
    '.branch-journeys-top', '.branch-journeys',
    '[class*="app-download-banner"]', '[class*="AppInstall"]',
    // "Open in app" bars
    '[data-testid="OpenInApp"]',
    '[aria-label*="Open in app"]',
    '[class*="open-in-app"]', '[class*="openInApp"]', '[id*="open-in-app"]',
    '#open-in-app-nag',
    // Newsletter / email capture
    '[class*="newsletter-popup"]', '[class*="NewsletterPopup"]',
    '[id*="newsletter-popup"]', '[class*="email-capture"]',
    '[class*="EmailCapture"]', '[class*="email-signup-modal"]',
    '[class*="ModalNewsletter"]', '.mc-modal', '#mc-modal',
    // Piano/Tinypass paywall
    '.tp-modal', '#tp-modal', '.tp-backdrop',
  ].join(',');

  function sweep() {
    try {
      document.querySelectorAll(NAG_SELECTORS).forEach(el => {
        if (el._ccDone) return;
        el._ccDone = true;
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('aria-hidden', 'true');
      });
    } catch (_) { /* never crash the page */ }
  }

  // Immediate sweep in case elements already exist
  if (document.readyState !== 'loading') {
    sweep();
  } else {
    document.addEventListener('DOMContentLoaded', sweep, { once: true });
  }

  // Watch for dynamically injected overlays (e.g. loaded after scroll)
  const observer = new MutationObserver(() => sweep());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Disconnect after 45s — the page is fully interactive long before that
  setTimeout(() => observer.disconnect(), 45000);
})();
