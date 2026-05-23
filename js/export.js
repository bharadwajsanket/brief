/*
 * Brief — export.js
 * Pure module. No browser APIs except Blob/URL (safe in popup context).
 * Converts AI responses to downloadable Markdown or JSON.
 */

/**
 * Build a Markdown string from a Brief AI response.
 * @param {{ tag: string, text: string, url: string, title: string }} opts
 */
export function toMarkdown({ tag, text, url, title }) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    `# ${tag}: ${title || 'Untitled'}`,
    '',
    `> **Source:** [${url}](${url})  `,
    `> **Generated:** ${ts} · Brief (local AI)`,
    '',
    '---',
    '',
    text.trim(),
    '',
  ];
  return lines.join('\n');
}

/**
 * Build a structured JSON string from a Brief AI response.
 */
export function toJSON({ tag, text, url, title }) {
  const payload = {
    source: 'Brief',
    type: tag,
    title: title || '',
    url,
    generatedAt: new Date().toISOString(),
    content: text.trim(),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Trigger a file download in the popup context.
 * @param {'markdown'|'json'} format
 * @param {{ tag: string, text: string, url: string, title: string }} opts
 */
export function download(format, opts) {
  let content, mime, ext;

  if (format === 'json') {
    content = toJSON(opts);
    mime    = 'application/json';
    ext     = 'json';
  } else {
    content = toMarkdown(opts);
    mime    = 'text/markdown';
    ext     = 'md';
  }

  const slug = (opts.title || 'brief-export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');

  const filename = `${slug}.${ext}`;
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
