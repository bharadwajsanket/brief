/*
 * CleanCopy Pro — url-cleaner.js
 * URL sanitization + redirect bypass + AMP cleanup
 * Pure module, no browser APIs. Importable in both service worker and popup.
 */

// ── Tracking param blacklist ───────────────────────────────────────────────
export const TRACKING_PARAMS = new Set([
  // UTM (all variants)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  // Social click IDs
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid',
  'igshid', 'twclid', 'li_fat_id', 'msclkid', 'ttclid',
  'rdt_cid', 's_cid', 'yclid',
  // Mailchimp
  'mc_cid', 'mc_eid',
  // HubSpot
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsCtaTracking',
  // Marketo
  'mkt_tok',
  // Drip / Iterable / Klaviyo / Vero / Omnisend
  'dt_id', 'iterableEmailCampaignId', 'iterableTemplateId',
  '_kx', 'vero_id', 'vero_conv', 'omnisendContactID', 'stm_source',
  // Referral noise
  'ref', 'ref_src', 'ref_url', 'referrer', 'source', 'affiliate', 'partner',
  // Amazon affiliate
  'tag', 'linkCode', 'linkId', 'ascsubtag',
  // Misc noise
  'ncid', 'cmpid', 'cid', 'cmp', 'campaign',
  // Pardot
  'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_r', 'pf_rd_p',
  // Adobe / ShareASale / WT
  'sscid', 'WT.mc_id', 'WT.srch',
]);

// ── Core URL sanitizer ─────────────────────────────────────────────────────
/**
 * sanitizeUrl(rawUrl)
 * Strips tracking params, preserves all functional params.
 * @returns {{ cleaned: string, removed: string[], kept: string[] }}
 */
export function sanitizeUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch {
    return { cleaned: rawUrl, removed: [], kept: [], changed: false };
  }

  const removed = [];
  const kept    = [];
  const toDelete = [];

  for (const [key] of url.searchParams) {
    if (TRACKING_PARAMS.has(key) || TRACKING_PARAMS.has(key.toLowerCase())) {
      toDelete.push(key);
      removed.push(key);
    } else {
      kept.push(key);
    }
  }

  for (const key of toDelete) url.searchParams.delete(key);

  let cleaned = url.toString();
  // Remove trailing "?" with no remaining params
  if (url.searchParams.size === 0 && cleaned.endsWith('?')) {
    cleaned = cleaned.slice(0, -1);
  }

  return { cleaned, removed, kept, changed: removed.length > 0 };
}

// ── Redirect bypass ────────────────────────────────────────────────────────
// Patterns that wrap real URLs inside redirect/outbound URLs.
// Each entry: { test(url), extract(url) -> realUrl | null }
const REDIRECT_PATTERNS = [
  // Google redirect: https://www.google.com/url?q=https://example.com&...
  {
    test: url => (url.hostname === 'www.google.com' || url.hostname === 'google.com')
                 && url.pathname === '/url',
    extract: url => url.searchParams.get('q') || url.searchParams.get('url'),
  },
  // Google AMP viewer: https://google.com/amp/s/example.com/...
  {
    test: url => url.hostname === 'www.google.com' && url.pathname.startsWith('/amp/s/'),
    extract: url => 'https://' + url.pathname.slice('/amp/s/'.length) + url.search,
  },
  // Facebook redirect: https://l.facebook.com/l.php?u=...
  {
    test: url => url.hostname === 'l.facebook.com' && url.pathname === '/l.php',
    extract: url => url.searchParams.get('u'),
  },
  // Facebook out: https://www.facebook.com/flx/warn/?u=...
  {
    test: url => url.hostname === 'www.facebook.com' && url.pathname.startsWith('/flx/warn'),
    extract: url => url.searchParams.get('u'),
  },
  // Instagram redirect: https://l.instagram.com/?u=...
  {
    test: url => url.hostname === 'l.instagram.com',
    extract: url => url.searchParams.get('u'),
  },
  // Twitter/X: https://t.co/... — these are short links, we can't resolve without fetch
  // YouTube redirect: https://www.youtube.com/redirect?q=...
  {
    test: url => url.hostname === 'www.youtube.com' && url.pathname === '/redirect',
    extract: url => url.searchParams.get('q'),
  },
  // LinkedIn redirect: https://www.linkedin.com/redir/redirect?url=...
  {
    test: url => url.hostname === 'www.linkedin.com' && url.pathname.startsWith('/redir/redirect'),
    extract: url => url.searchParams.get('url'),
  },
  // Slack redirect: https://slack-redir.net/link?url=...
  {
    test: url => url.hostname === 'slack-redir.net',
    extract: url => url.searchParams.get('url'),
  },
];

/**
 * extractRedirectTarget(rawUrl)
 * If the URL is a redirect wrapper, return the real destination.
 * @returns {string|null} real URL or null if not a redirect
 */
export function extractRedirectTarget(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }

  for (const pattern of REDIRECT_PATTERNS) {
    if (!pattern.test(url)) continue;
    const target = pattern.extract(url);
    if (!target) continue;
    // Validate extracted URL
    try {
      const t = new URL(decodeURIComponent(target));
      if (t.protocol === 'http:' || t.protocol === 'https:') {
        return t.href;
      }
    } catch { /* malformed, skip */ }
  }
  return null;
}

// ── AMP → Canonical resolver ───────────────────────────────────────────────
/**
 * detectAmp(url)
 * Detects common AMP URL patterns.
 * Returns the probable canonical URL or null.
 * For deeper resolution, the content script reads <link rel="canonical">.
 */
export function detectAmp(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }

  const host = url.hostname;
  const path = url.pathname;

  // Google AMP CDN: https://www.google.com/amp/s/example.com/article/amp/
  if (host === 'www.google.com' && path.startsWith('/amp/s/')) {
    const rest = path.slice('/amp/s/'.length);
    let canonical = 'https://' + rest + url.search;
    // Strip trailing /amp/ or /amp from path
    canonical = canonical.replace(/\/amp\/?(\?|$)/, '$1');
    return canonical;
  }

  // Bing AMP: https://www.bing.com/amp/...
  if (host === 'www.bing.com' && path.startsWith('/amp/')) {
    return null; // too complex to resolve without fetch
  }

  // Self-hosted AMP: path ends in /amp or /amp/
  if (/\/amp\/?$/.test(path)) {
    const canonical = new URL(rawUrl);
    canonical.pathname = path.replace(/\/amp\/?$/, '') || '/';
    return canonical.href;
  }

  // AMP query param: ?amp=1
  if (url.searchParams.get('amp') === '1' || url.searchParams.get('amp') === 'true') {
    const canonical = new URL(rawUrl);
    canonical.searchParams.delete('amp');
    let result = canonical.toString();
    if (canonical.searchParams.size === 0) result = result.replace(/\?$/, '');
    return result;
  }

  return null;
}

// ── Full pipeline ──────────────────────────────────────────────────────────
/**
 * fullClean(rawUrl)
 * Applies: redirect bypass → AMP cleanup → tracking param removal
 * Returns full audit of what happened.
 */
export function fullClean(rawUrl) {
  let url = rawUrl;
  const steps = [];

  // Step 1: redirect bypass
  const redirectTarget = extractRedirectTarget(url);
  if (redirectTarget) {
    steps.push({ type: 'redirect', from: url, to: redirectTarget });
    url = redirectTarget;
  }

  // Step 2: AMP cleanup
  const ampCanonical = detectAmp(url);
  if (ampCanonical) {
    steps.push({ type: 'amp', from: url, to: ampCanonical });
    url = ampCanonical;
  }

  // Step 3: tracking param removal
  const { cleaned, removed, kept, changed } = sanitizeUrl(url);
  if (changed) {
    steps.push({ type: 'params', removed });
    url = cleaned;
  }

  return {
    original: rawUrl,
    cleaned:  url,
    changed:  url !== rawUrl,
    steps,
    removed,  // flat list of removed params (for quick display)
    kept,
  };
}
