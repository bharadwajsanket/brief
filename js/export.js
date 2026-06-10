/*
 * Brief — export.js v5.0.1
 * Pure module. No browser APIs except Blob/URL/clipboard (safe in popup context).
 * Converts AI responses and insights to Markdown, JSON, or clipboard.
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
    `> **Generated:** ${ts} · Brief / Local AI`,
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
    poweredBy: 'Local AI',
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

/**
 * Build and download all insights as a single Markdown file.
 * @param {Array<{ tag: string, text: string, url: string }>} insights
 */
export function exportAllInsightsAsMarkdown(insights) {
  if (!insights || !insights.length) return;
  const ts = new Date().toLocaleString();
  const lines = [
    '# Brief — All Insights',
    '',
    `Exported: ${ts}`,
    `Total: ${insights.length} insight${insights.length !== 1 ? 's' : ''}`,
    '',
    '---',
  ];
  insights.forEach((ins, i) => {
    lines.push('');
    lines.push(`## ${i + 1}. ${ins.tag}`);
    lines.push('');
    lines.push(ins.text.trim());
    if (ins.url) { lines.push(''); lines.push(`_Source: ${ins.url}_`); }
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'brief-insights.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
