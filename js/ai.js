/*
 * Brief — ai.js
 * Lightweight llama.cpp client. Talks to http://127.0.0.1:8080 (OpenAI-compat).
 * Pure module — no browser APIs. Importable from popup or background.
 */

const LLAMA_BASE = 'http://127.0.0.1:8080';
const CHAT_URL   = `${LLAMA_BASE}/v1/chat/completions`;
const HEALTH_URL = `${LLAMA_BASE}/health`;
const MODEL_URL  = `${LLAMA_BASE}/v1/models`;

// Per-task token budgets — keep outputs tight for local models
const TOKEN_BUDGET = {
  summarize:           320,
  keyPoints:           280,
  explain:             200,
  tldr:                 80,
  ask:                 350,
  explainSelection:    220,
  define:              150,
  synonyms:            120,
  explainCode:         220,
  summarizeDiscussion: 350,
};

// ── Health check ──────────────────────────────────────────────────────────────
export async function checkHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Get running model name ────────────────────────────────────────────────────
export async function getModelName() {
  try {
    const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.data?.[0]?.id ?? null;
    if (!id) return null;
    // Trim to a readable stem — strip path and .gguf
    return id.split('/').pop().replace(/\.gguf$/i, '').replace(/[-_]/g, ' ').slice(0, 28);
  } catch {
    return null;
  }
}

// ── Core completion ───────────────────────────────────────────────────────────
/**
 * complete(messages, options)
 * options.onChunk(text)  → enables streaming (returns full string)
 * options.signal         → AbortSignal for cancellation
 */
export async function complete(messages, options = {}) {
  const {
    temperature = 0.35,
    maxTokens   = 350,
    onChunk     = null,
    signal      = null,
  } = options;

  const ctrl  = new AbortController();
  // Chain caller signal with internal timeout
  const timer = setTimeout(() => ctrl.abort(), 30000);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());

  const body = {
    model:      'local',
    messages,
    temperature,
    max_tokens: maxTokens,
    stream:     !!onChunk,
  };

  try {
    const res = await fetch(CHAT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });

    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`AI error ${res.status}: ${txt.slice(0, 120)}`);
    }

    // Streaming
    if (onChunk) {
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

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

    // Non-streaming
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? '';

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Request timed out.');
    throw err;
  }
}

// ── Prompts ───────────────────────────────────────────────────────────────────
// Tuned for 3B–8B local models: explicit format, short context, no ambiguity.

const SYS = [
  'You are Brief, a concise browser reading assistant.',
  'Rules: plain text only, no markdown syntax, no asterisks, no headers.',
  'Be direct, specific, and avoid filler phrases.',
  'Never hallucinate facts not in the provided content.',
].join(' ');

/** Compress page content to a clean context block. */
function pageCtx(page, maxChars = 4000) {
  const text = (page.text ?? '').trim();
  const body = text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
  return `Title: "${page.title ?? ''}"\nURL: ${page.url ?? ''}\n\nContent:\n${body}`;
}

export const prompts = {

  summarize: (page) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `${pageCtx(page, 4000)}\n\n`
        + `Summarize this page. Write exactly 4 bullet points. `
        + `Start each bullet with a dash (-). One sentence per bullet. `
        + `Cover the most important ideas only. Do not repeat the title.`,
    },
  ]),

  keyPoints: (page) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `${pageCtx(page, 4000)}\n\n`
        + `List 4 specific key facts or takeaways from this page. `
        + `Start each with a dash (-). Be concrete — include names, numbers, or decisions where present. `
        + `Skip generic observations.`,
    },
  ]),

  explain: (page) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `${pageCtx(page, 3000)}\n\n`
        + `Explain what this page is about in 2 clear sentences. `
        + `Write for someone who has never heard of the topic. `
        + `Avoid jargon. Do not use bullet points.`,
    },
  ]),

  tldr: (page) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `${pageCtx(page, 2500)}\n\n`
        + `One sentence TL;DR. Start directly with the subject — no preamble like "This page...". `
        + `Maximum 25 words.`,
    },
  ]),

  ask: (page, question) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `${pageCtx(page, 4500)}\n\n`
        + `Question: ${question}\n\n`
        + `Answer using only the content above. If the answer is not present, say exactly: "Not covered on this page." `
        + `Keep the answer under 3 sentences.`,
    },
  ]),

  explainSelection: (selection) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `Selected text:\n"${selection.slice(0, 1200)}"\n\n`
        + `Explain what this means in plain language. `
        + `2–3 sentences max. No bullet points. Assume the reader is not an expert.`,
    },
  ]),

  define: (word) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `Word or phrase: "${word.slice(0, 80)}"\n\n`
        + `Provide: 1) A clear one-sentence definition. 2) One natural example sentence using it. `
        + `Keep it simple and direct. No headers, no dashes, no bullets. Two sentences total.`,
    },
  ]),

  synonyms: (word) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `Word: "${word.slice(0, 80)}"\n\n`
        + `List 4 synonyms and 2 antonyms. Format:\n`
        + `Synonyms: word1, word2, word3, word4\n`
        + `Antonyms: word1, word2\n`
        + `Nothing else. Exact format required.`,
    },
  ]),

  explainCode: (snippet) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `Code:\n\`\`\`\n${snippet.slice(0, 1500)}\n\`\`\`\n\n`
        + `Explain what this code does in plain English. `
        + `2–3 sentences. No bullet points. Mention the language if obvious.`,
    },
  ]),

  summarizeDiscussion: (page) => ([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: `${pageCtx(page, 4000)}\n\n`
        + `This page contains a discussion or comment thread. `
        + `Summarize the main viewpoints and any consensus reached. `
        + `Write exactly 3 bullet points starting with a dash (-). `
        + `Be specific — include the key opinions, not just the topic.`,
    },
  ]),

};

export { TOKEN_BUDGET };
