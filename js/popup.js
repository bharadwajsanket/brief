/*
 * Brief — popup.js v4.5.0
 * Apple-style premium visual companion for the browser.
 * All AI runs through local llama.cpp at 127.0.0.1:8080 (Local AI).
 * Integrates URL cleaning, Declutter reader mode, and local LLM chat.
 */

import { download } from './export.js';
import { generateQR, downloadQR } from './qr.js';
import { detectSiteContext } from './site-context.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const LLAMA_URL  = 'http://127.0.0.1:8080/v1/chat/completions';
const HEALTH_URL = 'http://127.0.0.1:8080/health';
const TIMEOUT_MS = 28000;

// Per-task token budgets
const TOKENS = {
  summarize: 320, keyPoints: 280, explain: 200,
  tldr: 80, ask: 350, explainSelection: 220,
  define: 150, synonyms: 120, explainCode: 250, summarizeDiscussion: 350,
  followUp: 350, summarizeSelection: 240, simplifySelection: 200,
  findBug: 280, keyTakeaways: 280, timelineSummary: 350,
  communityConsensus: 300, argumentsFor: 250, argumentsAgainst: 250,
  explainRepo: 320, explainSolution: 280, simplerExplanation: 220,
  keyFix: 200, explainDocsConcepts: 300, beginnerExplanation: 280,
  whatDoesThisCodeDo: 280,
};

// ── DOM ────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const pageHost       = $('pageHost');
const statusDot      = $('statusDot');
const modelLabel     = $('modelLabel');

const offlineCard    = $('offlineCard');
const btnReconnect   = $('btnReconnect');

const btnSummarize   = $('btnSummarize');
const btnSecondary1  = $('btnSecondary1');
const btnSecondary2  = $('btnSecondary2');
const btnSecondary3  = $('btnSecondary3');
const askInput       = $('askInput');
const askSend        = $('askSend');
const responseWrap   = $('responseWrap');
const responseTag    = $('responseTag');
const responseBody   = $('responseBody');
const responseCopy   = $('responseCopy');
const exportToggle   = $('exportToggle');
const exportMenu     = $('exportMenu');
const exportCopyMd   = $('exportCopyMd');
const exportCopyPlain= $('exportCopyPlain');
const exportMd       = $('exportMd');
const exportJson     = $('exportJson');
const exportAllInsights = $('exportAllInsights');

const followUpChips  = $('followUpChips');
const followUpRow    = $('followUpRow');

const urlOriginal    = $('urlOriginal');
const urlCleaned     = $('urlCleaned');
const diffRow        = $('diffRow');
const btnCopy        = $('btnCopy');
const btnCopyLabel   = $('btnCopyLabel');
const btnOpen        = $('btnOpen');
const btnQrToggle    = $('btnQrToggle');
const qrSection      = $('qrSection');
const qrCanvas       = $('qrCanvas');
const qrDownload     = $('qrDownload');
const modKey         = $('modKey');

const btnDeclutter    = $('btnDeclutter');
const declutterResult = $('declutterResult');
const btnFocus        = $('btnFocus');

const saveTakeaway    = $('saveTakeaway');
const takeawayStrip   = $('takeawayStrip');
const takeawayChips   = $('takeawayChips');
const takeawayClear   = $('takeawayClear');

const aboutStrip      = $('aboutStrip');
const aboutBtn        = $('aboutBtn');

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  tabId:         null,
  tabUrl:        null,
  tabTitle:      '',
  favIconUrl:    '',
  urlInfo:       null,
  aiOnline:      false,
  pageContent:   null,
  aiActive:      false,
  declutterMode: 'balanced',
  focusActive:   false,
  lastResponse:  null,   // { tag, text, url, title } for export
  insights:      [],     // session-only
  context:       null,   // lightweight conversational context
  siteContext:   null,   // current site context
  readTimeStr:   '',
  difficultyStr: '',
};

function invalidateCache() {
  console.log('[Brief] Invalidate cache & context.');
  state.pageContent = null;
  state.context = null;
  state.lastResponse = null;
  if (typeof updateContextUI === 'function') updateContextUI();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === state.tabId) {
    if (tab.url && !urlsMatch(state.tabUrl, tab.url)) {
      console.log('[Brief] Tab URL changed (onUpdated), invalidating cache:', tab.url);
      invalidateCache();
      state.tabUrl = tab.url;
      state.tabTitle = tab.title ?? '';
      state.favIconUrl = tab.favIconUrl ?? '';
      updateHeaderSubtitle();
      if (state.favIconUrl && !state.favIconUrl.startsWith('chrome://')) {
        pageFavicon.src = state.favIconUrl;
        pageFavicon.style.display = 'block';
      } else {
        pageFavicon.style.display = 'none';
      }
      if (typeof applyContextWording === 'function') applyContextWording(tab.url);
    }
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  invalidateCache();
  chrome.tabs.get(activeInfo.tabId).then(tab => {
    if (!tab) return;
    state.tabId = tab.id;
    state.tabUrl = tab.url;
    state.tabTitle = tab.title ?? '';
    state.favIconUrl = tab.favIconUrl ?? '';
    updateHeaderSubtitle();
    if (state.favIconUrl && !state.favIconUrl.startsWith('chrome://')) {
      pageFavicon.src = state.favIconUrl;
      pageFavicon.style.display = 'block';
    } else {
      pageFavicon.style.display = 'none';
    }
    if (typeof applyContextWording === 'function') applyContextWording(tab.url);
    getPageContent().catch(() => null);
  }).catch(() => null);
});

const pageFavicon  = $('pageFavicon');
const tabIndicator = $('tabIndicator');

function getCleanSiteName(url, defaultHost) {
  if (!url) return defaultHost || 'This page';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const mappings = {
      'github.com': 'GitHub',
      'gitlab.com': 'GitLab',
      'youtube.com': 'YouTube',
      'youtu.be': 'YouTube',
      'reddit.com': 'Reddit',
      'stackoverflow.com': 'Stack Overflow',
      'stackexchange.com': 'Stack Exchange',
      'developer.mozilla.org': 'MDN Web Docs',
      'amazon.com': 'Amazon',
      'wikipedia.org': 'Wikipedia'
    };
    for (const [pattern, name] of Object.entries(mappings)) {
      if (host === pattern || host.endsWith('.' + pattern)) return name;
    }
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    return defaultHost || 'This page';
  }
}

function updateHeaderSubtitle() {
  const cleanName = getCleanSiteName(state.tabUrl, state.tabTitle);
  let parts = [cleanName];
  if (state.siteContext?.type === 'video') {
    parts.push(state.readTimeStr || 'Video');
  } else if (state.siteContext?.type === 'product' || state.readTimeStr === 'Product Page') {
    parts.push('Product Page');
  } else {
    if (state.readTimeStr) parts.push(state.readTimeStr);
    if (state.difficultyStr) parts.push(state.difficultyStr);
  }
  pageHost.textContent = parts.join(' • ');
}

function updateTabIndicator(activeTab) {
  if (!tabIndicator || !activeTab) return;
  tabIndicator.style.left  = activeTab.offsetLeft + 'px';
  tabIndicator.style.width = activeTab.offsetWidth + 'px';
}

// ── Tab switching ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    $(`panel-${tab.dataset.tab}`).classList.add('active');
    updateTabIndicator(tab);
    closeExportMenu();
  });
});

// ── Platform key ───────────────────────────────────────────────────────────────
if (modKey) modKey.textContent = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';

// ── AI health check ────────────────────────────────────────────────────────────
async function checkAiHealth() {
  statusDot.className = 'status-dot checking';
  modelLabel.textContent = 'checking';
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    state.aiOnline = res.ok;
  } catch {
    state.aiOnline = false;
  }

  statusDot.className = `status-dot ${state.aiOnline ? 'online' : 'offline'}`;
  modelLabel.textContent = 'Brief AI';

  // Show/hide offline card
  if (offlineCard) {
    offlineCard.classList.toggle('visible', !state.aiOnline);
  }
}

// ── Reconnect button ───────────────────────────────────────────────────────────
if (btnReconnect) {
  btnReconnect.addEventListener('click', async () => {
    btnReconnect.textContent = '…';
    btnReconnect.disabled = true;
    await checkAiHealth();
    btnReconnect.textContent = 'Reconnect';
    btnReconnect.disabled = false;
  });
}

// ── About toggle ───────────────────────────────────────────────────────────────
if (aboutBtn) {
  aboutBtn.addEventListener('click', () => {
    aboutStrip.classList.toggle('visible');
  });
}

// ── Page extraction (via background) ──────────────────────────────────────────
async function getPageContent() {
  if (state.pageContent) return state.pageContent;
  const res = await chrome.runtime.sendMessage({ what: 'cc:extractPage' });
  if (!res?.ok || !res.data?.text) throw new Error('No content extracted.');
  state.pageContent = res.data;

  // Debug: verify extraction quality
  console.log('[Brief] Extracted content:', (state.pageContent.text ?? '').slice(0, 500));
  console.log('[Brief] Has transcript:', !!state.pageContent.hasTranscript, '| Word count:', state.pageContent.wordCount);

  // Compute reading intelligence
  computeReadingIntel(state.pageContent);

  // For YouTube: hide Timeline Summary if no transcript
  if (state.siteContext?.type === 'video') {
    updateTimelineButtonVisibility(state.pageContent);
  }

  return state.pageContent;
}

// Show/hide Timeline Summary pill based on transcript availability
function updateTimelineButtonVisibility(page) {
  const hasTimelineData = page.hasTranscript || page.hasChapters;

  // Find the Timeline Summary secondary button
  const pills = [btnSecondary1, btnSecondary2, btnSecondary3];
  pills.forEach(btn => {
    if (!btn) return;
    if (btn.dataset.aiType === 'timelineSummary') {
      if (!hasTimelineData) {
        btn.style.display = 'none';
      } else {
        btn.style.display = '';
        btn.disabled = false;
        btn.style.opacity = '';
        btn.title = '';
      }
    }
  });
}

// ── Reading Intelligence ───────────────────────────────────────────────────────
function computeReadingIntel(page) {
  const ctx = state.siteContext;
  const isProduct = (ctx && ctx.type === 'product') || page.isProduct || page.url?.includes('amazon.') || page.url?.includes('flipkart.com') || page.url?.includes('bestbuy.com');

  // 1. Amazon / Product Page: No read time
  if (isProduct) {
    state.readTimeStr = 'Product Page';
    state.difficultyStr = '';
    updateHeaderSubtitle();
    return;
  }

  // 2. YouTube / Video Page: actual video duration
  const isVideo = (ctx && ctx.type === 'video') || page.url?.includes('youtube.com') || page.url?.includes('youtu.be');
  if (isVideo) {
    if (page.durationMins) {
      state.readTimeStr = `${page.durationMins} min video`;
    } else {
      state.readTimeStr = 'Video';
    }
    state.difficultyStr = '';
    updateHeaderSubtitle();
    return;
  }

  // 3. GitHub Page: README words / 200
  const isGithub = (ctx && ctx.type === 'github') || page.url?.includes('github.com') || page.url?.includes('gitlab.com');
  if (isGithub) {
    const readmeMatch = page.text?.match(/README:\n([\s\S]+)/);
    const readmeText = readmeMatch ? readmeMatch[1] : page.text;
    const wc = readmeText ? readmeText.split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.round(wc / 200));
    state.readTimeStr = `${mins} min`;
    state.difficultyStr = '';
    updateHeaderSubtitle();
    return;
  }

  const text = (page.text ?? '').trim();
  if (!text || text.length < 50) return;

  const words = text.split(/\s+/).filter(Boolean);
  const wc = words.length;

  // 4. Documentation Page: words / 180
  const isDocs = (ctx && ctx.type === 'docs') || page.url?.includes('docs.') || page.url?.includes('developer.mozilla.org') || page.url?.includes('readthedocs') || page.url?.includes('/docs/');
  let mins;
  if (isDocs) {
    mins = Math.max(1, Math.round(wc / 180));
  } else {
    // 5. Articles / Others: words / 225
    mins = Math.max(1, Math.round(wc / 225));
  }

  // Difficulty heuristic
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const avgSentenceLen = sentences.length > 0 ? wc / sentences.length : 15;
  const avgWordLen = words.reduce((s, w) => s + w.replace(/[^a-z]/gi,'').length, 0) / Math.max(wc, 1);

  let difficulty = 'Easy';
  if (avgSentenceLen > 25 || avgWordLen > 7) difficulty = 'Advanced';
  else if (avgSentenceLen > 15 || avgWordLen > 5.5) difficulty = 'Medium';

  state.readTimeStr = `${mins} min`;
  state.difficultyStr = difficulty;
  updateHeaderSubtitle();
}

// ── Streaming AI ───────────────────────────────────────────────────────────────
async function streamAI(messages, maxTokens, onChunk) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const res = await fetch(LLAMA_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: 'local', messages,
      temperature: 0.35,
      max_tokens:  maxTokens,
      stream:      true,
    }),
    signal: ctrl.signal,
  });

  clearTimeout(timer);
  if (!res.ok) throw new Error(`AI error ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   full    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const json = t.slice(5).trim();
      if (json === '[DONE]') break;
      try {
        const delta = JSON.parse(json)?.choices?.[0]?.delta?.content ?? '';
        if (delta) { full += delta; onChunk(delta); }
      } catch {}
    }
  }
  return full;
}

// ── Markdown-light renderer ────────────────────────────────────────────────────
function renderResponse(text) {
  responseBody.innerHTML = '';
  const lines = text.split('\n');
  let   buffer = document.createDocumentFragment();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      buffer.appendChild(document.createElement('br'));
      continue;
    }
    if (/^[-•]\s+/.test(line)) {
      const span = document.createElement('span');
      span.className = 'resp-bullet';
      span.textContent = '• ' + line.replace(/^[-•]\s+/, '');
      buffer.appendChild(span);
      continue;
    }
    const span = document.createElement('span');
    renderInline(line, span);
    span.appendChild(document.createTextNode(' '));
    buffer.appendChild(span);
  }

  responseBody.appendChild(buffer);
}

function renderInline(text, container) {
  const tokenRegex = /(\*\*(.*?)\*\*|`(.*?)`|\[(.*?)\]\((.*?)\)|(https?:\/\/[^\s)\]]+))/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
    }

    const [full, boldFull, boldText, codeText, linkText, linkUrl, rawUrl] = match;

    if (boldFull !== undefined) {
      const b = document.createElement('b');
      b.textContent = boldText;
      container.appendChild(b);
    } else if (codeText !== undefined) {
      const code = document.createElement('code');
      code.className = 'code-inline';
      code.textContent = codeText;
      code.title = 'Click to copy';
      code.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codeText);
          const orig = code.textContent;
          code.textContent = 'Copied!';
          code.classList.add('copied');
          setTimeout(() => {
            code.textContent = orig;
            code.classList.remove('copied');
          }, 1000);
        } catch {}
      });
      container.appendChild(code);
    } else if (linkUrl !== undefined) {
      const a = document.createElement('a');
      a.className = 'resp-link';
      a.href = linkUrl;
      a.target = '_blank';
      a.textContent = linkText;
      container.appendChild(a);
    } else if (rawUrl !== undefined) {
      let cleanUrl = rawUrl;
      let trailing = '';
      const puncMatch = rawUrl.match(/[.,;:!?'")\]]+$/);
      if (puncMatch) {
        cleanUrl = rawUrl.slice(0, -puncMatch[0].length);
        trailing = puncMatch[0];
      }
      const a = document.createElement('a');
      a.className = 'resp-link';
      a.href = cleanUrl;
      a.target = '_blank';
      a.textContent = cleanUrl;
      container.appendChild(a);
      if (trailing) {
        container.appendChild(document.createTextNode(trailing));
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.substring(lastIndex)));
  }
}

// ── Streaming cursor ───────────────────────────────────────────────────────────
let cursorEl = null;
function addCursor() {
  cursorEl = document.createElement('span');
  cursorEl.className = 'cursor';
  responseBody.appendChild(cursorEl);
}
function removeCursor() { cursorEl?.remove(); cursorEl = null; }

// ── Prompts ────────────────────────────────────────────────────────────────────
const SYS = 'You are Brief, a concise browser reading assistant. Plain text only — no asterisks, no markdown headers. Be direct and specific. Never hallucinate.';

function ctx(page) {
  const t = (page.text ?? '').trim().slice(0, 4500);
  let hostname = '';
  try { hostname = new URL(page.url).hostname; } catch {}
  return `Title: "${page.title ?? ''}"\nURL: "${page.url ?? ''}"\nHostname: "${hostname}"\n\n${t}`;
}

const PROMPTS = {
  summarize:    p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nSummarize in exactly 4 bullet points. Start each with "- ". One sentence per bullet. Cover the most important ideas.` }],
  keyPoints:    p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nList 4 specific key facts or takeaways. Start each with "- ". Be concrete — include names, numbers, decisions where present.` }],
  explain:      p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain what this page is about in 2 clear sentences. Plain language, no jargon.` }],
  tldr:         p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nOne-sentence TL;DR. Start with the subject directly. Max 25 words.` }],
  ask:          (p, q) => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nQuestion: ${q}\n\nAnswer using only the content above. Under 3 sentences. If not found, say: "Not covered on this page."` }],
  productSummary: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nProvide: 1) A brief Product Summary. 2) A list of Pros. 3) A list of Cons. Plain text only. Use "- " for list items.` }],

  explainSelection: s => [{ role:'system', content:SYS }, { role:'user', content:`Selected text:\n"${s.slice(0, 1200)}"\n\nExplain what this means in plain language. 2–3 sentences max. No bullets.` }],
  define:       w => [{ role:'system', content:SYS }, { role:'user', content:`Word or phrase: "${w.slice(0,80)}"\n\nProvide: 1) A clear one-sentence definition. 2) One natural example sentence. Keep it simple. No headers, no bullets. Two sentences total.` }],
  synonyms:     w => [{ role:'system', content:SYS }, { role:'user', content:`Word: "${w.slice(0,80)}"\n\nList 4 synonyms and 2 antonyms. Exact format:\nSynonyms: word1, word2, word3, word4\nAntonyms: word1, word2\nNothing else.` }],
  explainCode:  s => [{ role:'system', content:SYS }, { role:'user', content:`Code:\n\`\`\`\n${s.slice(0,1500)}\n\`\`\`\n\nExplain what this code does in plain English. 2–3 sentences. No bullets. Mention the language if obvious.` }],
  findBug:      s => [{ role:'system', content:SYS }, { role:'user', content:`Code:\n\`\`\`\n${s.slice(0,1500)}\n\`\`\`\n\nIdentify any bugs, issues, or potential problems. Be specific. If no bugs found, say so. Under 4 sentences.` }],
  summarizeDiscussion: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nThis is a discussion or comment thread. Summarize the main viewpoints. Write exactly 3 bullet points starting with "- ". Be specific — include key opinions, not just the topic.` }],
  summarizeSelection: s => [{ role:'system', content:SYS }, { role:'user', content:`Text:\n"${s.slice(0, 3000)}"\n\nSummarize this text in 2-3 concise sentences. Plain text only.` }],
  simplifySelection: s => [{ role:'system', content:SYS }, { role:'user', content:`Text:\n"${s.slice(0, 3000)}"\n\nRewrite this in simpler language (maximum 3 sentences). Plain text only.` }],

  // Site-mode specific
  keyTakeaways:     p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nList the 5 most important takeaways. Start each with "- ". Be concrete and specific.` }],
  timelineSummary:  p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nCreate a brief timeline or chapter-by-chapter summary using only the provided video transcript or chapters. Use "- [timestamp/section]: point" format. List up to 6 entries. Never fabricate timestamps. Never hallucinate timeline sections. If transcript is unavailable and there are no chapters, write "No transcript available." and nothing else.` }],
  communityConsensus: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nWhat is the overall community consensus or majority opinion in this discussion? 2 sentences. Be honest if opinion is split.` }],
  argumentsFor:     p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nList the strongest arguments FOR the main position in this discussion. 3 bullet points starting with "- ". Be specific.` }],
  argumentsAgainst: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nList the strongest arguments AGAINST the main position in this discussion. 3 bullet points starting with "- ". Be specific.` }],
  explainRepo:      p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain what this GitHub repository does. What problem does it solve? Who is it for? 3 sentences max. Plain language.` }],
  whatDoesThisCodeDo: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain what this code does in plain English. Focus on purpose, inputs, and outputs. 2–3 sentences.` }],
  explainSolution:  p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain the accepted solution to this Stack Overflow question in plain English. What does it do and why does it work? 3 sentences max.` }],
  simplerExplanation: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain the solution to this question as if to a beginner who just started programming. Avoid jargon. 2–3 sentences.` }],
  keyFix:           p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nWhat is the single most important fix or change suggested in this answer? One sentence. Be direct.` }],
  explainDocsConcepts: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nWhat are the 3 most important concepts explained on this documentation page? Use "- " bullets. One sentence each.` }],
  beginnerExplanation: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain this documentation page as if to someone completely new to the subject. Simple language, no jargon. 3 sentences max.` }],
};

const dynamicSuggestionsCache = {};

async function getDynamicSuggestions(page) {
  const url = page.url || state.tabUrl;
  if (!url) return null;
  if (dynamicSuggestionsCache[url]) {
    return dynamicSuggestionsCache[url];
  }

  try {
    const sys = 'You are a helpful reading assistant. Generate exactly 4 short, contextual follow-up topic suggestions or question prompts based on the provided page text. Each suggestion must be under 3 words. Return them as a single line separated only by commas, without numbering or quotes. Example: "Why it matters, Tech stack, Key issues, Alternatives"';
    const userPrompt = `${ctx(page)}\n\nGenerate 4 short follow-up topic suggestions based on the text above:`;
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userPrompt }
    ];

    let full = '';
    await streamAI(messages, 45, delta => {
      full += delta;
    });

    const parsed = full
      .split(',')
      .map(s => s.trim().replace(/^\d+\.\s*/, '').replace(/^["'*\s]+|["'*\s]+$/g, ''))
      .filter(s => s.length > 0 && s.length < 28)
      .slice(0, 4);

    if (parsed.length >= 2) {
      dynamicSuggestionsCache[url] = parsed;
      return parsed;
    }
  } catch (e) {
    console.warn('[Brief] Error generating dynamic suggestions:', e);
  }
  return null;
}

function getFollowUpPrompt(label, page) {
  const t = label.toLowerCase();
  const title = (page.title ?? '').trim();
  
  let query = '';
  
  // YouTube
  if (t.includes('explain:') || t.includes('explain video')) {
    query = `Explain what this video ("${title}") is about in 3 clear sentences. Plain language, no jargon.`;
  } else if (t.includes('key facts')) {
    query = `List 4 key facts or takeaways from this video. Start each with "- ".`;
  } else if (t.includes('about ')) {
    query = `Summarize what is mentioned in this video description about the creator or channel. Under 3 sentences.`;
  } else if (t.includes('chapters')) {
    query = `Provide a list and description of the main chapters or sections of this video based on the chapter info.`;
  }
  
  // GitHub
  else if (t.includes('tech stack')) {
    query = `Based on the repository metadata and README, what is the tech stack, libraries, and languages used in this project?`;
  } else if (t.includes('how to run')) {
    query = `Based on the README, what are the steps to build, install, or run this repository? Keep it extremely brief.`;
  } else if (t.includes('explain codebase')) {
    query = `Explain the architecture or main purpose of the codebase in this repository. 3 sentences max.`;
  }
  
  // Product
  else if (t.includes('pros & cons')) {
    query = `Give a balanced list of the main pros and cons of this product. Keep it brief.`;
  } else if (t.includes('worth it?')) {
    query = `Analyze if this product is worth buying based on the specs, features, price, and customer rating. 3 sentences.`;
  } else if (t.includes('alternatives')) {
    query = `What are the typical alternatives or competing products to this product? 2-3 sentences.`;
  } else if (t.includes('specs') || t.includes('specifications')) {
    query = `List the key technical specs of this product. Use bullet points.`;
  }
  
  // Reddit / Discussions
  else if (t.includes('consensus')) {
    query = `What is the overall consensus or majority opinion among the comments in this discussion? 2-3 sentences.`;
  } else if (t.includes('comments')) {
    query = `Summarize the main points and topics raised by users in the comment section. 3 sentences.`;
  } else if (t.includes('top opinions')) {
    query = `List the 3 most prominent or widely held opinions in this thread. Use "- ".`;
  }
  
  // Docs
  else if (t.includes('concepts')) {
    query = `What are the 3 most important concepts or APIs explained on this documentation page? One sentence each.`;
  } else if (t.includes('quick start') || t.includes('code')) {
    query = `Provide a quick start summary or code example of how to use the API/library described here.`;
  } else if (t.includes('pitfalls')) {
    query = `What are the most common pitfalls, errors, or warnings to watch out for on this page? Under 3 sentences.`;
  }
  
  // General / News
  else if (t.includes('why it matters') || t.includes('why this matters')) {
    query = `Explain why the events or topics in this article matter and what the broader impact is. Under 3 sentences.`;
  } else if (t.includes('takeaways') || t.includes('key takeaways')) {
    query = `List the 3 most important takeaways from this article. Start each with "- ".`;
  } else if (t.includes('simpler')) {
    query = `Explain the main concept or news in this article in extremely simple terms (like for a 10-year-old). 2 sentences.`;
  } else if (t.includes('example')) {
    query = `Give a concrete, real-world example that illustrates the main subject of this page. 2 sentences.`;
  }
  
  else {
    query = `Answer: ${label} based strictly on the page content.`;
  }
  
  return `${ctx(page)}\n\nQuestion or Command: ${query}`;
}

function renderFollowUpChips(aiType) {
  if (!followUpRow || !followUpChips) return;
  followUpRow.innerHTML = '';

  const page = state.pageContent;
  if (!page) return;

  const url = page.url || state.tabUrl;

  const renderChipsList = (list) => {
    if (!followUpRow || !followUpChips) return;
    followUpRow.innerHTML = '';
    list.forEach((label, i) => {
      const chip = document.createElement('button');
      chip.className = 'followup-chip';
      chip.textContent = label;
      chip.style.animationDelay = `${i * 40}ms`;
      chip.addEventListener('click', () => {
        runFollowUpChip(label);
      });
      followUpRow.appendChild(chip);
    });
    followUpChips.classList.add('visible');
  };

  // If we already have cached dynamic suggestions, render them and exit
  if (url && dynamicSuggestionsCache[url]) {
    renderChipsList(dynamicSuggestionsCache[url]);
    return;
  }

  const ctxVal = state.siteContext;
  const cleanTitle = (page.title ?? '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\|.*$/, '')
    .trim()
    .slice(0, 16);

  let pool = [];
  const isVideo = ctxVal?.type === 'video' || page.url?.includes('youtube.com') || page.url?.includes('youtu.be');
  const isGithub = ctxVal?.type === 'github' || page.url?.includes('github.com') || page.url?.includes('gitlab.com');
  const isProduct = ctxVal?.type === 'product' || page.isProduct || page.url?.includes('amazon.com') || page.url?.includes('flipkart.com') || page.url?.includes('bestbuy.com');
  const isDiscuss = ctxVal?.type === 'discuss' || page.url?.includes('reddit.com') || page.url?.includes('stackoverflow.com');
  const isDocs = ctxVal?.type === 'docs' || page.url?.includes('/docs/') || page.url?.includes('developer.mozilla.org');

  if (isVideo) {
    pool = [`Explain: ${cleanTitle}`, `Key facts`, page.channel ? `About ${page.channel}` : `Channel details`, page.hasChapters ? `Chapters` : `Simpler`];
  } else if (isGithub) {
    pool = [`Tech stack`, `How to run`, `Explain codebase`, `Simpler`];
  } else if (isProduct) {
    pool = [`Pros & Cons`, `Worth it?`, `Alternatives`, `Specs`];
  } else if (isDiscuss) {
    pool = [`Consensus`, `Comments`, `Top opinions`, `Why it matters`];
  } else if (isDocs) {
    pool = [`Concepts`, `Quick start code`, `Pitfalls`, `Simpler`];
  } else {
    pool = [`Why it matters`, `Takeaways`, `Simpler`, `Example`];
  }

  const shown = pool.slice(0, 4);
  renderChipsList(shown);

  if (url && state.aiOnline) {
    getDynamicSuggestions(page).then(dynamicList => {
      if (dynamicList && dynamicList.length >= 2) {
        const currentPage = state.pageContent;
        if (currentPage && (currentPage.url === url || state.tabUrl === url)) {
          renderChipsList(dynamicList);
        }
      }
    });
  }
}

async function runFollowUpChip(label) {
  if (state.aiActive) return;
  if (!state.aiOnline) { showOfflineError(); return; }

  state.aiActive = true;
  setAllAiDisabled(true);
  responseTag.textContent = label;
  responseBody.innerHTML  = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:68%"></div>';
  responseWrap.classList.add('visible');
  followUpChips.classList.remove('visible');
  saveTakeaway.style.display = 'none';

  try {
    state.pageContent = null; // force fresh extraction
    const page = await getPageContent();
    if (!page?.text?.trim()) throw new Error('Page has no readable content.');

    // Print required console.log statements before AI request
    console.log('[Brief] URL:', page.url);
    console.log('[Brief] Title:', page.title);
    console.log('[Brief] Text Length:', page.text.length);
    console.log('[Brief] Preview:', page.text.slice(0, 300));

    const promptText = getFollowUpPrompt(label, page);
    const messages = [{ role:'system', content:SYS }, { role:'user', content:promptText }];

    responseBody.innerHTML = '';
    addCursor();
    let full = '';
    await streamAI(messages, TOKENS.followUp, delta => {
      removeCursor();
      full += delta;
      renderResponse(full);
      responseBody.scrollTop = responseBody.scrollHeight;
      addCursor();
    });
    removeCursor();
    if (!full.trim()) throw new Error('Empty response.');
    renderResponse(full);
    state.lastResponse = { tag: label, text: full, url: state.tabUrl ?? '', title: state.tabTitle ?? '' };
    saveTakeaway.textContent = 'Save';
    saveTakeaway.classList.remove('saved');
    saveTakeaway.style.display = '';
    renderFollowUpChips('followUp');
  } catch (err) {
    removeCursor();
    responseBody.innerHTML = '';
    const s = document.createElement('span');
    s.style.cssText = 'color:var(--red);font-size:12px';
    s.textContent = err.message || 'Something went wrong.';
    responseBody.appendChild(s);
    saveTakeaway.style.display = 'none';
  }

  state.aiActive = false;
  setAllAiDisabled(false);
}

// ── Run AI action ──────────────────────────────────────────────────────────────
async function runAI(type, label, extra = '', sourceUrl = '') {
  if (state.aiActive) return;
  if (!state.aiOnline) { showOfflineError(); return; }

  // 1. Force fresh extraction
  state.pageContent = null;

  // 2. Query active tab to verify if url changed
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    if (state.tabUrl && !urlsMatch(activeTab.url, state.tabUrl)) {
      console.log('[Brief] Tab URL changed, invalidating cache:', activeTab.url);
      invalidateCache();
      state.tabId = activeTab.id;
      state.tabUrl = activeTab.url;
      state.tabTitle = activeTab.title ?? '';
      state.favIconUrl = activeTab.favIconUrl ?? '';
      updateHeaderSubtitle();
    }
  }

  // 3. Verify action.url matches current URL
  if (sourceUrl && !urlsMatch(sourceUrl, state.tabUrl)) {
    console.log('[Brief] Action URL mismatch:', sourceUrl, 'vs', state.tabUrl);
    invalidateCache();
  }

  state.aiActive = true;
  closeExportMenu();
  setAllAiDisabled(true);
  responseTag.textContent = label;
  responseBody.innerHTML  = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:68%"></div>';
  responseWrap.classList.add('visible');
  followUpChips.classList.remove('visible');
  saveTakeaway.style.display = 'none';

  try {
    const page = await getPageContent();
    if (!page?.text?.trim()) throw new Error('No content extracted.');

    // 4. Log debug details before EVERY AI request
    console.log('[Brief] URL:', page.url);
    console.log('[Brief] Title:', page.title);
    console.log('[Brief] Text Length:', page.text.length);
    console.log('[Brief] Preview:', page.text.slice(0, 300));

    // Guard: timelineSummary requires actual transcript/chapters
    if (type === 'timelineSummary') {
      if (!page.hasTranscript && !page.hasChapters) {
        throw new Error('No transcript available.');
      }
    }

    let messages;
    const SEL_ONLY = ['explainSelection','define','synonyms','explainCode','findBug','summarizeSelection','simplifySelection'];
    if (SEL_ONLY.includes(type)) {
      const promptFns = {
        explainSelection:  s => PROMPTS.explainSelection(s),
        define:            s => PROMPTS.define(s),
        synonyms:          s => PROMPTS.synonyms(s),
        explainCode:       s => PROMPTS.explainCode(s),
        findBug:           s => PROMPTS.findBug(s),
        summarizeSelection: s => PROMPTS.summarizeSelection(s),
        simplifySelection: s => PROMPTS.simplifySelection(s),
      };
      messages = promptFns[type](extra);
    } else {

      if (type === 'ask') {
        messages = PROMPTS.ask(page, extra);
      } else if (type === 'summarize' && page.isProduct) {
        messages = PROMPTS.productSummary(page);
      } else if (PROMPTS[type]) {
        messages = PROMPTS[type](page);
      } else {
        messages = PROMPTS.summarize(page);
      }
    }

    const maxTokens = TOKENS[type] ?? 350;
    responseBody.innerHTML = '';
    addCursor();

    let full = '';
    await streamAI(messages, maxTokens, delta => {
      removeCursor();
      full += delta;
      renderResponse(full);
      responseBody.scrollTop = responseBody.scrollHeight;
      addCursor();
    });

    removeCursor();
    if (!full.trim()) throw new Error('Empty response from AI.');
    renderResponse(full);

    state.lastResponse = { tag: label, text: full, url: state.tabUrl ?? '', title: state.tabTitle ?? '' };

    // Save context for follow-ups
    if (['define','synonyms','explainSelection','explainCode','findBug','followUp'].includes(type)) {
      saveContext(type, extra, full);
    }

    // Show save button
    saveTakeaway.textContent = 'Save';
    saveTakeaway.classList.remove('saved');
    saveTakeaway.style.display = '';

    // Show follow-up chips
    renderFollowUpChips(type);

  } catch (err) {
    removeCursor();
    const msg = err.name === 'AbortError' ? 'Request timed out.' : (err.message || 'Something went wrong.');
    responseBody.innerHTML = '';
    const errSpan = document.createElement('span');
    errSpan.style.cssText = 'color:var(--red);font-size:12px';
    errSpan.textContent = msg;
    responseBody.appendChild(errSpan);
    state.lastResponse = null;
    saveTakeaway.style.display = 'none';
    followUpChips.classList.remove('visible');
  }

  state.aiActive = false;
  setAllAiDisabled(false);
}

// Run AI with pre-built messages (for follow-up chips)
async function runAIWithMessages(messages, label, maxTokens) {
  if (state.aiActive) return;
  state.aiActive = true;
  setAllAiDisabled(true);
  responseTag.textContent = label;
  responseBody.innerHTML  = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:68%"></div>';
  responseWrap.classList.add('visible');
  followUpChips.classList.remove('visible');
  saveTakeaway.style.display = 'none';

  try {
    responseBody.innerHTML = '';
    addCursor();
    let full = '';
    await streamAI(messages, maxTokens, delta => {
      removeCursor();
      full += delta;
      renderResponse(full);
      responseBody.scrollTop = responseBody.scrollHeight;
      addCursor();
    });
    removeCursor();
    if (!full.trim()) throw new Error('Empty response.');
    renderResponse(full);
    state.lastResponse = { tag: label, text: full, url: state.tabUrl ?? '', title: state.tabTitle ?? '' };
    saveTakeaway.textContent = 'Save';
    saveTakeaway.classList.remove('saved');
    saveTakeaway.style.display = '';
    renderFollowUpChips('followUp');
  } catch (err) {
    removeCursor();
    responseBody.innerHTML = '';
    const s = document.createElement('span');
    s.style.cssText = 'color:var(--red);font-size:12px';
    s.textContent = err.message || 'Something went wrong.';
    responseBody.appendChild(s);
    saveTakeaway.style.display = 'none';
  }

  state.aiActive = false;
  setAllAiDisabled(false);
}

function setAllAiDisabled(v) {
  [btnSummarize, btnSecondary1, btnSecondary2, btnSecondary3, askSend].forEach(b => { if (b) b.disabled = v; });
}

function showOfflineError() {
  responseTag.textContent = 'Offline';
  responseBody.innerHTML  = '';
  const s = document.createElement('span');
  s.style.cssText = 'color:var(--amber);font-size:12px';
  s.textContent = 'Brief AI Offline. Run: brief --on';
  responseBody.appendChild(s);
  responseWrap.classList.add('visible');
  saveTakeaway.style.display = 'none';
}

function showError(msg) {
  responseTag.textContent = 'Error';
  responseBody.innerHTML  = '';
  const s = document.createElement('span');
  s.style.cssText = 'color:var(--red);font-size:12px';
  s.textContent = msg;
  responseBody.appendChild(s);
  responseWrap.classList.add('visible');
  saveTakeaway.style.display = 'none';
}

// ── Primary button ─────────────────────────────────────────────────────────────
btnSummarize.addEventListener('click', () => {
  const type  = btnSummarize.dataset.aiType  || 'summarize';
  const label = btnSummarize.dataset.aiLabel || 'Summary';
  runAI(type, label);
});

// ── Secondary pills ────────────────────────────────────────────────────────────
[btnSecondary1, btnSecondary2, btnSecondary3].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const type  = btn.dataset.aiType  || 'keyPoints';
    const label = btn.dataset.aiLabel || 'Key Points';
    runAI(type, label);
  });
});

// ── Ask textarea ───────────────────────────────────────────────────────────────
askInput.addEventListener('input', () => {
  askInput.style.height = 'auto';
  askInput.style.height = Math.min(askInput.scrollHeight, 80) + 'px';
  askSend.disabled = !askInput.value.trim();
});
askInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askSend.click(); }
});
askSend.addEventListener('click', () => {
  const q = askInput.value.trim();
  if (!q) return;
  runAI('ask', 'Answer', q);
  askInput.value = '';
  askInput.style.height = 'auto';
  askSend.disabled = true;
});

// ── Copy response ──────────────────────────────────────────────────────────────
responseCopy.addEventListener('click', () => {
  const text = responseBody.textContent?.trim();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const orig = responseCopy.textContent;
    responseCopy.textContent = '✓ Copied';
    setTimeout(() => { responseCopy.textContent = orig; }, 1600);
  });
});

// ── Export menu ────────────────────────────────────────────────────────────────
function closeExportMenu() { exportMenu.classList.remove('open'); }

exportToggle.addEventListener('click', e => {
  e.stopPropagation();
  exportMenu.classList.toggle('open');
});
document.addEventListener('click', () => closeExportMenu());

exportCopyMd.addEventListener('click', () => {
  if (!state.lastResponse) return;
  const md = `# ${state.lastResponse.tag}\n\n${state.lastResponse.text}\n\n---\nSource: ${state.lastResponse.url}`;
  navigator.clipboard.writeText(md).then(() => {
    exportCopyMd.textContent = '✓ Copied';
    setTimeout(() => { exportCopyMd.textContent = 'Copy as Markdown'; }, 1600);
  });
  closeExportMenu();
});

exportCopyPlain.addEventListener('click', () => {
  if (!state.lastResponse) return;
  navigator.clipboard.writeText(state.lastResponse.text).then(() => {
    exportCopyPlain.textContent = '✓ Copied';
    setTimeout(() => { exportCopyPlain.textContent = 'Copy as Plain Text'; }, 1600);
  });
  closeExportMenu();
});

exportMd.addEventListener('click', () => {
  if (!state.lastResponse) return;
  download('markdown', state.lastResponse);
  closeExportMenu();
});

exportJson.addEventListener('click', () => {
  if (!state.lastResponse) return;
  download('json', state.lastResponse);
  closeExportMenu();
});

exportAllInsights.addEventListener('click', () => {
  if (!state.insights.length) {
    exportAllInsights.textContent = 'No insights yet';
    setTimeout(() => { exportAllInsights.textContent = 'Export All Insights'; }, 1600);
    closeExportMenu();
    return;
  }
  // Build markdown
  const lines = ['# Brief Insights\n', `Exported: ${new Date().toLocaleString()}\n`];
  state.insights.forEach((ins, i) => {
    lines.push(`\n## ${i+1}. ${ins.tag}\n`);
    lines.push(ins.text);
    if (ins.url) lines.push(`\n_Source: ${ins.url}_`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'brief-insights.md';
  a.click();
  URL.revokeObjectURL(url);
  closeExportMenu();
});

// ── URL clean panel ────────────────────────────────────────────────────────────
function renderUrlPanel(urlInfo) {
  if (!urlInfo?.original) {
    urlOriginal.textContent = urlCleaned.textContent = 'N/A';
    ['loading'].forEach(c => { urlOriginal.classList.remove(c); urlCleaned.classList.remove(c); });
    return;
  }

  const trunc = (u, n = 45) => {
    if (u.length <= n) return u;
    try {
      const pu = new URL(u);
      const s  = pu.hostname + pu.pathname;
      return s.length > n ? s.slice(0, n) + '…' : s;
    } catch { return u.slice(0, n) + '…'; }
  };

  urlOriginal.textContent = trunc(urlInfo.original);
  urlOriginal.classList.remove('loading');
  urlCleaned.textContent  = trunc(urlInfo.cleaned);
  urlCleaned.classList.remove('loading');

  if (!urlInfo.changed) {
    urlCleaned.classList.add('same');
    urlCleaned.classList.remove('clean');
  }

  diffRow.innerHTML = '';
  let hasDiff = false;
  (urlInfo.steps ?? []).forEach(s => {
    if (s.type === 'redirect') { diffRow.appendChild(chip('↗ redirect', 'step')); hasDiff = true; }
    if (s.type === 'amp')      { diffRow.appendChild(chip('⚡ AMP', 'step')); hasDiff = true; }
  });
  (urlInfo.removed ?? []).forEach(k => { diffRow.appendChild(chip(`✕ ${k}`, 'rm')); hasDiff = true; });
  (urlInfo.kept ?? []).slice(0, 3).forEach(k => diffRow.appendChild(chip(`✓ ${k}`, 'ok')));
  if ((urlInfo.kept?.length ?? 0) > 3) diffRow.appendChild(chip(`+${urlInfo.kept.length - 3}`, 'ok'));
  if (hasDiff || (urlInfo.kept?.length ?? 0) > 0) diffRow.style.display = 'flex';

  btnCopy.disabled = false;
  btnOpen.disabled = !urlInfo.changed;
}

function chip(text, type) {
  const el = document.createElement('span');
  el.className = `chip chip-${type}`;
  el.textContent = text;
  return el;
}

btnCopy.addEventListener('click', async () => {
  if (btnCopy.disabled) return;
  btnCopy.disabled = true;
  try {
    await chrome.runtime.sendMessage({ what: 'cc:copyCleanUrl' });
    btnCopy.classList.add('success');
    btnCopyLabel.textContent = '✓ Copied';
    setTimeout(() => {
      btnCopy.classList.remove('success');
      btnCopyLabel.textContent = 'Copy';
      btnCopy.disabled = false;
    }, 1600);
  } catch {
    btnCopyLabel.textContent = 'Failed';
    setTimeout(() => { btnCopyLabel.textContent = 'Copy'; btnCopy.disabled = false; }, 1800);
  }
});

btnOpen.addEventListener('click', async () => {
  if (btnOpen.disabled) return;
  await chrome.runtime.sendMessage({ what: 'cc:openCleanUrl' });
  window.close();
});

// ── Declutter panel ────────────────────────────────────────────────────────────
document.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.declutterMode = btn.dataset.mode;
    declutterResult.classList.remove('visible');
    btnDeclutter.classList.remove('done');
    btnDeclutter.textContent = 'Clean This Page';
    btnDeclutter.disabled = false;
  });
});

btnDeclutter.addEventListener('click', async () => {
  if (btnDeclutter.disabled) return;
  btnDeclutter.disabled = true;
  btnDeclutter.textContent = 'Cleaning…';

  try {
    const res = await chrome.runtime.sendMessage({ what: 'cc:declutter', mode: state.declutterMode });
    if (res?.ok) {
      const n = res.data?.removed ?? 0;
      btnDeclutter.classList.add('done');
      btnDeclutter.textContent = '✓ Done';
      declutterResult.textContent = n > 0
        ? `Removed ${n} distraction${n > 1 ? 's' : ''} — page is cleaner now`
        : 'Page already looks clean';
      declutterResult.classList.add('visible');
    } else {
      btnDeclutter.textContent = res?.error ?? 'Failed';
      setTimeout(() => { btnDeclutter.textContent = 'Clean This Page'; btnDeclutter.disabled = false; }, 2000);
    }
  } catch {
    btnDeclutter.textContent = 'Failed';
    setTimeout(() => { btnDeclutter.textContent = 'Clean This Page'; btnDeclutter.disabled = false; }, 2000);
  }
});

// ── Pending action (context menu or selection bubble) ──────────────────────────
async function checkPendingAction() {
  try {
    const res = await chrome.runtime.sendMessage({ what: 'brief:getPendingAction' });
    const action = res?.action;
    if (!action) return;

    if (action.url && !urlsMatch(action.url, state.tabUrl)) {
      console.log('[Brief] Pending action URL mismatch:', action.url, 'vs', state.tabUrl);
      invalidateCache();
      return;
    }

    document.querySelector('[data-tab="ai"]')?.click();

    const SEL_ACTIONS = ['explainSelection', 'define', 'synonyms', 'explainCode', 'findBug'];
    const SEL_LABELS  = {
      explainSelection: 'Explanation',
      define:           'Definition',
      synonyms:         'Synonyms',
      explainCode:      'Code Explained',
      findBug:          'Bug Analysis',
    };

    if (SEL_ACTIONS.includes(action.type) && action.selection) {
      await runAI(action.type, SEL_LABELS[action.type] ?? 'Explanation', action.selection);
    } else if (action.type === 'ask' && action.prefill) {
      askInput.value = action.prefill;
      askInput.style.height = 'auto';
      askInput.style.height = Math.min(askInput.scrollHeight, 80) + 'px';
      askSend.disabled = false;
      askInput.focus();
    } else if (action.type === 'simplify' && action.selection) {
      await runAI('simplifySelection', 'Simplified', action.selection);
    } else {
      const PAGE_TYPES = ['summarize','keyPoints','explain','tldr','summarizeDiscussion','explainRepo',
        'whatDoesThisCodeDo','keyTakeaways','timelineSummary','communityConsensus',
        'argumentsFor','argumentsAgainst','explainSolution','simplerExplanation','keyFix',
        'explainDocsConcepts','beginnerExplanation'];
      if (PAGE_TYPES.includes(action.type)) {
        const labels = {
          summarize: 'Summary', keyPoints: 'Key Points', explain: 'Explanation', tldr: 'TL;DR',
          summarizeDiscussion: 'Discussion', explainRepo: 'Repo Explained',
          whatDoesThisCodeDo: 'Code Explained', keyTakeaways: 'Key Takeaways',
          timelineSummary: 'Timeline', communityConsensus: 'Consensus',
          argumentsFor: 'Arguments For', argumentsAgainst: 'Arguments Against',
          explainSolution: 'Solution', simplerExplanation: 'Simpler', keyFix: 'Key Fix',
          explainDocsConcepts: 'Key Concepts', beginnerExplanation: 'Beginner Guide',
        };
        await runAI(action.type, labels[action.type] ?? action.type);
      }
    }
  } catch {}
}

// ── URL Matching & Branding Fallbacks ──────────────────────────────────────────
function urlsMatch(u1, u2) {
  if (!u1 || !u2) return false;
  try {
    const clean = u => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').split('#')[0];
    return clean(u1) === clean(u2);
  } catch {
    return u1 === u2;
  }
}

function getFallbackThemeColor(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) return '#ff0000';
    if (host.includes('github.com')) return '#24292f';
    if (host.includes('reddit.com')) return '#ff4500';
    if (host.includes('stackoverflow.com')) return '#f48024';
    if (host.includes('amazon.com') || host.includes('amazon.in') || host.includes('amazon.co.uk')) return '#ff9900';
    if (host.includes('wikipedia.org')) return '#6b7280';
    if (host.includes('bbc.com') || host.includes('bbc.co.uk')) return '#b80000';
    if (host.includes('medium.com')) return '#191919';
    if (host.includes('news.ycombinator.com')) return '#ff6600';
    if (host.includes('google.com')) return '#4285f4';
    if (host.includes('apple.com')) return '#000000';
    if (host.includes('twitter.com') || host.includes('x.com')) return '#0f1419';
    if (host.includes('microsoft.com')) return '#00a4ef';
  } catch {}
  return null;
}

// ── Dynamic accent theming ─────────────────────────────────────────────────────
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s,l=(max+min)/2;
  if(max===min){h=s=0;}else{
    const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}
    h/=6;
  }
  return [h*360,s,l];
}
function hslToHex(h,s,l){
  s=Math.max(0,Math.min(1,s));l=Math.max(0,Math.min(1,l));
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}
  const hex=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function applyThemeColor(hex) {
  if (!hex || !/^#[0-9a-f]{3,8}$/i.test(hex)) return;
  try {
    let cleanHex = hex;
    if (cleanHex.length === 4) {
      cleanHex = '#' + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2] + cleanHex[3] + cleanHex[3];
    } else if (cleanHex.length > 7) {
      cleanHex = cleanHex.slice(0, 7);
    }
    const [sh, ss, sl] = hexToHsl(cleanHex);
    
    // Determine prefers-color-scheme setting
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let adjustedL = sl;
    if (isDarkMode) {
      if (sl < 0.40) adjustedL = 0.45; // boost readability in dark mode
    } else {
      if (sl > 0.70) adjustedL = 0.55; // boost readability in light mode
    }
    
    const accent = hslToHex(sh, ss, adjustedL);
    const hoverL = isDarkMode ? Math.min(0.9, adjustedL + 0.1) : Math.max(0.1, adjustedL - 0.1);
    const accentHi = hslToHex(sh, ss, hoverL);
    
    const r = parseInt(accent.slice(1,3),16), g=parseInt(accent.slice(3,5),16), b=parseInt(accent.slice(5,7),16);
    const root = document.documentElement;
    root.style.setProperty('--accent',      accent);
    root.style.setProperty('--accent-hi',   accentHi);
    root.style.setProperty('--accent-rgb',  `${r}, ${g}, ${b}`);
    root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.28)`);
    
    const contrastThreshold = isDarkMode ? 0.65 : 0.52;
    const contrast = adjustedL > contrastThreshold ? '#111113' : '#ffffff';
    const contrastSoft = adjustedL > contrastThreshold ? 'rgba(17,17,19,0.25)' : 'rgba(255,255,255,0.25)';
    root.style.setProperty('--accent-contrast', contrast);
    root.style.setProperty('--accent-contrast-soft', contrastSoft);
  } catch {}
}

// ── Context-aware wording ──────────────────────────────────────────────────────
function applyContextWording(url) {
  const siteCtx = detectSiteContext(url);
  state.siteContext = siteCtx;

  // Primary button
  const labelNode = btnSummarize.lastChild;
  if (labelNode?.nodeType === 3) labelNode.nodeValue = ' ' + siteCtx.primaryLabel;
  btnSummarize.dataset.aiType  = siteCtx.discussLabel ? 'summarizeDiscussion' : (siteCtx.primaryType || 'summarize');
  btnSummarize.dataset.aiLabel = siteCtx.primaryLabel;

  // Ask placeholder
  askInput.placeholder = 'Ask about this page...';

  // Secondary pills
  const secondaries = siteCtx.secondaryActions ?? [
    { label: 'Key Points', type: 'keyPoints' },
    { label: 'Explain',    type: 'explain' },
    { label: 'TL;DR',      type: 'tldr' },
  ];

  const prefixes = ['★ ', '◎ ', '▣ '];
  const pills = [btnSecondary1, btnSecondary2, btnSecondary3];
  pills.forEach((btn, i) => {
    if (!btn) return;
    const action = secondaries[i];
    if (action) {
      btn.dataset.aiType  = action.type;
      btn.dataset.aiLabel = action.label;
      const nodes = [...btn.childNodes];
      const textNode = nodes.find(n => n.nodeType === 3 && n.textContent.trim());
      const prefix = prefixes[i] ?? '';
      if (textNode) textNode.nodeValue = '\n      ' + prefix + action.label + '\n    ';
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  });
}

// ── QR code ────────────────────────────────────────────────────────────────────
btnQrToggle.addEventListener('click', () => {
  const isVisible = qrSection.classList.toggle('visible');
  btnQrToggle.classList.toggle('active', isVisible);
  if (!isVisible) return;
  const url = state.urlInfo?.cleaned || state.tabUrl;
  if (url) generateQR(url, qrCanvas);
});

qrDownload.addEventListener('click', () => {
  try {
    const host = new URL(state.urlInfo?.cleaned || state.tabUrl || '').hostname || 'brief-qr';
    downloadQR(qrCanvas, `brief-${host}`);
  } catch { downloadQR(qrCanvas, 'brief-qr'); }
});

// ── Focus Reading Mode ─────────────────────────────────────────────────────────
btnFocus.addEventListener('click', async () => {
  const newState = !state.focusActive;
  try {
    const res = await chrome.runtime.sendMessage({ what: 'brief:focusMode', enable: newState });
    if (res?.ok) {
      state.focusActive = newState;
      btnFocus.classList.toggle('active', newState);
      btnFocus.setAttribute('aria-pressed', String(newState));
      btnFocus.lastChild.nodeValue = newState ? ' Exit Focus Mode' : ' Enter Focus Mode';
    }
  } catch {}
});

// ── Insights strip ─────────────────────────────────────────────────────────────
saveTakeaway.addEventListener('click', () => {
  if (!state.lastResponse) return;
  const text = state.lastResponse.text.replace(/\n+/g, ' ').trim();
  state.insights.push({ tag: state.lastResponse.tag, text, url: state.tabUrl ?? '', ts: Date.now() });
  renderInsights();
  saveTakeaway.textContent = '✓ Saved';
  saveTakeaway.classList.add('saved');
});

takeawayClear.addEventListener('click', () => {
  state.insights = [];
  renderInsights();
});

function renderInsights() {
  takeawayChips.innerHTML = '';
  if (!state.insights.length) { takeawayStrip.classList.remove('visible'); return; }
  takeawayStrip.classList.add('visible');
  state.insights.forEach((ins, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'insight-chip-wrap';

    const chip = document.createElement('button');
    chip.className = 'insight-chip';
    chip.textContent = `[${ins.tag}] ` + ins.text.slice(0, 35) + (ins.text.length > 35 ? '…' : '');
    chip.title = ins.text;
    chip.addEventListener('click', () => {
      responseWrap.classList.add('visible');
      responseTag.textContent = ins.tag;
      renderResponse(ins.text);
      followUpChips.classList.remove('visible');
    });

    const del = document.createElement('button');
    del.className = 'insight-delete';
    del.textContent = '×';
    del.title = 'Delete insight';
    del.addEventListener('click', e => {
      e.stopPropagation();
      state.insights.splice(i, 1);
      renderInsights();
    });

    wrap.appendChild(chip);
    wrap.appendChild(del);
    takeawayChips.appendChild(wrap);
  });
}

// ── Ephemeral conversational context ──────────────────────────────────────────
function saveContext(type, topic, responseText) {
  if (type === 'followUp') {
    if (state.context) {
      state.context.lastResponse = responseText;
      state.context.timestamp = Date.now();
    }
  } else {
    state.context = {
      mode: type, topic, lastResponse: responseText,
      source: 'selection', timestamp: Date.now()
    };
  }
  updateContextUI();
}

function updateContextUI() {
  const container = $('contextChipContainer');
  const textEl    = $('contextChipText');
  if (!container || !textEl) return;

  if (state.context) {
    if (Date.now() - state.context.timestamp > 10 * 60 * 1000) {
      state.context = null;
      container.style.display = 'none';
      return;
    }
    let topic = state.context.topic;
    if (topic.length > 28) topic = topic.slice(0, 25) + '…';
    textEl.textContent = `Continuing: ${topic}`;
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
  }
}

$('contextChipClose').addEventListener('click', () => {
  state.context = null;
  updateContextUI();
});

setInterval(() => { if (state.context) updateContextUI(); }, 10000);

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  const [, popupData] = await Promise.all([
    checkAiHealth(),
    chrome.runtime.sendMessage({ what: 'cc:getPopupData' }).catch(() => null),
  ]);

  if (popupData) {
    state.tabId      = popupData.tabId;
    state.tabUrl     = popupData.tabUrl;
    state.tabTitle   = popupData.tabTitle ?? '';
    state.favIconUrl = popupData.favIconUrl ?? '';
    state.urlInfo    = popupData.urlInfo;

    if (state.favIconUrl && !state.favIconUrl.startsWith('chrome://')) {
      pageFavicon.src = state.favIconUrl;
      pageFavicon.style.display = 'block';
    } else {
      pageFavicon.style.display = 'none';
    }

    updateHeaderSubtitle();
    renderUrlPanel(popupData.urlInfo);
    if (popupData.tabUrl?.startsWith('http')) btnQrToggle.disabled = false;
    applyContextWording(popupData.tabUrl);
    
    // Trigger sliding indicator once tabs render
    requestAnimationFrame(() => {
      updateTabIndicator(document.querySelector('.tab.active'));
    });

    if (popupData.tabUrl?.startsWith('http')) {
      getPageContent().catch(() => null);
    }
  }

  try {
    const themeRes = await chrome.runtime.sendMessage({ what: 'brief:getThemeColor' });
    let hex = themeRes?.color?.hex;
    if (!hex && state.tabUrl) {
      hex = getFallbackThemeColor(state.tabUrl);
    }
    if (hex) applyThemeColor(hex);
  } catch {}

  await checkPendingAction();
}

// ── Listen for in-page selection bubble messages ─────────────────────────────
chrome.runtime.onMessage.addListener((request) => {
  if (request.what === 'brief:executeSelectionAction') {
    const { action, selection } = request;
    if (!selection) return;

    // Switch to the AI tab
    document.querySelector('[data-tab="ai"]')?.click();

    const SEL_LABELS = {
      explainSelection: 'Explanation',
      define:           'Definition',
      synonyms:         'Synonyms',
      explainCode:      'Code Explained',
      findBug:          'Bug Analysis',
      simplifySelection: 'Simplified',
    };

    if (action === 'ask') {
      askInput.value = selection;
      askInput.style.height = 'auto';
      askInput.style.height = Math.min(askInput.scrollHeight, 80) + 'px';
      askSend.disabled = false;
      askInput.focus();
    } else if (action === 'simplify') {
      runAI('simplifySelection', 'Simplified', selection, request.url);
    } else {
      runAI(action, SEL_LABELS[action] ?? 'Explanation', selection, request.url);
    }
  }
});

init();
