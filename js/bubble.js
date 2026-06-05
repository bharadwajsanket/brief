/*
 * Brief — bubble.js v4.5.0
 * In-page selection bubble: compact contextual action pill.
 * Polished: strong contrast, correct positioning, spring animation, robust dismiss.
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let container  = null;
  let bubble     = null;
  let lastSel    = '';
  let hideTimer  = null;

  const BUBBLE_STYLES = `
    #brief-bubble {
      position: fixed;
      display: flex;
      align-items: center;
      gap: 1px;
      padding: 4px 5px;
      background: rgba(18, 18, 22, 0.96);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 20px;
      box-shadow:
        0 8px 24px rgba(0, 0, 0, 0.50),
        0 2px 6px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.10);
      pointer-events: auto;
      animation: brief-bubble-in 0.20s cubic-bezier(0.16, 1, 0.3, 1) both;
      transform-origin: center bottom;
      user-select: none;
      -webkit-user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif;
    }
    @keyframes brief-bubble-in {
      from { opacity: 0; transform: scale(0.80) translateY(5px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    #brief-bubble.brief-bubble-out {
      animation: brief-bubble-out 0.10s ease forwards;
      pointer-events: none;
    }
    @keyframes brief-bubble-out {
      to { opacity: 0; transform: scale(0.90) translateY(3px); }
    }
    .brief-bubble-btn {
      display: flex;
      align-items: center;
      padding: 5px 10px;
      border: none;
      background: none;
      color: rgba(255, 255, 255, 0.92);
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 500;
      line-height: 1;
      cursor: pointer;
      border-radius: 15px;
      white-space: nowrap;
      transition: background 0.1s ease, color 0.1s ease;
      letter-spacing: 0.005em;
      -webkit-font-smoothing: antialiased;
    }
    .brief-bubble-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    .brief-bubble-btn:active {
      transform: scale(0.94);
      background: rgba(255, 255, 255, 0.18);
    }
    .brief-bubble-sep {
      width: 1px;
      height: 16px;
      background: rgba(255, 255, 255, 0.10);
      flex-shrink: 0;
      margin: 0 1px;
      border-radius: 1px;
    }
  `;

  // ── Selection type detection ───────────────────────────────────────────────
  function classifySelection(text, anchorNode) {
    if (!text || text.trim().length < 2) return null;

    const trimmed = text.trim();
    const wordCount = trimmed.split(/\s+/).length;

    // Check if selection is inside a code element
    let node = anchorNode;
    for (let i = 0; i < 8 && node; i++) {
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'pre' || tag === 'code') return 'code';
      node = node.parentElement;
    }

    // Symbol density heuristic for code
    const codeSymbols = (trimmed.match(/[{};()=><\[\]]/g) || []).length;
    if (codeSymbols / trimmed.length > 0.08 && wordCount > 3) return 'code';

    // Common code keywords
    if (/\b(const|let|var|function|return|import|export|class|def|if\s*\(|for\s*\(|while\s*\(|void|async|await|=>)\b/.test(trimmed) && codeSymbols > 1) {
      return 'code';
    }

    // Single word (no spaces, reasonable length)
    if (wordCount === 1 && trimmed.length <= 32 && !/[\n\r]/.test(trimmed)) return 'word';

    return 'text';
  }

  // ── Action sets by type ────────────────────────────────────────────────────
  const ACTIONS = {
    word: [
      { label: 'Define',    action: 'define' },
      { label: 'Synonyms',  action: 'synonyms' },
      { label: 'Explain',   action: 'explainSelection' },
    ],
    text: [
      { label: 'Explain',   action: 'explainSelection' },
      { label: 'Simplify',  action: 'simplify' },
      { label: 'Ask',       action: 'ask' },
    ],
    code: [
      { label: 'Explain Code', action: 'explainCode' },
      { label: 'Find Bug',     action: 'findBug' },
    ],
  };

  // ── Create bubble ──────────────────────────────────────────────────────────
  function createBubble(text, selType, viewportRect) {
    destroyBubble();

    container = document.createElement('div');
    container.id = 'brief-bubble-host';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '0';
    container.style.height = '0';
    container.style.zIndex = '2147483647';
    container.style.overflow = 'visible';

    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = BUBBLE_STYLES;
    shadow.appendChild(style);

    const actions = ACTIONS[selType] || ACTIONS.text;
    bubble = document.createElement('div');
    bubble.id = 'brief-bubble';
    bubble.setAttribute('role', 'toolbar');
    bubble.setAttribute('aria-label', 'Brief quick actions');

    actions.forEach((act, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'brief-bubble-sep';
        bubble.appendChild(sep);
      }

      const btn = document.createElement('button');
      btn.className = 'brief-bubble-btn';
      btn.textContent = act.label;
      btn.setAttribute('data-action', act.action);

      btn.addEventListener('mousedown', e => {
        e.preventDefault(); // prevent selection collapse
        e.stopPropagation();
      });
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        triggerAction(act.action, text);
      });

      bubble.appendChild(btn);
    });

    shadow.appendChild(bubble);
    document.body.appendChild(container);

    // Measure and position using fixed coordinates (viewport-relative)
    requestAnimationFrame(() => {
      if (!bubble) return;
      const bRect = bubble.getBoundingClientRect();
      const GAP = 8;
      const MARGIN = 6;

      let top = viewportRect.top - bRect.height - GAP;
      let left = viewportRect.left + (viewportRect.width / 2) - (bRect.width / 2);

      // If too close to top, flip below selection
      if (top < MARGIN) {
        top = viewportRect.bottom + GAP;
      }

      // Clamp horizontally
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - bRect.width - MARGIN));
      // Clamp vertically
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - bRect.height - MARGIN));

      bubble.style.top  = `${top}px`;
      bubble.style.left = `${left}px`;
    });
  }

  // ── Trigger action → popup ─────────────────────────────────────────────────
  function triggerAction(action, text) {
    destroyBubble();
    try {
      const typeMap = {
        explain:          'explainSelection',
        define:           'define',
        synonyms:         'synonyms',
        ask:              'ask',
        explainCode:      'explainCode',
        findBug:          'findBug',
        simplify:         'simplify',
        explainSelection: 'explainSelection',
      };
      chrome.runtime.sendMessage({
        what: 'brief:executeSelectionAction',
        action: typeMap[action] ?? action,
        selection: text,
        url: window.location.href,
      });
    } catch {
      // Extension context invalidated — silently ignore
    }
  }

  // ── Destroy bubble ─────────────────────────────────────────────────────────
  function destroyBubble(animate = false) {
    clearTimeout(hideTimer);
    if (!container) return;
    if (animate && bubble) {
      bubble.classList.add('brief-bubble-out');
      const c = container;
      container = null;
      bubble = null;
      setTimeout(() => c.remove(), 110);
    } else {
      container.remove();
      container = null;
      bubble = null;
    }
  }

  // ── Selection handler ──────────────────────────────────────────────────────
  function onMouseUp() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      try {
        const sel = window.getSelection();
        const text = sel?.toString()?.trim() ?? '';

        if (!text || text.length < 2) {
          destroyBubble(true);
          lastSel = '';
          return;
        }

        if (text === lastSel && bubble) return;
        lastSel = text;

        if (sel.rangeCount === 0) { destroyBubble(true); return; }
        const range = sel.getRangeAt(0);
        const rect  = range.getBoundingClientRect();

        if (rect.width < 2 && rect.height < 2) {
          destroyBubble(true);
          return;
        }

        const selType = classifySelection(text, sel.anchorNode);
        if (!selType) { destroyBubble(true); return; }

        createBubble(text, selType, rect);
      } catch {}
    }, 150);
  }

  // ── Dismiss handlers ───────────────────────────────────────────────────────
  document.addEventListener('mousedown', e => {
    if (container && !e.composedPath().includes(container)) {
      destroyBubble(true);
      lastSel = '';
    }
  }, true);

  document.addEventListener('scroll', () => {
    destroyBubble(true);
    lastSel = '';
  }, { passive: true, capture: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { destroyBubble(true); lastSel = ''; }
  });

  // Use mouseup instead of selectionchange for more reliable positioning
  document.addEventListener('mouseup', onMouseUp);

  // Also handle keyboard selection (shift+arrow)
  document.addEventListener('keyup', e => {
    if (e.shiftKey || e.key === 'Shift') onMouseUp();
  });

})();
