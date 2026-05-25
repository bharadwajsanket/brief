(function () {
  'use strict';

  let active = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let container = null;

  try {
    window.addEventListener('keydown', onEscPress);
  } catch (err) {
    console.error('Brief Spatial selection listeners binding failed:', err);
  }

  function onEscPress(e) {
    if (e.key === 'Escape') {
      try {
        console.log('[Brief] Escape key pressed, cancelling selection');
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
    style.textContent = `
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
    `;
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

      const overlay = document.createElement('div');
      overlay.id = 'brief-spatial-overlay';
      overlay.addEventListener('mousedown', onMouseDown);
      container.appendChild(overlay);

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

    if (finalRect.width > 10 && finalRect.height > 10) {
      const extractedContent = extractTextFromRegion(finalRect);
      const classification = classifyContent(extractedContent.proseText, extractedContent.codeText);
      const combinedText = (extractedContent.proseText + '\n' + extractedContent.codeText).trim();

      console.log('[Brief] extraction complete');

      if (combinedText.length > 0) {
        // Store in session storage so popup can read it on load
        chrome.storage.session.set({
          briefPendingAction: {
            type: 'spatialSelection',
            selection: combinedText,
            classification: classification
          }
        }, () => {
          // Tell background to reopen popup
          chrome.runtime.sendMessage({ what: 'brief:openPopup' });
          cleanUp();
        });
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
                          node.id === 'brief-spatial-container';
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

  function cleanUp() {
    active = false;
    dragging = false;
    try {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    } catch {}
    try {
      document.body.style.removeProperty('cursor');
    } catch {}
    if (container) {
      try {
        container.remove();
      } catch {}
      container = null;
    }
  }

  window.__briefStartRegionSelect = function () {
    try {
      cleanUp();
      startSelectionMode();
    } catch (err) {
      console.error('Brief startRegionSelect failed:', err);
    }
  };

})();
