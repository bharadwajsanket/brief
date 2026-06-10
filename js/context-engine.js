/**
 * Brief v5.0.1 — context-engine.js
 * Context formatting and reading intelligence metrics.
 */

export class ContextEngine {
  /**
   * Translates tab URL to UI-specific buttons, actions, and placeholders.
   */
  static detectSiteContext(url) {
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

    if (!url) return DEFAULT;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return DEFAULT; }

    const RULES = [
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
      [h => h.startsWith('docs.'), {
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
          { role: 'TL;DR',         type: 'tldr' },
        ],
      }],
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
      [h => /\b(news|article|story|post)\b/.test(h), {
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

    for (const [pattern, ctx] of RULES) {
      if (typeof pattern === 'function' ? pattern(host) : host.includes(pattern)) return ctx;
    }
    return DEFAULT;
  }

  /**
   * Builds the formatted context string for the Prompt Engine based on page type.
   */
  static buildContext(extraction) {
    if (!extraction || !extraction.data) {
      return 'No context available for this page.';
    }

    const { pageType, metadata, url } = extraction;
    const data = extraction.data;

    switch (pageType) {
      case 'github':
        return ContextEngine.formatGitHubContext(data);
      case 'youtube':
        return ContextEngine.formatYouTubeContext(data);
      case 'reddit':
        return ContextEngine.formatRedditContext(data);
      case 'docs':
        return ContextEngine.formatDocsContext(data);
      case 'article':
        return ContextEngine.formatArticleContext(data, metadata);
      default:
        return ContextEngine.formatGenericContext(data, metadata);
    }
  }

  // ── GitHub Formatting ──────────────────────────────────────────────────────
  static formatGitHubContext(data) {
    const parts = [
      `Repository: ${data.repository || 'Unknown'}`,
      `Owner: ${data.owner || 'Unknown'}`,
      `Description: ${data.description || 'No description provided.'}`,
      `Primary Language: ${data.language || 'Unknown'}`,
      `Topics: ${(data.topics || []).join(', ') || 'None'}`,
      `Release: ${data.release || 'None'}`,
      `Stars: ${data.stars || '0'}`,
      `Forks: ${data.forks || '0'}`,
      `Watchers: ${data.watchers || '0'}`,
      `Tech Stack: ${data.techStack || 'Unknown'}`,
      `License: ${data.license || 'Not specified'}`
    ];

    if (data.files && data.files.length > 0) {
      parts.push('Directory Structure / Files:\n' + data.files.map(f => `- ${f}`).join('\n'));
    }

    if (data.currentFile) {
      parts.push(`Current File Being Viewed: ${data.currentFile}`);
      if (data.currentCode) {
        parts.push(`Current Code Content:\n\`\`\`\n${data.currentCode}\n\`\`\``);
      }
    }

    if (data.readme) {
      parts.push(`README Content:\n${data.readme}`);
    }

    return parts.join('\n\n');
  }

  // ── YouTube Formatting ─────────────────────────────────────────────────────
  static formatYouTubeContext(data) {
    const parts = [
      `Title: ${data.title || 'Unknown'}`,
      `Channel: ${data.channel || 'Unknown'}`,
      `Description: ${data.description || 'No description.'}`,
      `Duration: ${data.duration || 'Unknown'}`,
      `Current Timestamp: ${data.currentTimestamp || '0:00'}`
    ];

    if (data.chapters && data.chapters.length > 0) {
      parts.push('Chapters:\n' + data.chapters.map(c => `- ${c}`).join('\n'));
    }

    if (data.pinnedComment) {
      parts.push(`Pinned Comment: "${data.pinnedComment}"`);
    }

    if (data.transcript && data.transcript.length > 0) {
      parts.push('Transcript:\n' + data.transcript.map(t => `[${t.ts}]: ${t.text}`).join('\n'));
    } else {
      parts.push('Transcript: Transcript unavailable. Summary based on metadata only.');
    }

    return parts.join('\n\n');
  }

  // ── Reddit Formatting ──────────────────────────────────────────────────────
  static formatRedditContext(data) {
    const parts = [
      `Post Title: ${data.title || 'Unknown'}`,
      `Post Body: ${data.body || 'No text content.'}`
    ];

    if (data.comments && data.comments.length > 0) {
      const formattedComments = data.comments.map(c => 
        `- ${c.author} (Score: ${c.score}): ${c.text}`
      ).join('\n');
      parts.push(`Discussion Comments:\n${formattedComments}`);
    } else {
      parts.push('Discussion Comments: No comments retrieved.');
    }

    return parts.join('\n\n');
  }

  // ── Documentation Formatting ────────────────────────────────────────────────
  static formatDocsContext(data) {
    const parts = [
      `Title: ${data.title || 'Documentation'}`
    ];

    if (data.elements && data.elements.length > 0) {
      const formattedElems = data.elements.map(el => {
        if (el.type === 'heading') {
          return `${'#'.repeat(Math.min(el.level, 5))} ${el.content}`;
        } else if (el.type === 'code') {
          return `\`\`\`\n${el.content}\n\`\`\``;
        } else {
          return el.content;
        }
      }).join('\n\n');
      parts.push(`Documentation Content:\n${formattedElems}`);
    }

    return parts.join('\n\n');
  }

  // ── Article Formatting ─────────────────────────────────────────────────────
  static formatArticleContext(data, metadata) {
    const parts = [
      `Title: ${data.title || metadata.ogTitle || 'Article'}`,
      `Byline/Author: ${data.byline || 'Unknown'}`,
      `Site Name: ${data.siteName || 'Unknown'}`,
      `Excerpt: ${data.excerpt || metadata.description || 'No excerpt.'}`,
      `Content:\n${data.textContent || ''}`
    ];

    return parts.join('\n\n');
  }

  // ── Generic Formatting ─────────────────────────────────────────────────────
  static formatGenericContext(data, metadata) {
    const parts = [
      `Title: ${data.title || metadata.ogTitle || 'Web Page'}`,
      `Description: ${metadata.description || metadata.ogDescription || 'No description.'}`,
      `Content:\n${data.text || ''}`
    ];

    return parts.join('\n\n');
  }

  // ── Compute Reading Intelligence ───────────────────────────────────────────
  static computeReadingIntel(extraction) {
    if (!extraction) {
      return { readTimeStr: '', difficultyStr: '' };
    }

    const { pageType, wordCount, url, data } = extraction;
    
    // Check if this is a product page (e.g. Amazon)
    const isProduct = pageType === 'product' || 
                      url?.includes('amazon.') || 
                      url?.includes('flipkart.com') || 
                      url?.includes('bestbuy.com') ||
                      (data && data.isProduct);

    if (isProduct) {
      return { readTimeStr: 'Product Page', difficultyStr: '' };
    }

    // 1. YouTube
    if (pageType === 'youtube') {
      if (data && data.duration) {
        return { readTimeStr: `${data.duration.replace(' minutes', '')} min video`, difficultyStr: '' };
      }
      return { readTimeStr: 'Video', difficultyStr: '' };
    }

    // 2. GitHub
    if (pageType === 'github') {
      const readmeWordCount = data && data.readme ? data.readme.split(/\s+/).filter(Boolean).length : 0;
      const mins = Math.max(1, Math.round(readmeWordCount / 200));
      return { readTimeStr: `${mins} min`, difficultyStr: '' };
    }

    // Default word extraction for diff calculations
    let text = '';
    if (data) {
      text = data.textContent || data.text || '';
    }

    // 3. Documentation
    let readTimeStr = '';
    if (pageType === 'docs') {
      const mins = Math.max(1, Math.round(wordCount / 180));
      readTimeStr = `${mins} min`;
    } else {
      // 4. Articles / Generic
      const mins = Math.max(1, Math.round(wordCount / 225));
      readTimeStr = `${mins} min`;
    }

    // Difficulty heuristic (only for prose pages like docs, articles, generic)
    let difficultyStr = '';
    if (text && text.trim().length > 50) {
      const words = text.split(/\s+/).filter(Boolean);
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const avgSentenceLen = sentences.length > 0 ? wordCount / sentences.length : 15;
      const avgWordLen = words.reduce((s, w) => s + w.replace(/[^a-z]/gi, '').length, 0) / Math.max(wordCount, 1);

      if (avgSentenceLen > 25 || avgWordLen > 7) {
        difficultyStr = 'Advanced';
      } else if (avgSentenceLen > 15 || avgWordLen > 5.5) {
        difficultyStr = 'Medium';
      } else {
        difficultyStr = 'Easy';
      }
    }

    return { readTimeStr, difficultyStr };
  }
}
