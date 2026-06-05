/*
 * Brief — site-context.js v4.5.0
 * Lightweight site type detection from URL hostname.
 * Pure function — no browser APIs. Used by popup.js to adapt wording and pills.
 */

/**
 * detectSiteContext(url)
 * Returns { type, primaryLabel, primaryType, placeholder, discussLabel, secondaryActions[] }
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
  primaryType: 'summarize',
  placeholder: 'Ask anything about this page…',
  discussLabel: null,
  secondaryActions: [
    { label: 'Key Points',  type: 'keyPoints' },
    { label: 'Explain',     type: 'explain' },
    { label: 'TL;DR',       type: 'tldr' },
  ],
};

const RULES = [
  // ── Code & Dev ──────────────────────────────────────────────────────────────
  ['github.com', {
    type: 'github',
    primaryLabel: 'Explain Repo',
    primaryType: 'explainRepo',
    placeholder: 'Ask about this repository or file…',
    discussLabel: null,
    secondaryActions: [
      { label: 'What Does This Do?', type: 'whatDoesThisCodeDo' },
      { label: 'Key Points',         type: 'keyPoints' },
      { label: 'TL;DR',              type: 'tldr' },
    ],
  }],
  ['gitlab.com', {
    type: 'github',
    primaryLabel: 'Explain Repo',
    primaryType: 'explainRepo',
    placeholder: 'Ask about this repository…',
    discussLabel: null,
    secondaryActions: [
      { label: 'What Does This Do?', type: 'whatDoesThisCodeDo' },
      { label: 'Key Points',         type: 'keyPoints' },
      { label: 'TL;DR',              type: 'tldr' },
    ],
  }],

  // ── Stack Overflow ──────────────────────────────────────────────────────────
  ['stackoverflow.com', {
    type: 'qa',
    primaryLabel: 'Explain Solution',
    primaryType: 'explainSolution',
    placeholder: 'Ask about this question or answer…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Simpler Explanation', type: 'simplerExplanation' },
      { label: 'Key Fix',             type: 'keyFix' },
      { label: 'Key Points',          type: 'keyPoints' },
    ],
  }],
  ['stackexchange.com', {
    type: 'qa',
    primaryLabel: 'Explain Solution',
    primaryType: 'explainSolution',
    placeholder: 'Ask about this question…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Simpler Explanation', type: 'simplerExplanation' },
      { label: 'Key Fix',             type: 'keyFix' },
      { label: 'Key Points',          type: 'keyPoints' },
    ],
  }],

  // ── Documentation ───────────────────────────────────────────────────────────
  ['developer.mozilla.org', {
    type: 'docs',
    primaryLabel: 'Explain Docs',
    primaryType: 'explainDocsConcepts',
    placeholder: 'Ask about this documentation…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Concepts',         type: 'explainDocsConcepts' },
      { label: 'Beginner Explanation', type: 'beginnerExplanation' },
      { label: 'Give Example',         type: 'explain' },
    ],
  }],
  ['docs.python.org', {
    type: 'docs',
    primaryLabel: 'Explain Docs',
    primaryType: 'explainDocsConcepts',
    placeholder: 'Ask about this Python documentation…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Concepts',         type: 'explainDocsConcepts' },
      { label: 'Beginner Explanation', type: 'beginnerExplanation' },
      { label: 'TL;DR',               type: 'tldr' },
    ],
  }],
  [host => host.startsWith('docs.'), {
    type: 'docs',
    primaryLabel: 'Explain Docs',
    primaryType: 'explainDocsConcepts',
    placeholder: 'Ask about this documentation…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Concepts',         type: 'explainDocsConcepts' },
      { label: 'Beginner Explanation', type: 'beginnerExplanation' },
      { label: 'TL;DR',               type: 'tldr' },
    ],
  }],

  // ── Discussion ──────────────────────────────────────────────────────────────
  ['reddit.com', {
    type: 'reddit',
    primaryLabel: 'Summarize Discussion',
    primaryType: 'summarizeDiscussion',
    placeholder: 'Ask about this discussion…',
    discussLabel: 'Summarize Comments',
    secondaryActions: [
      { label: 'Community Consensus', type: 'communityConsensus' },
      { label: 'Arguments For',       type: 'argumentsFor' },
      { label: 'Arguments Against',   type: 'argumentsAgainst' },
    ],
  }],
  ['news.ycombinator.com', {
    type: 'hn',
    primaryLabel: 'Summarize Thread',
    primaryType: 'summarizeDiscussion',
    placeholder: 'Ask about this thread…',
    discussLabel: 'Summarize Comments',
    secondaryActions: [
      { label: 'Community Consensus', type: 'communityConsensus' },
      { label: 'Key Points',          type: 'keyPoints' },
      { label: 'Arguments For',       type: 'argumentsFor' },
    ],
  }],
  ['twitter.com', {
    type: 'social',
    primaryLabel: 'Summarize Thread',
    primaryType: 'summarizeDiscussion',
    placeholder: 'Ask about this thread…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Points',    type: 'keyPoints' },
      { label: 'Explain',       type: 'explain' },
      { label: 'TL;DR',         type: 'tldr' },
    ],
  }],
  ['x.com', {
    type: 'social',
    primaryLabel: 'Summarize Thread',
    primaryType: 'summarizeDiscussion',
    placeholder: 'Ask about this thread…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Points',    type: 'keyPoints' },
      { label: 'Explain',       type: 'explain' },
      { label: 'TL;DR',         type: 'tldr' },
    ],
  }],

  // ── Video ───────────────────────────────────────────────────────────────────
  ['youtube.com', {
    type: 'video',
    primaryLabel: 'Summarize Video',
    primaryType: 'summarize',
    placeholder: 'Ask about this video…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Takeaways',   type: 'keyTakeaways' },
      { label: 'Timeline Summary',type: 'timelineSummary' },
      { label: 'Explain Simply',  type: 'explain' },
    ],
  }],
  ['vimeo.com', {
    type: 'video',
    primaryLabel: 'Summarize Video',
    primaryType: 'summarize',
    placeholder: 'Ask about this video…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Takeaways',  type: 'keyTakeaways' },
      { label: 'Key Points',     type: 'keyPoints' },
      { label: 'TL;DR',          type: 'tldr' },
    ],
  }],

  // ── News & Articles ─────────────────────────────────────────────────────────
  [host => /\b(news|article|story|post)\b/.test(host), {
    type: 'news',
    primaryLabel: 'Brief This Article',
    primaryType: 'summarize',
    placeholder: 'Ask about this article…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Points', type: 'keyPoints' },
      { label: 'Explain',    type: 'explain' },
      { label: 'TL;DR',      type: 'tldr' },
    ],
  }],
  ['medium.com', {
    type: 'article',
    primaryLabel: 'Brief This Article',
    primaryType: 'summarize',
    placeholder: 'Ask about this post…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Points',    type: 'keyPoints' },
      { label: 'Key Takeaways', type: 'keyTakeaways' },
      { label: 'TL;DR',         type: 'tldr' },
    ],
  }],
  ['substack.com', {
    type: 'article',
    primaryLabel: 'Brief This Post',
    primaryType: 'summarize',
    placeholder: 'Ask about this post…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Points',    type: 'keyPoints' },
      { label: 'Key Takeaways', type: 'keyTakeaways' },
      { label: 'TL;DR',         type: 'tldr' },
    ],
  }],
  ['wikipedia.org', {
    type: 'wiki',
    primaryLabel: 'Summarize Article',
    primaryType: 'summarize',
    placeholder: 'Ask about this topic…',
    discussLabel: null,
    secondaryActions: [
      { label: 'Key Points',           type: 'keyPoints' },
      { label: 'Beginner Explanation', type: 'beginnerExplanation' },
      { label: 'TL;DR',               type: 'tldr' },
    ],
  }],

  // ── Shopping / Product ──────────────────────────────────────────────────────
  ['amazon.com', {
    type: 'product',
    primaryLabel: 'Summarize Product',
    primaryType: 'summarize',
    placeholder: 'Ask about this product…',
    discussLabel: 'Summarize Reviews',
    secondaryActions: [
      { label: 'Key Points',   type: 'keyPoints' },
      { label: 'Pros & Cons',  type: 'explain' },
      { label: 'TL;DR',        type: 'tldr' },
    ],
  }],
];
