/*******************************************************************************
 *
 * Brief — background.js
 * Forked from uBlock Origin Lite (GPLv3) by Raymond Hill.
 * Brief AI layer by bharadwajsanket.
 *
 * Service worker: handles URL cleaning, context menus, selection relay,
 * keyboard shortcut, AMP redirect, hygiene, and uBOL blocking engine.
 *
 ******************************************************************************/

// ── uBOL core imports (unchanged) ─────────────────────────────────────────
import * as scrmgr from './scripting-manager.js';
import {
  MODE_BASIC, MODE_OPTIMAL,
  getDefaultFilteringMode, getFilteringMode,
  persistHostPermissions,
  setDefaultFilteringMode, setFilteringMode,
  syncWithBrowserPermissions,
} from './mode-manager.js';
import { loadAdminConfig } from './admin.js';
import { hostnameFromMatch, hostnamesFromMatches } from './utils.js';

import {
  browser, localRead, localRemove, localWrite,
  runtime, sessionAccessLevel,
} from './ext.js';
import {
  loadRulesetConfig, process,
  rulesetConfig, saveRulesetConfig,
} from './config.js';
import {
  enableRulesets, patchDefaultRulesets,
  updateDynamicRules, updateSessionRules,
} from './ruleset-manager.js';
import { isSideloaded, toggleDeveloperMode, ubolErr, ubolLog } from './debug.js';
import { hasBroadHostPermissions } from './ext-utils.js';
import { dnr } from './ext-compat.js';
import { toggleToolbarIcon } from './action.js';

// ── CleanCopy AI imports ───────────────────────────────────────────────────
import { fullClean, detectAmp } from './url-cleaner.js';
import { bumpCleaned, bumpRedirects, bumpAmp, getStats } from './stats.js';
import { complete } from './ai.js';

/******************************************************************************/

const UBOL_ORIGIN = runtime.getURL('').replace(/\/$/, '').toLowerCase();
const canShowBlockedCount = typeof dnr.setExtensionActionOptions === 'function';
const { registerInjectables } = scrmgr;

let pendingPermissionRequest;

/******************************************************************************/
// ── Clipboard helper ───────────────────────────────────────────────────────
/******************************************************************************/

async function writeToClipboard(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: str => navigator.clipboard.writeText(str),
      args: [text],
    });
    return true;
  } catch { return false; }
}

function notify(message) {
  chrome.notifications.create('brief-notify', {
    type: 'basic', iconUrl: 'img/icon_128.png',
    title: 'Brief', message,
  });
}

/******************************************************************************/
// ── URL cleaning ───────────────────────────────────────────────────────────
/******************************************************************************/

async function handleCleanCopy(tab) {
  if (!tab?.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    notify('Cannot clean browser internal pages.'); return;
  }
  const result = fullClean(tab.url);
  const ok = await writeToClipboard(tab.id, result.cleaned);
  if (ok) {
    if (result.removed.length > 0) await bumpCleaned();
    if (result.steps.some(s => s.type === 'redirect')) await bumpRedirects();
    if (result.steps.some(s => s.type === 'amp')) await bumpAmp();
    const parts = [];
    if (result.removed.length > 0) parts.push(`${result.removed.length} tracker${result.removed.length > 1 ? 's' : ''} stripped`);
    if (result.steps.some(s => s.type === 'redirect')) parts.push('redirect bypassed');
    if (result.steps.some(s => s.type === 'amp')) parts.push('AMP resolved');
    notify(`Copied${parts.length ? ' — ' + parts.join(', ') : ' (already clean)'}`);
  } else {
    notify('Failed to copy — try again.');
  }
}

/******************************************************************************/
// ── AMP redirect via webNavigation ────────────────────────────────────────
/******************************************************************************/

chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  if (details.frameId !== 0) return;
  const canonical = detectAmp(details.url);
  if (!canonical || canonical === details.url) return;
  chrome.tabs.update(details.tabId, { url: canonical });
  await bumpAmp();
});

/******************************************************************************/
// ── Context menu ──────────────────────────────────────────────────────────
/******************************************************************************/

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // URL tools
    chrome.contextMenus.create({ id: 'cc-copy-clean-url', title: 'Copy Clean URL',  contexts: ['page', 'link'] });
    chrome.contextMenus.create({ id: 'cc-open-clean-url', title: 'Open Clean URL',  contexts: ['page', 'link'] });
    chrome.contextMenus.create({ id: 'cc-sep-1',          type:  'separator',       contexts: ['page'] });
    // Brief AI page actions
    chrome.contextMenus.create({ id: 'brief-summarize',   title: 'Brief: Summarize Page',    contexts: ['page'] });
    chrome.contextMenus.create({ id: 'brief-explain',     title: 'Brief: Explain Simply',    contexts: ['page'] });
    chrome.contextMenus.create({ id: 'brief-key-points',  title: 'Brief: Key Points',        contexts: ['page'] });
    chrome.contextMenus.create({ id: 'cc-sep-2',          type:  'separator',       contexts: ['selection'] });
    // Brief AI selection actions
    chrome.contextMenus.create({ id: 'brief-explain-sel', title: 'Brief: Explain This',      contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'brief-ask-sel',     title: 'Brief: Ask About This',    contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'brief-define-sel',  title: 'Brief: Define Word',       contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'brief-synonyms-sel',title: 'Brief: Find Synonyms',     contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'brief-code-sel',    title: 'Brief: Explain Code',      contexts: ['selection'] });
  });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
// Re-create menus on service worker restart (they are lost on worker termination)
chrome.runtime.onStartup.addListener(setupContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const rawUrl = info.linkUrl || tab.url;

  // ── URL tools ──
  if (info.menuItemId === 'cc-copy-clean-url') {
    if (!rawUrl) return;
    const r = fullClean(rawUrl);
    const ok = await writeToClipboard(tab.id, r.cleaned);
    if (ok) {
      if (r.removed.length > 0) await bumpCleaned();
      notify(r.removed.length > 0
        ? `Copied — ${r.removed.length} tracker${r.removed.length > 1 ? 's' : ''} stripped`
        : 'Copied (already clean)');
    }
    return;
  }
  if (info.menuItemId === 'cc-open-clean-url') {
    if (!rawUrl) return;
    const r = fullClean(rawUrl);
    chrome.tabs.create({ url: r.cleaned });
    if (r.removed.length > 0) await bumpCleaned();
    return;
  }

  // ── Brief AI page actions — store pending + open popup ──
  const PAGE_ACTIONS = {
    'brief-summarize':  'summarize',
    'brief-explain':    'explain',
    'brief-key-points': 'keyPoints',
  };
  if (PAGE_ACTIONS[info.menuItemId]) {
    await chrome.storage.session.set({ briefPendingAction: { type: PAGE_ACTIONS[info.menuItemId] } });
    chrome.action.openPopup?.().catch(() => {});
    return;
  }

  // ── Brief AI selection actions ──
  const selText = info.selectionText ?? '';
  const SEL_ACTIONS = {
    'brief-explain-sel':  'explainSelection',
    'brief-ask-sel':      'ask',
    'brief-define-sel':   'define',
    'brief-synonyms-sel': 'synonyms',
    'brief-code-sel':     'explainCode',
  };
  if (SEL_ACTIONS[info.menuItemId] && selText) {
    const type = SEL_ACTIONS[info.menuItemId];
    await chrome.storage.session.set({
      briefPendingAction: { type, selection: selText, prefill: type === 'ask' ? selText : undefined },
    });
    chrome.action.openPopup?.().catch(() => {});
    return;
  }
});

/******************************************************************************/
// ── Keyboard shortcut ──────────────────────────────────────────────────────
/******************************************************************************/

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'copy-clean-url') {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    await handleCleanCopy(active);
  }
  // 'toggle-popup' is handled natively by Chrome action command
});

/******************************************************************************/
// ── Message router ─────────────────────────────────────────────────────────
/******************************************************************************/

function onMessage(request, sender, callback) {
  const tabId   = sender?.tab?.id   ?? false;
  const frameId = tabId && (sender?.frameId ?? false);

  // ── Brief handlers ────────────────────────────────────────────────────
  switch (request.what) {

    case 'cc:getPopupData': {
      Promise.all([
        chrome.tabs.query({ active: true, currentWindow: true }),
        getStats(),
        hasBroadHostPermissions(),
      ]).then(async ([tabs, stats, hasOmnipotence]) => {
        const tab = tabs[0];
        let urlInfo = { original: tab?.url ?? '', cleaned: tab?.url ?? '', changed: false, removed: [], kept: [], steps: [] };
        if (tab?.url && !tab.url.startsWith('chrome://')) {
          urlInfo = fullClean(tab.url);
        }
        const hostname = tab?.url ? (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })() : '';
        const level = hostname ? await getFilteringMode(hostname).catch(() => 0) : 0;
        callback({ stats, urlInfo, tabId: tab?.id, tabUrl: tab?.url, tabTitle: tab?.title ?? '', level, hasOmnipotence });
      });
      return true;
    }

    case 'cc:copyCleanUrl': {
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        await handleCleanCopy(tab);
        callback({ ok: true });
      });
      return true;
    }

    case 'cc:openCleanUrl': {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab?.url) return;
        const r = fullClean(tab.url);
        chrome.tabs.update(tab.id, { url: r.cleaned });
        if (r.removed.length > 0) bumpCleaned();
        callback({ ok: true });
      });
      return true;
    }

    // ── Selection bubble relay ──────────────────────────────────────────
    case 'brief:setSelection': {
      const selText = request.selection ?? '';
      const action  = request.action  ?? 'explainSelection';
      if (selText) {
        // Map bubble actions to storage action types
        const typeMap = { explain: 'explainSelection', define: 'define', synonyms: 'synonyms', ask: 'ask', explainCode: 'explainCode' };
        chrome.storage.session.set({
          briefPendingAction: { type: typeMap[action] ?? action, selection: selText },
        });
      }
      return false;
    }

    case 'brief:openPopup': {
      chrome.action.openPopup?.().catch(() => {});
      return false;
    }

    case 'brief:getPendingAction': {
      chrome.storage.session.get('briefPendingAction').then(data => {
        const action = data.briefPendingAction ?? null;
        chrome.storage.session.remove('briefPendingAction'); // consume once
        callback({ action });
      });
      return true;
    }

    // ── Theme color storage ─────────────────────────────────────────────
    case 'brief:setThemeColor': {
      const { hex, source } = request;
      if (hex && /^#[0-9a-f]{3,8}$/i.test(hex)) {
        chrome.storage.session.set({ briefThemeColor: { hex, source } });
      }
      return false;
    }

    case 'brief:getThemeColor': {
      chrome.storage.session.get('briefThemeColor').then(data => {
        callback({ color: data.briefThemeColor ?? null });
      });
      return true;
    }

    // ── Focus Reading Mode ──────────────────────────────────────────────
    case 'brief:focusMode': {
      const enable = request.enable ?? true;
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id || !tab.url?.startsWith('http')) {
          callback({ ok: false }); return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [enable],
            func: (en) => window.__briefFocusMode?.(en) ?? false,
          });
          callback({ ok: true, active: results[0]?.result ?? false });
        } catch { callback({ ok: false }); }
      });
      return true;
    }

    case 'cc:ampRedirect': {
      const senderTabId = sender?.tab?.id;
      if (senderTabId && request.canonical && request.canonical !== sender?.url) {
        chrome.tabs.update(senderTabId, { url: request.canonical });
        bumpAmp();
      }
      return false;
    }

    case 'cc:extractPage': {
      // Inject extractor into active tab, return content
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id || !tab.url?.startsWith('http')) {
          callback({ error: 'Cannot extract this page.' }); return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Inline extractor — mirrors extractor.js (can't import in executeScript)
              const NOISE = [
                'script','style','noscript','iframe','svg','canvas',
                'header:not(article header)','footer:not(article footer)',
                'nav','[role="navigation"]','aside','[role="complementary"]',
                '[class*="cookie"]','[class*="popup"]','[class*="modal"]',
                '[class*="overlay"]','[class*="banner"]','[class*="advert"]',
                '[class*="social"]','[class*="share"]','[class*="comment"]',
                '[class*="related"]','[class*="sidebar"]','[class*="newsletter"]',
                '[class*="-ad-"]','[aria-label*="advertisement" i]',
                'form:not(article form)',
              ].join(',');
              const CONTENT = [
                'article','[role="main"]','main',
                '.post-content','.article-content','.entry-content',
                '.post-body','.article-body','.story-body',
                '#content','#main-content','#article-content',
              ].join(',');

              function scoreEl(el) {
                const c = el.cloneNode(true);
                try { c.querySelectorAll(NOISE).forEach(n => n.remove()); } catch {}
                const t = (c.innerText || c.textContent || '').trim();
                const words = t.split(/\s+/).filter(Boolean).length;
                if (words < 50) return -1;
                const links = c.querySelectorAll('a');
                let lc = 0; links.forEach(a => { lc += (a.textContent || '').length; });
                const lr = lc / Math.max(t.length, 1);
                if (lr > 0.5) return -1;
                return words - Math.round(words * lr * 2);
              }

              let best = null, bestScore = -1;
              document.querySelectorAll(CONTENT).forEach(el => {
                const s = scoreEl(el);
                if (s > bestScore) { bestScore = s; best = el; }
              });
              const root = best ?? document.body;
              const clone = root.cloneNode(true);
              try { clone.querySelectorAll(NOISE).forEach(e => e.remove()); } catch {}

              // Structured text with paragraph breaks
              const blocks = [];
              function walk(n) {
                if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g,' '); if (t.trim()) blocks.push(t); return; }
                if (n.nodeType !== 1) return;
                const tag = (n.tagName||'').toLowerCase();
                const isBlock = /^(p|div|section|blockquote|li|h[1-6]|pre|figure|figcaption)$/.test(tag);
                if (isBlock && blocks.length && blocks[blocks.length-1] !== '\n\n') blocks.push('\n\n');
                if (tag === 'br') { blocks.push('\n'); return; }
                n.childNodes.forEach(walk);
                if (isBlock) blocks.push('\n\n');
              }
              walk(clone);
              let text = blocks.join('').replace(/\n{3,}/g,'\n\n').trim();
              if (!text) text = (clone.textContent||'').replace(/\s+/g,' ').trim();

              const metaDesc = document.querySelector('meta[name="description"]')?.content?.trim() ?? '';
              const finalText = text.length < 80 && metaDesc ? metaDesc : text.slice(0, 6000);
              const excerpt = text.replace(/\n+/g,' ').slice(0,220).trim();

              return {
                title: document.title?.trim().slice(0, 200) ?? '',
                url: location.href,
                text: finalText,
                excerpt: excerpt || metaDesc.slice(0, 200),
                wordCount: text.split(/\s+/).filter(Boolean).length,
              };
            },
          });
          callback({ ok: true, data: results[0]?.result });
        } catch (err) {
          callback({ error: err.message });
        }
      });
      return true;
    }

    case 'cc:declutter': {
      const mode = request.mode ?? 'balanced';
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id || !tab.url?.startsWith('http')) {
          callback({ error: 'Cannot declutter this page.' }); return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [mode],
            func: (mode) => {
              const DECLUTTER = {
                minimal: ['[class*="cookie-banner"]','[class*="cookie-notice"]','.tp-modal','#tp-modal','.tp-backdrop','[class*="newsletter-popup"]','[class*="email-capture"]','.smartbanner','#smartbanner','[data-testid="OpenInApp"]','[class*="open-in-app"]'],
                balanced: ['[class*="cookie-banner"]','[class*="cookie-notice"]','.tp-modal','#tp-modal','.tp-backdrop','[class*="newsletter-popup"]','[class*="email-capture"]','.smartbanner','#smartbanner','[data-testid="OpenInApp"]','[class*="open-in-app"]','aside','[role="complementary"]','[class*="sidebar"]','[id*="sidebar"]','[class*="social-share"]','[class*="share-bar"]','[class*="related-posts"]','[class*="recommended"]','[class*="sticky-header"]','[class*="sticky-nav"]','.advertisement','[class*="ad-slot"]','[class*="ad-unit"]','[id*="ad-"]','[class*="sponsor"]'],
                aggressive: ['[class*="cookie-banner"]','[class*="cookie-notice"]','.tp-modal','#tp-modal','.tp-backdrop','[class*="newsletter-popup"]','[class*="email-capture"]','.smartbanner','#smartbanner','[data-testid="OpenInApp"]','[class*="open-in-app"]','aside','[role="complementary"]','[class*="sidebar"]','[id*="sidebar"]','[class*="social-share"]','[class*="share-bar"]','[class*="related-posts"]','[class*="recommended"]','[class*="sticky-header"]','[class*="sticky-nav"]','.advertisement','[class*="ad-slot"]','[class*="ad-unit"]','[id*="ad-"]','[class*="sponsor"]','header:not(article header)','footer:not(article footer)','nav','[role="navigation"]','[role="banner"]','[class*="toolbar"]','[class*="breadcrumb"]','[class*="pagination"]','[class*="comments"]','[id*="comments"]','form:not(article form)'],
              };
              const selectors = [...new Set(DECLUTTER[mode] ?? DECLUTTER.balanced)].join(',');
              let count = 0;
              document.querySelectorAll(selectors).forEach(el => {
                if (el._ccD) return; el._ccD = true;
                el.style.transition = 'opacity 0.22s, transform 0.22s';
                el.style.opacity = '0'; el.style.transform = 'scale(0.98)';
                el.style.pointerEvents = 'none';
                setTimeout(() => el.style.setProperty('display','none','important'), 240);
                count++;
              });
              if (mode !== 'minimal') {
                document.body.style.removeProperty('overflow');
                document.documentElement.style.removeProperty('overflow');
              }
              return { removed: count, mode };
            },
          });
          callback({ ok: true, data: results[0]?.result });
        } catch (err) {
          callback({ error: err.message });
        }
      });
      return true;
    }
  }

  if (sender.origin !== undefined && sender.origin.toLowerCase() !== UBOL_ORIGIN) return;

  // ── uBOL CSS-insertion (used by active content scripts) ───────────────────
  switch (request.what) {
    case 'insertCSS':
      if (frameId === false) return false;
      browser.scripting.insertCSS({ css: request.css, origin: 'USER', target: { tabId, frameIds: [frameId] } }).catch(r => ubolErr(`insertCSS/${r}`));
      return false;
    case 'removeCSS':
      if (frameId === false) return false;
      browser.scripting.removeCSS({ css: request.css, origin: 'USER', target: { tabId, frameIds: [frameId] } }).catch(r => ubolErr(`removeCSS/${r}`));
      return false;
    case 'toggleToolbarIcon':
      if (tabId) toggleToolbarIcon(tabId);
      return false;
    default: break;
  }

  return false;
}

/******************************************************************************/
// ── uBOL session startup (preserved) ──────────────────────────────────────
/******************************************************************************/

async function reloadTab(tabId, url = '') {
  return new Promise(resolve => {
    self.setTimeout(() => {
      if (url !== '') browser.tabs.update(tabId, { url });
      else browser.tabs.reload(tabId);
      resolve();
    }, 437);
  });
}

async function onPermissionGrantedThruExtension(details, origins) {
  await persistHostPermissions();
  const defaultMode = await getDefaultFilteringMode();
  if (defaultMode >= MODE_OPTIMAL) return;
  if (!Array.isArray(origins)) return;
  const hostnames = hostnamesFromMatches(origins);
  if (!hostnames.includes(details.hostname)) return;
  const beforeLevel = await getFilteringMode(details.hostname);
  if (beforeLevel === details.afterLevel) return;
  const afterLevel = await setFilteringMode(details.hostname, details.afterLevel);
  if (afterLevel !== details.afterLevel) return;
  await registerInjectables();
  if (rulesetConfig.autoReload === true) await reloadTab(details.tabId, details.url);
}

async function onPermissionGrantedThruBrowser(origins) {
  const modified = await syncWithBrowserPermissions();
  if (!modified) return;
  await registerInjectables();
  if (rulesetConfig.autoReload !== true || origins.length !== 1) return;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs?.[0]?.id;
  if (typeof tabId !== 'number' || tabId === -1) return;
  const results = await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => document.location.hostname }).catch(() => {});
  const tabHostname = results?.[0]?.result;
  if (typeof tabHostname !== 'string') return;
  const hostname = hostnameFromMatch(origins[0]);
  if (!tabHostname.endsWith(hostname)) return;
  const pos = tabHostname.length - hostname.length;
  if (pos !== 0 && tabHostname.charAt(pos - 1) !== '.') return;
  await reloadTab(tabId);
}

async function onPermissionsChanged(op, permissions) {
  await isFullyInitialized;
  const { pending } = onPermissionsChanged;
  await Promise.all(pending);
  const promise = op === 'removed'
    ? (async () => { const mod = await syncWithBrowserPermissions(); if (mod) registerInjectables(); return mod; })()
    : (op === 'added' ? (pendingPermissionRequest !== undefined ? onPermissionGrantedThruExtension(pendingPermissionRequest, permissions.origins ?? []) : onPermissionGrantedThruBrowser(permissions.origins ?? [])) : Promise.resolve());
  pendingPermissionRequest = undefined;
  pending.push(promise);
}
onPermissionsChanged.pending = [];

async function startSession() {
  const currentVersion = runtime.getManifest().version;
  const isNewVersion = currentVersion !== rulesetConfig.version;
  await loadAdminConfig();
  if (isNewVersion) {
    ubolLog(`Version change: ${rulesetConfig.version} => ${currentVersion}`);
    rulesetConfig.version = currentVersion;
    await patchDefaultRulesets();
    saveRulesetConfig();
  }
  const rulesetsUpdated = await enableRulesets(rulesetConfig.enabledRulesets);
  if (rulesetsUpdated === undefined) {
    if (isNewVersion) updateDynamicRules(); else updateSessionRules();
  }
  const permissionsUpdated = await syncWithBrowserPermissions();
  if (isNewVersion || permissionsUpdated || (isSideloaded && rulesetConfig.developerMode)) await registerInjectables();
  sessionAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  if (canShowBlockedCount) dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: rulesetConfig.showBlockedCount });
  if (process.firstRun) {
    const enableOptimal = await hasBroadHostPermissions();
    if (!enableOptimal) {
      const afterLevel = await setDefaultFilteringMode(MODE_BASIC);
      if (afterLevel === MODE_BASIC) { registerInjectables(); process.firstRun = false; }
    }
  }
}

async function start() {
  await loadRulesetConfig();
  if (process.wakeupRun === false) await startSession();
  else scrmgr.onWakeupRun();
  const scripts = await scrmgr.getRegisteredContentScripts();
  if (scripts.length === 0) registerInjectables();
  toggleDeveloperMode(rulesetConfig.developerMode);
}

const isFullyInitialized = start().then(() => {
  localRemove('goodStart'); return false;
}).catch(reason => {
  ubolErr(reason);
  if (process.wakeupRun) return;
  return localRead('goodStart').then(goodStart => {
    if (goodStart === false) { localRemove('goodStart'); return false; }
    return localWrite('goodStart', false).then(() => true);
  });
}).then(restart => { if (restart === true) runtime.reload(); });

// ── Spatial AI stream port connection ─────────────────────────────────────────
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'brief-ai-stream') {
    const controller = new AbortController();
    port.onDisconnect.addListener(() => {
      controller.abort();
    });
    port.onMessage.addListener(async msg => {
      try {
        const { messages, maxTokens } = msg;
        await complete(messages, {
          maxTokens: maxTokens || 350,
          signal: controller.signal,
          onChunk: (chunk) => {
            try {
              port.postMessage({ chunk });
            } catch {
              controller.abort();
            }
          }
        });
        try {
          port.postMessage({ done: true });
        } catch {}
      } catch (err) {
        if (err.name !== 'AbortError') {
          try {
            port.postMessage({ error: err.message || 'AI request failed' });
          } catch {}
        }
      }
    });
  }
});

runtime.onMessage.addListener((request, sender, callback) => {
  isFullyInitialized.then(() => { const r = onMessage(request, sender, callback); if (r !== true) callback(); });
  return true;
});

browser.permissions.onRemoved.addListener((...args) => { isFullyInitialized.then(() => onPermissionsChanged('removed', ...args)); });
browser.permissions.onAdded.addListener((...args) => { isFullyInitialized.then(() => onPermissionsChanged('added', ...args)); });
