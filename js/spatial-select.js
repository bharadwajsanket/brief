(function () {
  'use strict';

  // State management for spatial select
  let active = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let selectedRect = null;
  let extractedContent = null;
  let shadowRoot = null;
  let container = null;
  let currentPort = null;

  // Keycode/key name
  const ACTIVATION_KEY = 'Alt'; // Option on macOS triggers Alt keydown

  // Set up listeners safely
  try {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onEscPress);
  } catch (err) {
    console.error('Brief Spatial selection listeners binding failed:', err);
  }

  function onKeyDown(e) {
    if (e.key !== ACTIVATION_KEY) return;
    if (active) return;
    
    try {
      // Check if focused in an input/textarea
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }

      startSelectionMode();
    } catch (err) {
      console.error('Brief onKeyDown failed:', err);
      cleanUp();
    }
  }

  function onKeyUp(e) {
    if (e.key !== ACTIVATION_KEY) return;
    try {
      // Release Option key cancels inactive selection mode
      if (active && !dragging && !hasActivePanel()) {
        cleanUp();
      }
    } catch (err) {
      console.error('Brief onKeyUp failed:', err);
      cleanUp();
    }
  }

  function onEscPress(e) {
    if (e.key === 'Escape') {
      try {
        cleanUp();
      } catch (err) {
        console.error('Brief onEscPress failed:', err);
      }
    }
  }

  function hasActivePanel() {
    return shadowRoot && shadowRoot.getElementById('briefPanelCard')?.classList.contains('visible');
  }

  function startSelectionMode() {
    try {
      active = true;
      dragging = false;

      // Create container and Shadow DOM
      container = document.createElement('div');
      container.id = 'brief-spatial-container';
      container.style.cssText = 'position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483640;';
      shadowRoot = container.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(container);

      // Apply styles to shadow DOM
      const style = document.createElement('style');
      style.textContent = getStyles();
      shadowRoot.appendChild(style);

      // Create full screen overlay
      const overlay = document.createElement('div');
      overlay.id = 'brief-spatial-overlay';
      overlay.addEventListener('mousedown', onMouseDown);
      shadowRoot.appendChild(overlay);

      // Force style recalculation and animate fade-in
      requestAnimationFrame(() => {
        if (overlay) overlay.classList.add('active');
        document.body.style.cursor = 'crosshair';
      });

      // Detect theme color of page
      applyPageTheme();
    } catch (err) {
      console.error('Brief startSelectionMode failed:', err);
      cleanUp();
    }
  }

  function applyPageTheme() {
    const accent = getThemeColor();
    const accentSoft = hexToRgba(accent, 0.12);
    const accentGlow = hexToRgba(accent, 0.28);
    shadowRoot.host.style.setProperty('--brief-accent', accent);
    shadowRoot.host.style.setProperty('--brief-accent-soft', accentSoft);
    shadowRoot.host.style.setProperty('--brief-accent-glow', accentGlow);
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

  function onMouseDown(e) {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    // Create selection rect element in Shadow DOM
    const rectEl = document.createElement('div');
    rectEl.id = 'brief-selection-rect';
    rectEl.className = 'brief-spatial-rect';
    rectEl.style.left = `${startX + window.scrollX}px`;
    rectEl.style.top = `${startY + window.scrollY}px`;
    shadowRoot.appendChild(rectEl);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const rectEl = shadowRoot.getElementById('brief-selection-rect');
    if (!rectEl) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(startX - currentX);
    const height = Math.abs(startY - currentY);

    rectEl.style.left = `${left + window.scrollX}px`;
    rectEl.style.top = `${top + window.scrollY}px`;
    rectEl.style.width = `${width}px`;
    rectEl.style.height = `${height}px`;
  }

  function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    const rectEl = shadowRoot.getElementById('brief-selection-rect');
    if (!rectEl) return;

    const finalRect = rectEl.getBoundingClientRect();
    
    rectEl.remove();
    const overlay = shadowRoot.getElementById('brief-spatial-overlay');
    if (overlay) {
      overlay.remove();
    }
    document.body.style.removeProperty('cursor');

    // Only proceed if drag area is non-trivial (>10px)
    if (finalRect.width > 10 && finalRect.height > 10) {
      selectedRect = finalRect;
      extractedContent = extractTextFromRegion(finalRect);
      const textLength = (extractedContent.proseText + extractedContent.codeText).trim().length;

      if (textLength > 0) {
        showActionPanel(finalRect);
      } else {
        cleanUp();
      }
    } else {
      cleanUp();
    }
  }

  function extractTextFromRegion(rect) {
    const elements = [];
    const codeElements = [];

    function intersects(r) {
      return !(r.left > rect.right || 
               r.right < rect.left || 
               r.top > rect.bottom || 
               r.bottom < rect.top);
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const tag = node.tagName.toLowerCase();
          if (/^(script|style|noscript|iframe|svg|canvas)$/.test(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          const className = node.className || '';
          const id = node.id || '';
          const isNoise = /cookie|popup|modal|overlay|banner|advert|share|comment|sidebar|-ad-/i.test(className + ' ' + id) ||
                          node.closest('#brief-spatial-container');
          if (isNoise) return NodeFilter.FILTER_REJECT;

          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName.toLowerCase();
      const isContent = /^(p|h[1-6]|li|pre|code|td|span|a)$/.test(tag);
      if (!isContent) continue;

      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      if (intersects(r)) {
        if (tag === 'pre' || tag === 'code') {
          codeElements.push(node);
        } else {
          elements.push(node);
        }
      }
    }

    const finalCode = codeElements.filter(el => !codeElements.some(p => p !== el && p.contains(el)));
    const finalProse = elements.filter(el => {
      if (finalCode.some(c => c.contains(el))) return false;
      if (elements.some(p => p !== el && p.contains(el))) return false;
      return true;
    });

    let codeText = finalCode.map(el => el.innerText || el.textContent).join('\n').trim();
    let proseText = finalProse.map(el => el.innerText || el.textContent).join(' ').trim();
    proseText = proseText.replace(/\s+/g, ' ');

    return { proseText, codeText };
  }

  function classifyContent(proseText, codeText) {
    if (codeText.length > 0 && proseText.length === 0) {
      return 'code';
    }
    if (proseText.length > 0 && codeText.length === 0) {
      if (looksLikeCode(proseText)) return 'code';
      return 'prose';
    }
    if (codeText.length > 0 && proseText.length > 0) {
      if (proseText.split(/\s+/).length < 10 && codeText.length > proseText.length * 2) {
        return 'code';
      }
      return 'mixed';
    }
    return 'prose';
  }

  function looksLikeCode(text) {
    const lines = text.split('\n');
    const codeSignals = [
      /[{};()]/,
      /\b(const|let|var|function|return|import|export|class|def|if|for|while|struct|public|private|void)\b/,
      /^\s{2,}/,
      /[=+\-*/]{2,}/
    ];
    let score = 0;
    lines.forEach(line => {
      for (const regex of codeSignals) {
        if (regex.test(line)) { score++; break; }
      }
    });
    return (score / Math.max(lines.length, 1)) > 0.4 && text.length > 10;
  }

  function showActionPanel(rect) {
    const classification = classifyContent(extractedContent.proseText, extractedContent.codeText);
    const combinedText = (extractedContent.proseText + '\n' + extractedContent.codeText).trim();

    // Create the floating panel
    const panel = document.createElement('div');
    panel.id = 'briefPanelCard';
    panel.className = 'brief-panel-card';
    panel.innerHTML = `
      <div class="brief-panel-header">
        <span class="brief-panel-title">Brief Selection</span>
        <button class="brief-panel-close" id="briefPanelClose">×</button>
      </div>
      <div class="brief-panel-actions" id="briefPanelActions"></div>
      <div class="brief-panel-response-wrap" id="briefPanelResponseWrap">
        <div class="brief-panel-response-header">
          <span class="brief-panel-response-tag" id="briefPanelResponseTag">Response</span>
          <button class="brief-panel-copy" id="briefPanelCopy">Copy</button>
        </div>
        <div class="brief-panel-response-body" id="briefPanelResponseBody"></div>
      </div>
    `;

    shadowRoot.appendChild(panel);

    // Setup action buttons based on classification
    const actionsContainer = shadowRoot.getElementById('briefPanelActions');
    const actions = getActionsForClass(classification);

    actions.forEach(act => {
      const btn = document.createElement('button');
      btn.className = 'brief-action-btn';
      btn.textContent = act.label;
      btn.addEventListener('click', () => runAction(act.action, combinedText));
      actionsContainer.appendChild(btn);
    });

    // Close button click listener
    shadowRoot.getElementById('briefPanelClose').addEventListener('click', cleanUp);

    // Click outside listener
    setTimeout(() => {
      document.addEventListener('click', onClickOutside);
    }, 50);

    // Position panel
    positionPanel(rect);
  }

  function getActionsForClass(cls) {
    if (cls === 'prose') {
      return [
        { label: 'Summarize', action: 'summarize' },
        { label: 'Explain', action: 'explain' },
        { label: 'Simplify', action: 'simplify' },
        { label: 'Key Points', action: 'keyPoints' }
      ];
    } else if (cls === 'code') {
      return [
        { label: 'Explain Code', action: 'explainCode' },
        { label: 'Find Bug', action: 'findBug' },
        { label: 'Simplify Logic', action: 'simplifyLogic' }
      ];
    } else {
      return [
        { label: 'Explain', action: 'explain' },
        { label: 'Summarize', action: 'summarize' },
        { label: 'Ask Brief', action: 'ask' }
      ];
    }
  }

  function runAction(action, text) {
    if (action === 'ask') {
      showAskInput(text);
      return;
    }

    const promptGenerator = SPATIAL_PROMPTS[action];
    if (!promptGenerator) return;

    const messages = promptGenerator(text);
    const label = getLabelForAction(action);
    startAICompletion(messages, label);
  }

  function getLabelForAction(act) {
    const labels = {
      summarize: 'Summary',
      explain: 'Explanation',
      simplify: 'Simplified',
      keyPoints: 'Key Points',
      explainCode: 'Code Explained',
      findBug: 'Bugs Found',
      simplifyLogic: 'Simplified Code',
      ask: 'Answer'
    };
    return labels[act] || 'Response';
  }

  function showAskInput(text) {
    const actionsContainer = shadowRoot.getElementById('briefPanelActions');
    actionsContainer.innerHTML = `
      <div class="brief-panel-ask-wrap">
        <input type="text" class="brief-panel-ask-input" id="briefPanelAskInput" placeholder="Ask about this selection..." />
        <button class="brief-panel-ask-send" id="briefPanelAskSend">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    const input = shadowRoot.getElementById('briefPanelAskInput');
    const send = shadowRoot.getElementById('briefPanelAskSend');

    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') send.click();
    });

    send.addEventListener('click', () => {
      const q = input.value.trim();
      if (!q) return;
      const messages = SPATIAL_PROMPTS.ask(text, q);
      startAICompletion(messages, 'Answer');
    });
  }

  function startAICompletion(messages, label) {
    const responseWrap = shadowRoot.getElementById('briefPanelResponseWrap');
    const responseTag = shadowRoot.getElementById('briefPanelResponseTag');
    const responseBody = shadowRoot.getElementById('briefPanelResponseBody');
    const copyBtn = shadowRoot.getElementById('briefPanelCopy');

    responseTag.textContent = label;
    responseBody.innerHTML = '<div class="brief-skeleton"></div><div class="brief-skeleton"></div><div class="brief-skeleton" style="width:68%"></div>';
    responseWrap.classList.add('visible');

    positionPanel(selectedRect);

    if (currentPort) {
      currentPort.disconnect();
    }

    currentPort = chrome.runtime.connect({ name: 'brief-ai-stream' });
    currentPort.postMessage({ messages, maxTokens: 350 });

    let fullText = '';
    responseBody.innerHTML = '';
    
    const cursor = document.createElement('span');
    cursor.className = 'brief-cursor';
    responseBody.appendChild(cursor);

    currentPort.onMessage.addListener(msg => {
      if (msg.chunk) {
        cursor.remove();
        fullText += msg.chunk;
        responseBody.textContent = fullText;
        responseBody.appendChild(cursor);
        responseBody.scrollTop = responseBody.scrollHeight;
      }
      if (msg.done) {
        cursor.remove();
        currentPort.disconnect();
        currentPort = null;
      }
      if (msg.error) {
        cursor.remove();
        responseBody.innerHTML = `<span style="color:#ff453a;">${msg.error}</span>`;
        currentPort.disconnect();
        currentPort = null;
      }
    });

    copyBtn.textContent = 'Copy';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(fullText).then(() => {
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    };
  }

  function positionPanel(rect) {
    const panel = shadowRoot.getElementById('briefPanelCard');
    if (!panel) return;

    const panelWidth = 320;
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = rect.left + (rect.width - panelWidth) / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));

    let top = rect.bottom + window.scrollY + 8;
    
    panel.style.display = 'flex';
    const panelHeight = panel.offsetHeight || 120;

    if (rect.bottom + panelHeight + margin > viewportHeight) {
      top = rect.top + window.scrollY - panelHeight - 8;
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.classList.add('visible');
  }

  function onClickOutside(e) {
    if (!container) return;
    if (e.composedPath().includes(container)) return;
    cleanUp();
  }

  function cleanUp() {
    active = false;
    dragging = false;

    try {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('click', onClickOutside);
    } catch {}

    try {
      document.body.style.removeProperty('cursor');
    } catch {}

    if (currentPort) {
      try {
        currentPort.disconnect();
      } catch {}
      currentPort = null;
    }

    if (container) {
      try {
        container.remove();
      } catch {}
      container = null;
      shadowRoot = null;
    }
  }

  // ── Prompt Generators ──────────────────────────────────────────────────────────
  const SPATIAL_PROMPTS = {
    summarize: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `Summarize this text in 2-3 concise sentences:\n\n"${text}"` }
    ],
    explain: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `Explain this selection clearly and concisely in plain language:\n\n"${text}"` }
    ],
    simplify: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `Rewrite this in simpler language (maximum 3 sentences):\n\n"${text}"` }
    ],
    keyPoints: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `List 3 key takeaways from this text (use bullet points starting with -):\n\n"${text}"` }
    ],
    explainCode: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `Explain what this code does in plain English (2-3 sentences):\n\n\`\`\`\n${text}\n\`\`\`` }
    ],
    findBug: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `Find any potential bugs or edge cases in this code and suggest brief fixes:\n\n\`\`\`\n${text}\n\`\`\`` }
    ],
    simplifyLogic: (text) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
      { role: 'user', content: `Simplify the logic of this code or make it more readable:\n\n\`\`\`\n${text}\n\`\`\`` }
    ],
    ask: (text, question) => [
      { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and answer using only the provided text context if possible.' },
      { role: 'user', content: `Context selection:\n"${text}"\n\nQuestion: ${question}` }
    ]
  };

  // ── CSS Styles ───────────────────────────────────────────────────────────────
  function getStyles() {
    return `
      :host {
        --brief-accent: #0a84ff;
        --brief-accent-soft: rgba(10, 132, 255, 0.12);
        --brief-accent-glow: rgba(10, 132, 255, 0.28);
      }
      
      #brief-spatial-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.12);
        backdrop-filter: blur(1.5px);
        -webkit-backdrop-filter: blur(1.5px);
        z-index: 2147483640;
        cursor: crosshair;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: auto;
      }
      
      #brief-spatial-overlay.active {
        opacity: 1;
      }
      
      .brief-spatial-rect {
        position: absolute;
        border: 2px solid var(--brief-accent);
        background: var(--brief-accent-soft);
        border-radius: 8px;
        box-shadow: 0 0 14px var(--brief-accent-glow);
        pointer-events: none;
        z-index: 2147483641;
        transition: none;
      }
      
      .brief-panel-card {
        position: absolute;
        z-index: 2147483645;
        width: 320px;
        background: rgba(255, 255, 255, 0.82);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        color: #1c1c1e;
        overflow: hidden;
        opacity: 0;
        transform: scale(0.96) translateY(4px);
        transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-panel-card {
          background: rgba(30, 30, 32, 0.85);
          border-color: rgba(255, 255, 255, 0.08);
          color: #f2f2f7;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 1px 4px rgba(0, 0, 0, 0.2);
        }
      }
      
      .brief-panel-card.visible {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
      
      .brief-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-panel-header {
          border-bottom-color: rgba(255, 255, 255, 0.05);
        }
      }
      
      .brief-panel-title {
        font-size: 11px;
        font-weight: 700;
        color: var(--brief-accent);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      
      .brief-panel-close {
        background: none;
        border: none;
        color: #8e8e93;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        opacity: 0.7;
        transition: opacity 0.12s;
      }
      
      .brief-panel-close:hover {
        opacity: 1;
      }
      
      .brief-panel-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 12px;
      }
      
      .brief-action-btn {
        flex: 1;
        min-width: 84px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 7px 10px;
        background: rgba(0, 0, 0, 0.03);
        border: 1px solid rgba(0, 0, 0, 0.04);
        border-radius: 8px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        color: #3a3a3c;
        cursor: pointer;
        transition: all 0.12s ease;
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-action-btn {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.03);
          color: #c7c7cc;
        }
      }
      
      .brief-action-btn:hover {
        background: var(--brief-accent-soft);
        border-color: rgba(10, 132, 255, 0.15);
        color: var(--brief-accent);
      }
      
      .brief-action-btn:active {
        transform: scale(0.97);
      }
      
      .brief-panel-ask-wrap {
        display: flex;
        width: 100%;
        position: relative;
        align-items: center;
      }
      
      .brief-panel-ask-input {
        width: 100%;
        padding: 8px 32px 8px 10px;
        background: rgba(0, 0, 0, 0.02);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        font-family: inherit;
        font-size: 11.5px;
        color: inherit;
        outline: none;
        box-sizing: border-box;
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-panel-ask-input {
          background: rgba(255, 255, 255, 0.02);
          border-color: rgba(255, 255, 255, 0.08);
        }
      }
      
      .brief-panel-ask-input:focus {
        border-color: var(--brief-accent);
      }
      
      .brief-panel-ask-send {
        position: absolute;
        right: 5px;
        background: var(--brief-accent);
        border: none;
        color: #fff;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        display: grid;
        place-items: center;
        cursor: pointer;
        transition: opacity 0.12s;
      }
      
      .brief-panel-ask-send:hover {
        opacity: 0.9;
      }
      
      .brief-panel-response-wrap {
        display: none;
        flex-direction: column;
        border-top: 1px solid rgba(0, 0, 0, 0.05);
        max-height: 240px;
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-panel-response-wrap {
          border-top-color: rgba(255, 255, 255, 0.05);
        }
      }
      
      .brief-panel-response-wrap.visible {
        display: flex;
        animation: panelIn 0.2s ease;
      }
      
      .brief-panel-response-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        background: rgba(0, 0, 0, 0.01);
        border-bottom: 1px solid rgba(0, 0, 0, 0.03);
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-panel-response-header {
          border-bottom-color: rgba(255, 255, 255, 0.03);
        }
      }
      
      .brief-panel-response-tag {
        font-size: 9.5px;
        font-weight: 700;
        color: #8e8e93;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      
      .brief-panel-copy {
        background: none;
        border: none;
        color: var(--brief-accent);
        font-family: inherit;
        font-size: 9.5px;
        font-weight: 700;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: background 0.12s;
      }
      
      .brief-panel-copy:hover {
        background: var(--brief-accent-soft);
      }
      
      .brief-panel-response-body {
        padding: 12px 14px;
        font-size: 11.5px;
        line-height: 1.6;
        color: inherit;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 160px;
      }
      
      .brief-panel-response-body::-webkit-scrollbar {
        width: 4px;
      }
      .brief-panel-response-body::-webkit-scrollbar-track {
        background: transparent;
      }
      .brief-panel-response-body::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.08);
        border-radius: 2px;
      }
      @media (prefers-color-scheme: dark) {
        .brief-panel-response-body::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
        }
      }
      
      .brief-cursor {
        display: inline-block;
        width: 2px;
        height: 1.1em;
        background: var(--brief-accent);
        vertical-align: text-bottom;
        margin-left: 2px;
        border-radius: 1px;
        animation: blink 0.7s step-end infinite;
      }
      
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
      
      .brief-skeleton {
        height: 10px;
        background: linear-gradient(90deg, rgba(0,0,0,0.03) 25%, rgba(0,0,0,0.06) 50%, rgba(0,0,0,0.03) 75%);
        background-size: 200% 100%;
        border-radius: 5px;
        margin-bottom: 6px;
        animation: shimmer 1.5s ease-in-out infinite;
      }
      
      @media (prefers-color-scheme: dark) {
        .brief-skeleton {
          background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%);
        }
      }
      
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      
      .brief-skeleton:last-child {
        width: 60%;
        margin-bottom: 0;
      }
      
      @keyframes panelIn {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
  }

})();
