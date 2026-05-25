/*
 * Brief — popup.js
 * Popup UI logic: AI requests, URL cleaning, declutter, export.
 * All AI runs through local llama.cpp at 127.0.0.1:8080.
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
  define: 150, synonyms: 120, explainCode: 220, summarizeDiscussion: 350,
  followUp: 350,
};

// ── DOM ────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const pageHost      = $('pageHost');
const statusDot     = $('statusDot');
const modelLabel    = $('modelLabel');

const btnSummarize  = $('btnSummarize');
const btnKeyPoints  = $('btnKeyPoints');
const btnExplain    = $('btnExplain');
const btnTldr       = $('btnTldr');
const askInput      = $('askInput');
const askSend       = $('askSend');
const responseWrap  = $('responseWrap');
const responseTag   = $('responseTag');
const responseBody  = $('responseBody');
const responseCopy  = $('responseCopy');
const exportToggle  = $('exportToggle');
const exportMenu    = $('exportMenu');
const exportMd      = $('exportMd');
const exportJson    = $('exportJson');

const urlOriginal   = $('urlOriginal');
const urlCleaned    = $('urlCleaned');
const diffRow       = $('diffRow');
const btnCopy       = $('btnCopy');
const btnCopyLabel  = $('btnCopyLabel');
const btnOpen       = $('btnOpen');
const btnQrToggle   = $('btnQrToggle');
const qrSection     = $('qrSection');
const qrCanvas      = $('qrCanvas');
const qrDownload    = $('qrDownload');
const modKey        = $('modKey');

const btnDeclutter    = $('btnDeclutter');
const declutterResult = $('declutterResult');
const btnFocus        = $('btnFocus');

const responseFooter  = $('responseFooter');
const saveTakeaway    = $('saveTakeaway');
const takeawayStrip   = $('takeawayStrip');
const takeawayChips   = $('takeawayChips');
const takeawayClear   = $('takeawayClear');

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  tabId:         null,
  tabUrl:        null,
  tabTitle:      '',
  urlInfo:       null,
  aiOnline:      false,
  pageContent:   null,   // cached after first extract
  aiActive:      false,
  declutterMode: 'balanced',
  focusActive:   false,
  lastResponse:  null,   // { tag, text } for export
  takeaways:     [],     // session-only, cleared on popup close
  context:       null,   // lightweight conversational context
};

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
    closeExportMenu();
  });
});

// ── Platform key ───────────────────────────────────────────────────────────────
if (modKey) modKey.textContent = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';

// ── AI health check ────────────────────────────────────────────────────────────
async function checkAiHealth() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    state.aiOnline = res.ok;
  } catch {
    state.aiOnline = false;
  }

  statusDot.className = `status-dot ${state.aiOnline ? 'online' : 'offline'}`;

  if (state.aiOnline) {
    modelLabel.textContent = 'Friday AI';
  } else {
    modelLabel.textContent = 'Offline';
  }
}

// ── Page extraction (via background) ──────────────────────────────────────────
async function getPageContent() {
  if (state.pageContent) return state.pageContent;
  const res = await chrome.runtime.sendMessage({ what: 'cc:extractPage' });
  if (!res?.ok || !res.data?.text) throw new Error('Could not read this page.');
  state.pageContent = res.data;
  return state.pageContent;
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
// Converts plain-text AI output with bullets/bold into clean DOM nodes.
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

    // Bullet lines: "- foo" or "• foo"
    if (/^[-•]\s+/.test(line)) {
      const span = document.createElement('span');
      span.className = 'resp-bullet';
      span.textContent = '• ' + line.replace(/^[-•]\s+/, '');
      buffer.appendChild(span);
      continue;
    }

    // Normal text (may contain **bold**)
    const span = document.createElement('span');
    renderInline(line, span);
    span.appendChild(document.createTextNode(' '));
    buffer.appendChild(span);
  }

  responseBody.appendChild(buffer);
}

function renderInline(text, container) {
  // Split on **bold** markers
  const parts = text.split(/\*\*(.+?)\*\*/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const b = document.createElement('b');
      b.textContent = part;
      container.appendChild(b);
    } else if (part) {
      container.appendChild(document.createTextNode(part));
    }
  });
}

// ── Streaming cursor ───────────────────────────────────────────────────────────
let cursorEl = null;

function addCursor() {
  cursorEl = document.createElement('span');
  cursorEl.className = 'cursor';
  responseBody.appendChild(cursorEl);
}

function removeCursor() {
  cursorEl?.remove();
  cursorEl = null;
}

// ── Prompts ────────────────────────────────────────────────────────────────────
const SYS = 'You are Brief, a concise browser reading assistant. Plain text only — no asterisks, no markdown headers. Be direct and specific. Never hallucinate.';

function ctx(page) {
  const t = (page.text ?? '').trim().slice(0, 4500);
  return `Title: "${page.title ?? ''}"\n\n${t}`;
}

const PROMPTS = {
  summarize:  p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nSummarize in exactly 4 bullet points. Start each with "- ". One sentence per bullet. Cover the most important ideas.` }],
  keyPoints:  p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nList 4 specific key facts or takeaways. Start each with "- ". Be concrete — include names, numbers, decisions where present.` }],
  explain:    p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nExplain what this page is about in 2 clear sentences. Plain language, no jargon.` }],
  tldr:       p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nOne-sentence TL;DR. Start with the subject directly. Max 25 words.` }],
  ask:        (p, q) => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nQuestion: ${q}\n\nAnswer using only the content above. Under 3 sentences. If not found, say: "Not covered on this page."` }],
  explainSelection: s => [{ role:'system', content:SYS }, { role:'user', content:`Selected text:\n"${s.slice(0, 1200)}"\n\nExplain what this means in plain language. 2–3 sentences max. No bullets.` }],
  define:      w => [{ role:'system', content:SYS }, { role:'user', content:`Word or phrase: "${w.slice(0,80)}"\n\nProvide: 1) A clear one-sentence definition. 2) One natural example sentence. Keep it simple. No headers, no bullets. Two sentences total.` }],
  synonyms:    w => [{ role:'system', content:SYS }, { role:'user', content:`Word: "${w.slice(0,80)}"\n\nList 4 synonyms and 2 antonyms. Exact format:\nSynonyms: word1, word2, word3, word4\nAntonyms: word1, word2\nNothing else.` }],
  explainCode: s => [{ role:'system', content:SYS }, { role:'user', content:`Code:\n\`\`\`\n${s.slice(0,1500)}\n\`\`\`\n\nExplain what this code does in plain English. 2–3 sentences. No bullets. Mention the language if obvious.` }],
  summarizeDiscussion: p => [{ role:'system', content:SYS }, { role:'user', content:`${ctx(p)}\n\nThis is a discussion or comment thread. Summarize the main viewpoints. Write exactly 3 bullet points starting with "- ". Be specific — include key opinions, not just the topic.` }],
  followUp: (topic, previousResponse, question) => [
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `You are continuing a conversation about: "${topic}"\n\n`
        + `Previous explanation: ${previousResponse}\n\n`
        + `User follow-up: ${question}\n\n`
        + `Continue naturally and clearly. Do not say "not covered on this page". Do not rely on webpage-only grounding.`
    }
  ],
};

// ── Run AI action ──────────────────────────────────────────────────────────────
async function runAI(type, label, extra = '') {
  if (state.aiActive) return;
  if (!state.aiOnline) {
    showError('Local AI is offline. Start llama.cpp at 127.0.0.1:8080.');
    return;
  }

  state.aiActive = true;
  closeExportMenu();
  setAllAiDisabled(true);
  responseTag.textContent = label;
  responseBody.innerHTML  = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:68%"></div>';
  responseWrap.classList.add('visible');

  try {
    let messages;

    if (['explainSelection', 'define', 'synonyms', 'explainCode', 'followUp'].includes(type)) {
      // Selection-only / follow-up actions — no page extraction needed (fast)
      if (type === 'followUp') {
        messages = PROMPTS.followUp(state.context.topic, state.context.lastResponse, extra);
      } else {
        const promptFns = {
          explainSelection: s => PROMPTS.explainSelection(s),
          define:           s => PROMPTS.define(s),
          synonyms:         s => PROMPTS.synonyms(s),
          explainCode:      s => PROMPTS.explainCode(s),
        };
        messages = promptFns[type](extra);
      }
    } else {
      const page = await getPageContent();
      if (!page?.text?.trim()) throw new Error('Page has no readable content.');
      messages = type === 'ask' ? PROMPTS.ask(page, extra)
               : type === 'summarizeDiscussion' ? PROMPTS.summarizeDiscussion(page)
               : PROMPTS[type](page);
    }

    const maxTokens = TOKENS[type] ?? 350;

    // Clear skeleton, add cursor
    responseBody.innerHTML = '';
    addCursor();

    let full = '';
    await streamAI(messages, maxTokens, delta => {
      removeCursor();
      full += delta;
      // Re-render on each chunk for markdown-light formatting
      renderResponse(full);
      // Scroll smoothly
      responseBody.scrollTop = responseBody.scrollHeight;
      // Re-append cursor at end
      addCursor();
    });

    removeCursor();
    if (!full.trim()) throw new Error('Empty response from AI.');

    // Final clean render
    renderResponse(full);
    state.lastResponse = {
      tag:   label,
      text:  full,
      url:   state.tabUrl ?? '',
      title: state.tabTitle ?? '',
    };

    // Save to context if applicable
    if (['define', 'synonyms', 'explainSelection', 'explainCode', 'followUp'].includes(type)) {
      saveContext(type, extra, full);
    }

    // Show takeaway button
    responseFooter.style.display = 'flex';
    saveTakeaway.textContent = '📌 Save Takeaway';
    saveTakeaway.className = 'save-btn';

  } catch (err) {
    removeCursor();
    const msg = err.name === 'AbortError' ? 'Request timed out.' : (err.message || 'Something went wrong.');
    responseBody.innerHTML = '';
    const errSpan = document.createElement('span');
    errSpan.style.cssText = 'color:var(--red);font-size:12px';
    errSpan.textContent = msg;
    responseBody.appendChild(errSpan);
    state.lastResponse = null;
    responseFooter.style.display = 'none';
  }

  state.aiActive = false;
  setAllAiDisabled(false);
}

function setAllAiDisabled(v) {
  [btnSummarize, btnKeyPoints, btnExplain, btnTldr, askSend].forEach(b => b.disabled = v);
}

function showError(msg) {
  responseTag.textContent = 'Error';
  responseBody.innerHTML  = '';
  const s = document.createElement('span');
  s.style.cssText = 'color:var(--red);font-size:12px';
  s.textContent = msg;
  responseBody.appendChild(s);
  responseWrap.classList.add('visible');
}

// ── AI button handlers ─────────────────────────────────────────────────────────
// (btnSummarize handler is registered by applyContextWording() for dynamic labels)
btnKeyPoints.addEventListener('click', () => runAI('keyPoints', 'Key Points'));
btnExplain.addEventListener('click',   () => runAI('explain',   'Explanation'));
btnTldr.addEventListener('click',      () => runAI('tldr',      'TL;DR'));

// Ask textarea — auto-resize + send
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
  if (isFollowUp(q)) {
    runAI('followUp', 'Follow-up', q);
  } else {
    runAI('ask', 'Answer', q);
  }
  askInput.value = '';
  askInput.style.height = 'auto';
  askSend.disabled = true;
});

// Copy response
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
function closeExportMenu() {
  exportMenu.classList.remove('open');
}

exportToggle.addEventListener('click', e => {
  e.stopPropagation();
  exportMenu.classList.toggle('open');
});

document.addEventListener('click', () => closeExportMenu());

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

  // Diff chips
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
      btnCopyLabel.textContent = state.urlInfo?.changed ? 'Copy' : 'Copy';
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

// ── Pending action (from context menu or selection bubble) ─────────────────────
async function checkPendingAction() {
  try {
    const res = await chrome.runtime.sendMessage({ what: 'brief:getPendingAction' });
    const action = res?.action;
    if (!action) return;

    // Switch to AI tab if not already there
    document.querySelector('[data-tab="ai"]')?.click();

    const SEL_ACTIONS = ['explainSelection', 'define', 'synonyms', 'explainCode'];
    const SEL_LABELS  = {
      explainSelection: 'Explanation',
      define:           'Definition',
      synonyms:         'Synonyms',
      explainCode:      'Code Explained',
    };

    if (SEL_ACTIONS.includes(action.type) && action.selection) {
      await runAI(action.type, SEL_LABELS[action.type] ?? 'Explanation', action.selection);
    } else if (action.type === 'ask' && action.prefill) {
      askInput.value = action.prefill;
      askInput.style.height = 'auto';
      askInput.style.height = Math.min(askInput.scrollHeight, 80) + 'px';
      askSend.disabled = false;
      askInput.focus();
    } else if (['summarize', 'keyPoints', 'explain', 'tldr', 'summarizeDiscussion'].includes(action.type)) {
      const labels = { summarize: 'Summary', keyPoints: 'Key Points', explain: 'Explanation', tldr: 'TL;DR', summarizeDiscussion: 'Discussion' };
      await runAI(action.type, labels[action.type] ?? action.type);
    }
  } catch {}
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
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  try {
    const [sh, ss, sl] = hexToHsl(hex);
    // 45% Brief blue identity, 55% site hue — noticeable but Brief stays primary
    const blendH = 211 * 0.45 + sh * 0.55;
    // Pull saturation toward site colour, but cap it to stay refined
    const blendS = Math.min(0.90, 0.72 + ss * 0.18);
    const accent   = hslToHex(blendH, blendS, 0.50);
    const accentHi = hslToHex(blendH, Math.min(0.95, blendS + 0.04), 0.45);
    const r = parseInt(accent.slice(1,3),16), g=parseInt(accent.slice(3,5),16), b=parseInt(accent.slice(5,7),16);
    const root = document.documentElement;
    root.style.setProperty('--accent',      accent);
    root.style.setProperty('--accent-hi',   accentHi);
    root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.28)`);
    // Subtle background tint — barely perceptible but cohesive
    root.style.setProperty('--bg-tint', `rgba(${r},${g},${b},0.03)`);
  } catch {}
}

// ── Context-aware wording ──────────────────────────────────────────────────────
function applyContextWording(url) {
  const ctx = detectSiteContext(url);
  // Update primary summarize button label
  const labelNode = btnSummarize.lastChild;
  if (labelNode?.nodeType === 3) labelNode.nodeValue = ' ' + ctx.primaryLabel;
  // Update ask placeholder
  if (ctx.placeholder) askInput.placeholder = ctx.placeholder;
  // Store for runAI — if site is reddit/HN type, remap summarize to summarizeDiscussion
  if (ctx.discussLabel) {
    btnSummarize.dataset.aiType = 'summarizeDiscussion';
    btnSummarize.dataset.aiLabel = ctx.primaryLabel;
  } else {
    btnSummarize.dataset.aiType = 'summarize';
    btnSummarize.dataset.aiLabel = ctx.primaryLabel;
  }
}

// Update btn summarize handler to use dataset type
btnSummarize.addEventListener('click', () => {
  const type  = btnSummarize.dataset.aiType  || 'summarize';
  const label = btnSummarize.dataset.aiLabel || 'Summary';
  runAI(type, label);
});

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

// ── Takeaway strip ─────────────────────────────────────────────────────────────
saveTakeaway.addEventListener('click', () => {
  if (!state.lastResponse) return;
  const text = state.lastResponse.text.replace(/\n+/g, ' ').trim();
  state.takeaways.push({ tag: state.lastResponse.tag, text, ts: Date.now() });
  renderTakeaways();
  saveTakeaway.textContent = '✓ Saved';
  saveTakeaway.className = 'save-btn saved';
});

takeawayClear.addEventListener('click', () => {
  state.takeaways = [];
  renderTakeaways();
});

function renderTakeaways() {
  takeawayChips.innerHTML = '';
  if (!state.takeaways.length) { takeawayStrip.classList.remove('visible'); return; }
  takeawayStrip.classList.add('visible');
  state.takeaways.forEach((t, i) => {
    const chip = document.createElement('button');
    chip.className = 'takeaway-chip';
    chip.textContent = `[${t.tag}] ` + t.text.slice(0, 38) + (t.text.length > 38 ? '…' : '');
    chip.title = t.text;
    chip.addEventListener('click', () => {
      // Restore to response body
      responseWrap.classList.add('visible');
      responseTag.textContent = t.tag;
      renderResponse(t.text);
    });
    takeawayChips.appendChild(chip);
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
      mode: type,
      topic: topic,
      lastResponse: responseText,
      source: 'selection',
      timestamp: Date.now()
    };
  }
  updateContextUI();
}

function updateContextUI() {
  const container = $('contextChipContainer');
  const textEl = $('contextChipText');
  if (!container || !textEl) return;

  if (state.context) {
    if (Date.now() - state.context.timestamp > 10 * 60 * 1000) {
      state.context = null;
      container.style.display = 'none';
      return;
    }
    let displayTopic = state.context.topic;
    if (displayTopic.length > 28) {
      displayTopic = displayTopic.slice(0, 25) + '…';
    }
    textEl.textContent = `Continuing: ${displayTopic}`;
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
  }
}

function isFollowUp(question) {
  if (!state.context) return false;
  if (Date.now() - state.context.timestamp > 10 * 60 * 1000) {
    state.context = null;
    updateContextUI();
    return false;
  }
  const q = question.toLowerCase();
  const triggers = [
    /\bit\b/,
    /\bthis\b/,
    /\bthat\b/,
    /tell\s+me\s+more/,
    /explain\s+further/,
    /\bwhy\b/,
    /\bhow\b/,
    /\bexample/,
    /can\s+you\s+elaborate/
  ];
  return triggers.some(regex => regex.test(q));
}

// Close/dismiss context chip
$('contextChipClose').addEventListener('click', () => {
  state.context = null;
  updateContextUI();
});

// Periodically check for context expiry (every 10s)
setInterval(() => {
  if (state.context) {
    updateContextUI();
  }
}, 10000);

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  const [, popupData] = await Promise.all([
    checkAiHealth(),
    chrome.runtime.sendMessage({ what: 'cc:getPopupData' }).catch(() => null),
  ]);

  if (popupData) {
    state.tabId    = popupData.tabId;
    state.tabUrl   = popupData.tabUrl;
    state.tabTitle = popupData.tabTitle ?? '';
    state.urlInfo  = popupData.urlInfo;

    // Show hostname in header
    try {
      pageHost.textContent = new URL(popupData.tabUrl || 'about:blank').hostname || 'This page';
    } catch {
      pageHost.textContent = popupData.tabTitle || 'This page';
    }

    renderUrlPanel(popupData.urlInfo);

    // Enable QR button once URL is known
    if (popupData.tabUrl?.startsWith('http')) btnQrToggle.disabled = false;

    // Apply context-aware wording
    applyContextWording(popupData.tabUrl);
  }

  // Apply dynamic theme tint from site color
  try {
    const themeRes = await chrome.runtime.sendMessage({ what: 'brief:getThemeColor' });
    if (themeRes?.color?.hex) applyThemeColor(themeRes.color.hex);
  } catch {}

  // Check if opened by context menu or selection bubble
  await checkPendingAction();
}

init();
