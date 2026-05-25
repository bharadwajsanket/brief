(function () {
  'use strict';

  // State management for spatial select
  let active = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let selectedRect = null;
  let extractedContent = null;
  let container = null;
  let currentPort = null;

  // Set up Escape listener safely to dismiss overlays
  try {
    window.addEventListener('keydown', onEscPress);
  } catch (err) {
    console.error('Brief Spatial selection listeners binding failed:', err);
  }

  function onEscPress(e) {
    if (e.key === 'Escape') {
      try {
        console.log('[Brief] Escape key pressed, cleaning up');
        cleanUp();
      } catch (err) {
        console.error('Brief onEscPress failed:', err);
      }
    }
  }

  function ensureStyles() {
    if (document.getElementById('brief-spatial-styles')) return;
    const style = document.createElement('style');
    style.id = 'brief-spatial-styles';
    style.textContent = getStyles();
    document.head.appendChild(style);
  }

  function ensureContainer() {
    if (container) return;
    container = document.createElement('div');
    container.id = 'brief-spatial-container';
    document.body.appendChild(container);
  }

  function startSelectionMode() {
    try {
      console.log('[Brief] region select started');
      active = true;
      dragging = false;

      ensureStyles();
      ensureContainer();

      // Create full screen overlay
      const overlay = document.createElement('div');
      overlay.id = 'brief-spatial-overlay';
      overlay.addEventListener('mousedown', onMouseDown);
      container.appendChild(overlay);

      // Force style recalculation and animate fade-in
      requestAnimationFrame(() => {
        if (overlay) overlay.classList.add('active');
        document.body.style.cursor = 'crosshair';
      });
    } catch (err) {
      console.error('Brief startSelectionMode failed:', err);
      cleanUp();
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    // Create selection rect element
    const rectEl = document.createElement('div');
    rectEl.id = 'brief-selection-rect';
    rectEl.className = 'brief-spatial-rect';
    rectEl.style.left = `${startX + window.scrollX}px`;
    rectEl.style.top = `${startY + window.scrollY}px`;
    container.appendChild(rectEl);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const rectEl = document.getElementById('brief-selection-rect');
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

    const rectEl = document.getElementById('brief-selection-rect');
    if (!rectEl) return;

    const finalRect = rectEl.getBoundingClientRect();
    
    rectEl.remove();
    const overlay = document.getElementById('brief-spatial-overlay');
    if (overlay) {
      overlay.remove();
    }
    document.body.style.removeProperty('cursor');

    // Only proceed if drag area is non-trivial (>10px)
    if (finalRect.width > 10 && finalRect.height > 10) {
      selectedRect = finalRect;
      extractedContent = extractTextFromRegion(finalRect);
      const combinedText = (extractedContent.proseText + '\n' + extractedContent.codeText).trim();
      const textLength = combinedText.length;

      console.log('[Brief] extraction complete');
      console.log(extractedContent);

      if (textLength > 0) {
        // Temporarily alert extracted text (Phase 3)
        // alert(combinedText.slice(0, 300));
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
                          node.id === 'brief-spatial-container' ||
                          node.closest('#briefPanelCard') ||
                          node.id === 'brief-orb-debug' ||
                          node.id === 'brief-palette-debug';
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

    container.appendChild(panel);

    // Setup action buttons based on classification
    const actionsContainer = document.getElementById('briefPanelActions');
    const actions = getActionsForClass(classification);

    actions.forEach(act => {
      const btn = document.createElement('button');
      btn.className = 'brief-action-btn';
      btn.textContent = act.label;
      btn.addEventListener('click', () => runAction(act.action, combinedText));
      actionsContainer.appendChild(btn);
    });

    // Close button click listener
    document.getElementById('briefPanelClose').addEventListener('click', cleanUp);

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
      ask: 'Answer',
      define: 'Definition',
      synonyms: 'Synonyms'
    };
    return labels[act] || 'Response';
  }

  function showAskInput(text) {
    const actionsContainer = document.getElementById('briefPanelActions');
    actionsContainer.innerHTML = `
      <div class="brief-panel-ask-wrap">
        <input type="text" class="brief-panel-ask-input" id="briefPanelAskInput" placeholder="Ask about this selection..." />
        <button class="brief-panel-ask-send" id="briefPanelAskSend">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    const input = document.getElementById('briefPanelAskInput');
    const send = document.getElementById('briefPanelAskSend');

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
    const responseWrap = document.getElementById('briefPanelResponseWrap');
    const responseTag = document.getElementById('briefPanelResponseTag');
    const responseBody = document.getElementById('briefPanelResponseBody');
    const copyBtn = document.getElementById('briefPanelCopy');

    responseTag.textContent = label;
    responseBody.innerHTML = '<div class="brief-skeleton"></div><div class="brief-skeleton"></div><div class="brief-skeleton" style="width:68%"></div>';
    responseWrap.classList.add('visible');

    positionPanel(selectedRect);

    if (currentPort) {
      currentPort.disconnect();
    }

    console.log('[Brief] AI stream started');
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
    const panel = document.getElementById('briefPanelCard');
    if (!panel) return;

    const panelWidth = 320;
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    panel.style.display = 'flex';
    const panelHeight = panel.offsetHeight || 300;

    let left, top;
    if (rect) {
      left = rect.left + (rect.width - panelWidth) / 2;
      left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));
      top = rect.bottom + window.scrollY + 8;
      if (rect.bottom + panelHeight + margin > viewportHeight) {
        top = rect.top + window.scrollY - panelHeight - 8;
      }
    } else {
      // Default to bottom-right viewport, above orb (orb bottom is ~20px)
      left = viewportWidth - panelWidth - 20;
      top = window.scrollY + viewportHeight - panelHeight - 80;
      left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));
      top = Math.max(window.scrollY + margin, top);
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function onClickOutside(e) {
    if (!container) return;
    if (container.contains(e.target) || e.target.closest('#brief-orb-debug') || e.target.closest('#brief-palette-debug')) return;
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
    ],
    define: (text) => [
      { role: 'system', content: 'You are Brief, a concise dictionary assistant. Provide a brief definition of the term. Plain text only, no markdown.' },
      { role: 'user', content: `Define the term: "${text}"` }
    ],
    synonyms: (text) => [
      { role: 'system', content: 'You are Brief, a concise thesaurus assistant. Provide 3-5 synonyms. Plain text only, no markdown.' },
      { role: 'user', content: `Provide synonyms for: "${text}"` }
    ]
  };

  // ── CSS Styles ───────────────────────────────────────────────────────────────
  function getStyles() {
    return `
      #brief-spatial-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.15);
        z-index: 2147483640;
        cursor: crosshair;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      
      #brief-spatial-overlay.active {
        opacity: 1;
      }
      
      .brief-spatial-rect {
        position: absolute;
        border: 2px solid #0a84ff;
        background: rgba(10, 132, 255, 0.15);
        border-radius: 4px;
        pointer-events: none;
        z-index: 2147483641;
      }
      
      .brief-panel-card {
        position: absolute;
        z-index: 2147483645;
        width: 320px;
        background: #1e1e20;
        border: 1px solid #333;
        border-radius: 8px;
        color: #fff;
        font-family: sans-serif;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      }
      
      .brief-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid #333;
      }
      
      .brief-panel-title {
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        color: #0a84ff;
      }
      
      .brief-panel-close {
        background: none;
        border: none;
        color: #8e8e93;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }
      
      .brief-panel-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 10px;
        border-bottom: 1px solid #333;
      }
      
      .brief-action-btn {
        flex: 1;
        min-width: 80px;
        padding: 6px;
        background: #2a2a2c;
        border: 1px solid #444;
        border-radius: 6px;
        color: #fff;
        font-size: 11px;
        cursor: pointer;
        text-align: center;
        font-family: sans-serif;
      }
      
      .brief-action-btn:hover {
        background: #3a3a3c;
      }
      
      .brief-panel-response-wrap {
        display: none;
        flex-direction: column;
      }
      
      .brief-panel-response-wrap.visible {
        display: flex;
      }
      
      .brief-panel-response-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        background: #111;
        border-bottom: 1px solid #333;
      }
      
      .brief-panel-response-tag {
        font-size: 10px;
        color: #8e8e93;
      }
      
      .brief-panel-copy {
        background: none;
        border: none;
        color: #0a84ff;
        font-size: 10px;
        cursor: pointer;
      }
      
      .brief-panel-response-body {
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
        overflow-y: auto;
        max-height: 160px;
        white-space: pre-wrap;
      }
      
      .brief-cursor {
        display: inline-block;
        width: 2px;
        height: 1.1em;
        background: #0a84ff;
        vertical-align: text-bottom;
        margin-left: 2px;
        animation: blink 0.7s step-end infinite;
      }
      
      @keyframes blink {
        50% { opacity: 0; }
      }
      
      .brief-skeleton {
        height: 8px;
        background: #333;
        margin-bottom: 6px;
        border-radius: 4px;
      }
      
      .brief-skeleton:last-child {
        width: 60%;
      }

      /* Phase 6 visual polish */
      @supports (backdrop-filter: blur(20px)) {
        .brief-panel-card {
          background: rgba(30, 30, 32, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-color: rgba(255, 255, 255, 0.08);
        }
      }
    `;
  }

  // Expose public APIs for the floating orb and utility palette
  window.__briefStartRegionSelect = function () {
    try {
      cleanUp();
      startSelectionMode();
    } catch (err) {
      console.error('Brief startRegionSelect failed:', err);
    }
  };

  window.__briefShowResultPanel = function (title, text, actionType) {
    try {
      active = true;
      ensureStyles();
      ensureContainer();

      const existingPanel = document.getElementById('briefPanelCard');
      if (existingPanel) existingPanel.remove();

      const panel = document.createElement('div');
      panel.id = 'briefPanelCard';
      panel.className = 'brief-panel-card';
      panel.innerHTML = `
        <div class="brief-panel-header">
          <span class="brief-panel-title">${title}</span>
          <button class="brief-panel-close" id="briefPanelClose">×</button>
        </div>
        <div class="brief-panel-actions" id="briefPanelActions" style="display:none;"></div>
        <div class="brief-panel-response-wrap" id="briefPanelResponseWrap">
          <div class="brief-panel-response-header">
            <span class="brief-panel-response-tag" id="briefPanelResponseTag">Response</span>
            <button class="brief-panel-copy" id="briefPanelCopy">Copy</button>
          </div>
          <div class="brief-panel-response-body" id="briefPanelResponseBody"></div>
        </div>
      `;
      container.appendChild(panel);

      document.getElementById('briefPanelClose').addEventListener('click', cleanUp);
      
      selectedRect = null;
      positionPanel(null);

      const promptGenerator = SPATIAL_PROMPTS[actionType];
      if (promptGenerator) {
        const messages = promptGenerator(text);
        const label = getLabelForAction(actionType);
        startAICompletion(messages, label);
      } else {
        const messages = [
          { role: 'system', content: 'You are Brief, a concise browser reading assistant. Plain text only, no markdown headers or formatting. Be direct and specific.' },
          { role: 'user', content: text }
        ];
        startAICompletion(messages, 'Response');
      }

      setTimeout(() => {
        document.addEventListener('click', onClickOutside);
      }, 50);

    } catch (err) {
      console.error('Brief showResultPanel failed:', err);
      cleanUp();
    }
  };

})();
