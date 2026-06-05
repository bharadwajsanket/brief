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
    await chrome.storage.session.set({ briefPendingAction: { type: PAGE_ACTIONS[info.menuItemId], url: tab?.url } });
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
      briefPendingAction: { type, url: tab?.url, selection: selText, prefill: type === 'ask' ? selText : undefined },
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
        callback({ stats, urlInfo, tabId: tab?.id, tabUrl: tab?.url, tabTitle: tab?.title ?? '', favIconUrl: tab?.favIconUrl ?? '', level, hasOmnipotence });
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

    case 'brief:executeSelectionAction': {
      const selText = request.selection ?? '';
      const action  = request.action  ?? 'explainSelection';
      const sourceUrl = request.url   ?? sender?.tab?.url;
      if (selText) {
        chrome.storage.session.set({
          briefPendingAction: { type: action, selection: selText, url: sourceUrl },
        }).then(() => {
          chrome.action.openPopup?.().catch(() => {});
        });
      }
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
      // Site-aware extractor — GitHub, YouTube, Reddit, SO, Docs, Articles, Products
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id || !tab.url?.startsWith('http')) {
          callback({ error: 'Cannot extract this page.' }); return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async () => {
              const host = location.hostname.replace(/^www\./, '');

              // 1. Amazon / Flipkart / BestBuy / Product Pages
              const isProduct = host.includes('amazon.') || host.includes('flipkart.') || host.includes('bestbuy.') || document.querySelector('[itemtype*="Product"]') !== null;
              if (isProduct) {
                const parts = [];
                const title = document.querySelector('#productTitle, .title-product, h1.product-title, h1')?.textContent?.trim() || document.title;
                if (title) parts.push('Product Title: ' + title);

                const priceEl = document.querySelector('.a-price .a-offscreen, .priceToPay, .price-value, [data-price], .price, [class*="price"]');
                const price = priceEl?.textContent?.trim() || '';
                if (price) parts.push('Price: ' + price);

                const ratingEl = document.querySelector('#acrCustomerReviewText, .average-rating, .rating, [class*="rating"]');
                const rating = ratingEl?.textContent?.trim() || '';
                if (rating) parts.push('Rating: ' + rating);

                const featureEls = document.querySelectorAll('#feature-bullets li span, .product-features li, ul.features li, [class*="features"] li');
                const features = [...featureEls].map(el => el.textContent.trim()).filter(Boolean);
                if (features.length) {
                  parts.push('Key Features:\n' + features.slice(0, 10).map(f => '- ' + f).join('\n'));
                }

                const descEl = document.querySelector('#productDescription, .product-description, #description');
                const desc = descEl?.textContent?.trim() || '';
                if (desc) parts.push('Description:\n' + desc.slice(0, 1500));

                const text = parts.join('\n\n').trim();
                const finalText = text.length > 50 ? text : document.body.innerText.replace(/\s+/g,' ').trim().slice(0, 4000);
                return {
                  title: title || document.title,
                  url: location.href,
                  text: finalText.slice(0, 6000),
                  excerpt: finalText.slice(0, 220),
                  wordCount: finalText.split(/\s+/).filter(Boolean).length,
                  isProduct: true
                };
              }

              // 2. GitHub / GitLab
              if (host === 'github.com' || host === 'gitlab.com') {
                const parts = [];
                const isFileView = location.pathname.includes('/blob/');

                // 1. README
                const readme = document.querySelector('#readme article.markdown-body, #readme .markdown-body, article.markdown-body[class], div[data-target="readme-toc.content"] .markdown-body');
                if (readme) {
                  const c = readme.cloneNode(true);
                  c.querySelectorAll('script,style,svg,canvas,img[src*="shields.io"],img[src*="badge"],a.anchor').forEach(e => e.remove());
                  const readmeText = (c.innerText || c.textContent || '').replace(/\n{3,}/g,'\n\n').trim();
                  if (readmeText.length > 50) {
                    parts.push('README:\n' + readmeText.slice(0, 5000));
                  }
                }

                // 2. Description
                const desc = document.querySelector('[data-testid="repository-description"], p.f4.my-3, .repository-description, .BorderGrid-cell p.color-fg-muted');
                const descText = desc?.textContent?.trim();
                if (descText) parts.push('Description: ' + descText);

                // 3. Repository metadata (excluding stars UI, sidebar, navigation, chrome)
                const repoTitle = document.querySelector('strong[itemprop="name"] a, h1.d-flex a')?.textContent?.trim() || document.title.split(':')[0]?.trim();
                if (repoTitle) parts.push('Repository: ' + repoTitle);

                const langEls = document.querySelectorAll('li.d-inline-flex a[data-ga-click*="Repository, language"] span, li.d-inline-flex span:not([class])');
                const languages = [...langEls].map(el => el.textContent.trim()).filter(Boolean);
                if (languages.length) parts.push('Languages: ' + languages.join(', '));

                const topics = [...document.querySelectorAll('[data-octo-dimensions*="topic"], a.topic-tag, a[href*="/topics/"]')]
                  .map(t => t.textContent.trim()).filter(Boolean);
                if (topics.length) parts.push('Topics: ' + topics.slice(0, 8).join(', '));

                // 4. Current file & 5. Code blocks
                if (isFileView) {
                  const currentFile = document.querySelector('.final-path')?.textContent?.trim() || location.pathname.split('/').pop();
                  const currentPath = location.pathname;
                  parts.push(`Current File: ${currentFile}\nPath: ${currentPath}`);

                  const fileLines = document.querySelectorAll('.blob-code-inner, #read-only-cursor-text-area');
                  const code = [...fileLines].map(el => el.textContent).join('\n').trim().slice(0, 4500);
                  if (code) parts.push(`Code Content:\n${code}`);
                }

                const text = parts.join('\n\n').trim();
                const finalText = text.length > 50 ? text : document.body.innerText.replace(/\s+/g,' ').trim().slice(0, 4000);
                return {
                  title: document.title.trim().slice(0,200),
                  url: location.href,
                  text: finalText.slice(0, 6000),
                  excerpt: finalText.slice(0, 220),
                  wordCount: finalText.split(/\s+/).filter(Boolean).length
                };
              }

              // 3. YouTube
              if (host === 'youtube.com' || host === 'youtu.be') {
                let segs = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
                if (!segs.length) {
                  const expandButton = document.querySelector('#expand, ytd-text-inline-expander [role="button"]');
                  if (expandButton && expandButton.getAttribute('aria-expanded') !== 'true') {
                    expandButton.click();
                    await new Promise(r => setTimeout(r, 200));
                  }

                  const showTranscriptBtn = document.querySelector('button[aria-label*="transcript" i], ytd-button-renderer#trigger-button, tp-yt-paper-button[aria-label*="transcript" i]') ||
                    [...document.querySelectorAll('button, tp-yt-paper-button, ytd-button-renderer')].find(el => el.textContent?.toLowerCase().includes('transcript'));

                  if (showTranscriptBtn) {
                    showTranscriptBtn.click();
                    for (let i = 0; i < 15; i++) {
                      await new Promise(r => setTimeout(r, 100));
                      segs = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
                      if (segs.length) break;
                    }
                  }
                }

                const videoEl = document.querySelector('video');
                const durationSec = videoEl ? videoEl.duration : 0;
                let durationMins = durationSec ? Math.round(durationSec / 60) : 0;
                if (!durationMins) {
                  const durationMeta = document.querySelector('meta[itemprop="duration"]')?.getAttribute('content');
                  if (durationMeta) {
                    const m = durationMeta.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                    if (m) {
                      const hrs = parseInt(m[1] || '0', 10);
                      const mins = parseInt(m[2] || '0', 10);
                      durationMins = hrs * 60 + mins;
                    }
                  }
                }

                const parts = [];
                const vTitle = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, ytd-watch-metadata h1 yt-formatted-string')?.textContent?.trim() || document.title;
                if (vTitle) parts.push('Title: ' + vTitle);
                const channel = document.querySelector('ytd-channel-name a, ytd-video-owner-renderer #channel-name a')?.textContent?.trim() || '';
                if (channel) parts.push('Channel: ' + channel);
                const vDesc = document.querySelector('#description-inline-expander, #description-text, ytd-expandable-video-description-body-renderer')?.textContent?.trim() || document.querySelector('meta[name="description"]')?.content?.trim();
                if (vDesc) parts.push('Description:\n' + vDesc.slice(0, 1500));
                if (durationMins) parts.push(`Duration: ${durationMins} minutes`);

                segs = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
                if (segs.length) {
                  parts.push('Transcript:\n' + [...segs].map(s => s.textContent?.trim()).filter(Boolean).join(' ').slice(0, 4000));
                } else {
                  parts.push('Transcript:\nNo transcript available.');
                }
                const chapterEls = document.querySelectorAll('#panels ytd-chapter-renderer #title, ytd-macro-markers-list-item-renderer #headline');
                const chapters = [...chapterEls].map(c => c.textContent.trim()).filter(Boolean);
                if (chapters.length) parts.push('Chapters: ' + chapters.join(' | '));

                const hasTranscript = segs.length > 0;
                const hasChapters = chapters.length > 0;
                const text = parts.join('\n\n');
                return {
                  title: vTitle || document.title.trim(),
                  url: location.href,
                  text: text.slice(0, 6000),
                  excerpt: text.slice(0, 220),
                  wordCount: text.split(/\s+/).filter(Boolean).length,
                  hasTranscript,
                  hasChapters,
                  durationMins
                };
              }

              // 4. Reddit
              if (host === 'reddit.com' || host === 'old.reddit.com') {
                const parts = [];
                const pTitle = document.querySelector('shreddit-title')?.getAttribute('title')
                            || document.querySelector('[data-testid="post-title"], .Post h1, h1, .top-matter p.title a')?.textContent?.trim()
                            || document.title;
                if (pTitle) parts.push('Post Title: ' + pTitle);

                const pBody = document.querySelector('shreddit-post [slot="text-body"], [data-click-id="text"] div, .RichTextJSON-root, .usertext-body .md');
                const bodyText = pBody?.textContent?.trim();
                if (bodyText) parts.push('Post Body:\n' + bodyText.slice(0, 1500));

                const comments = [];
                const shredditComments = document.querySelectorAll('shreddit-comment');
                if (shredditComments.length) {
                  shredditComments.forEach(c => {
                    if (comments.length >= 15) return;
                    const author = c.getAttribute('author') || '';
                    const body = c.querySelector('[id*="-post-rtjson-content"], p');
                    const text = body?.textContent?.trim();
                    if (text && text.length > 5) {
                      comments.push(`- ${author ? author + ': ' : ''}${text.slice(0, 300)}`);
                    }
                  });
                } else {
                  const oldComments = document.querySelectorAll('.comment, [data-testid="comment"]');
                  oldComments.forEach(c => {
                    if (comments.length >= 15) return;
                    const body = c.querySelector('.usertext-body .md, .RichTextJSON-root');
                    const text = body?.textContent?.trim();
                    if (text && text.length > 5) {
                      comments.push(`- ${text.slice(0, 300)}`);
                    }
                  });
                }
                if (comments.length) parts.push('Top Comments:\n' + comments.join('\n'));

                const text = parts.join('\n\n').trim();
                return { title: pTitle || document.title, url: location.href, text: text.slice(0, 6000), excerpt: text.slice(0, 220), wordCount: text.split(/\s+/).filter(Boolean).length };
              }

              // 5. Stack Overflow / Stack Exchange
              if (host.includes('stackoverflow.com') || host.includes('stackexchange.com')) {
                const parts = [];
                const qTitle = document.querySelector('#question-header h1, h1[itemprop="name"]')?.textContent?.trim() || document.title;
                if (qTitle) parts.push('Question: ' + qTitle);
                const qBody = document.querySelector('.question .s-prose, .question .post-text');
                if (qBody?.textContent?.trim()) parts.push('Details:\n' + qBody.textContent.trim().slice(0, 800));
                const accepted = document.querySelector('.accepted-answer .s-prose, .accepted-answer .post-text');
                if (accepted) {
                  const code = [...accepted.querySelectorAll('pre code')].map(c => c.textContent.trim()).join('\n\n');
                  parts.push('Accepted answer:\n' + accepted.textContent.trim().slice(0, 1500));
                  if (code) parts.push('Code:\n```\n' + code.slice(0, 1500) + '\n```');
                }
                const topAns = document.querySelector('.answer:not(.accepted-answer) .s-prose');
                if (topAns) parts.push('Top answer:\n' + topAns.textContent.trim().slice(0, 600));
                const text = parts.join('\n\n') || document.body.innerText.slice(0, 4000);
                return { title: qTitle, url: location.href, text: text.slice(0, 6000), excerpt: text.slice(0, 220), wordCount: text.split(/\s+/).filter(Boolean).length };
              }

              // 6. Documentation
              const isDocsPage = host.startsWith('docs.') || host === 'developer.mozilla.org' || host.includes('readthedocs') || location.pathname.includes('/docs/');
              if (isDocsPage) {
                const docRoot = document.querySelector('article')
                             || document.querySelector('main')
                             || document.querySelector('[role="main"]')
                             || document.querySelector('.md-content, .rst-content, #main-content');
                if (docRoot) {
                  const cl = docRoot.cloneNode(true);
                  cl.querySelectorAll('nav, aside, footer, header, .sidebar, .toc, .table-of-contents, .navigation, .ads, script, style, [class*="nav"], [class*="sidebar"], [class*="toc"], [class*="footer"], [class*="header"], [class*="ads"], [class*="menu"]').forEach(e => e.remove());
                  const text = (cl.innerText || cl.textContent || '').replace(/\n{3,}/g,'\n\n').trim().slice(0, 6000);
                  const meta = document.querySelector('meta[name="description"]')?.content?.trim() ?? '';
                  return { title: document.title.trim().slice(0,200), url: location.href, text: text || meta, excerpt: text.slice(0, 220) || meta, wordCount: (text || meta).split(/\s+/).filter(Boolean).length };
                }
              }

              // 7. General article extractor
              const NOISE = [
                'script','style','noscript','iframe','svg','canvas',
                'header:not(article header)','footer:not(article footer)',
                'nav','[role="navigation"]','aside','[role="complementary"]',
                '#sidebar','.sidebar','[class*="sidebar"]','[class*="menu"]',
                '[class*="cookie"]','[class*="popup"]','[class*="modal"]',
                '[class*="overlay"]','[class*="banner"]','[class*="advert"]',
                '[class*="social"]','[class*="share"]','[class*="related"]',
                '[class*="newsletter"]','[class*="-ad-"]','[class*="promo"]',
                '[aria-label*="advertisement" i]','form:not(article form)',
                '[class*="recommend"]','[class*="toc"]','.toc','.table-of-contents'
              ].join(',');
              const CONTENT = [
                'article','[role="main"]','main',
                '.post-content','.article-content','.entry-content',
                '.post-body','.article-body','.story-body',
                '#content','#main-content','#article-content','.content-body',
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



runtime.onMessage.addListener((request, sender, callback) => {
  isFullyInitialized.then(() => { const r = onMessage(request, sender, callback); if (r !== true) callback(); });
  return true;
});

browser.permissions.onRemoved.addListener((...args) => { isFullyInitialized.then(() => onPermissionsChanged('removed', ...args)); });
browser.permissions.onAdded.addListener((...args) => { isFullyInitialized.then(() => onPermissionsChanged('added', ...args)); });
