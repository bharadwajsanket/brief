/*
 * Brief — site-context.js
 * Lightweight site type detection from URL hostname.
 * Pure function — no browser APIs. Used by popup.js to adapt wording.
 */

/**
 * detectSiteContext(url)
 * Returns { type, primaryLabel, primaryIcon, placeholder }
 * based on the page URL's hostname.
 */
export function detectSiteContext(url) {
  if (!url) return DEFAULT;
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return DEFAULT; }

  for (const [pattern, ctx] of RULES) {
    if (typeof pattern === 'function' ? pattern(host) : host.includes(pattern)) return ctx;
  }
  return DEFAULT;
}

const DEFAULT = {
  type: 'default',
  primaryLabel: 'Summarize',
  primaryIcon: 'list',
  placeholder: 'Ask anything about this page…',
  discussLabel: null,
};

const RULES = [
  // Code & Dev
  ['github.com', { type: 'github', primaryLabel: 'Explain Repo', primaryIcon: 'code', placeholder: 'Ask about this repository…', discussLabel: null }],
  ['gitlab.com', { type: 'github', primaryLabel: 'Explain Repo', primaryIcon: 'code', placeholder: 'Ask about this repository…', discussLabel: null }],
  ['stackoverflow.com', { type: 'qa', primaryLabel: 'Summarize Answers', primaryIcon: 'list', placeholder: 'Ask about this question…', discussLabel: null }],
  ['stackexchange.com', { type: 'qa', primaryLabel: 'Summarize Answers', primaryIcon: 'list', placeholder: 'Ask about this discussion…', discussLabel: null }],
  ['developer.mozilla.org', { type: 'docs', primaryLabel: 'Explain Docs', primaryIcon: 'book', placeholder: 'Ask about this documentation…', discussLabel: null }],
  ['docs.python.org', { type: 'docs', primaryLabel: 'Explain Docs', primaryIcon: 'book', placeholder: 'Ask about this documentation…', discussLabel: null }],
  [host => host.startsWith('docs.'), { type: 'docs', primaryLabel: 'Explain Docs', primaryIcon: 'book', placeholder: 'Ask about this documentation…', discussLabel: null }],

  // Discussion
  ['reddit.com', { type: 'reddit', primaryLabel: 'Summarize Thread', primaryIcon: 'chat', placeholder: 'Ask about this discussion…', discussLabel: 'Summarize Comments' }],
  ['news.ycombinator.com', { type: 'hn', primaryLabel: 'Summarize Thread', primaryIcon: 'chat', placeholder: 'Ask about this thread…', discussLabel: 'Summarize Comments' }],
  ['twitter.com', { type: 'social', primaryLabel: 'Summarize Thread', primaryIcon: 'chat', placeholder: 'Ask about this thread…', discussLabel: null }],
  ['x.com', { type: 'social', primaryLabel: 'Summarize Thread', primaryIcon: 'chat', placeholder: 'Ask about this thread…', discussLabel: null }],

  // Video
  ['youtube.com', { type: 'video', primaryLabel: 'Summarize Video', primaryIcon: 'play', placeholder: 'Ask about this video…', discussLabel: null }],
  ['vimeo.com', { type: 'video', primaryLabel: 'Summarize Video', primaryIcon: 'play', placeholder: 'Ask about this video…', discussLabel: null }],

  // News & Articles
  [host => /\b(news|article|story|post)\b/.test(host), { type: 'news', primaryLabel: 'Brief This Article', primaryIcon: 'list', placeholder: 'Ask about this article…', discussLabel: null }],
  ['medium.com', { type: 'article', primaryLabel: 'Brief This Article', primaryIcon: 'list', placeholder: 'Ask about this article…', discussLabel: null }],
  ['substack.com', { type: 'article', primaryLabel: 'Brief This Article', primaryIcon: 'list', placeholder: 'Ask about this post…', discussLabel: null }],
  ['wikipedia.org', { type: 'wiki', primaryLabel: 'Summarize Article', primaryIcon: 'list', placeholder: 'Ask about this topic…', discussLabel: null }],

  // Shopping / Product
  ['amazon.com', { type: 'product', primaryLabel: 'Summarize Product', primaryIcon: 'list', placeholder: 'Ask about this product…', discussLabel: 'Summarize Reviews' }],
];
