/**
 * Brief v5.0.1 — site-adapters.js
 * Domain-specific page extractors.
 * Designed to execute in the tab context (web page DOM).
 */

(function () {
  'use strict';

  const BriefSiteAdapters = {};

  // ── Helper: Clean Text ─────────────────────────────────────────────────────
  function clean(str) {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').trim();
  }

  // ── GitHub Extractor ───────────────────────────────────────────────────────
  BriefSiteAdapters.GitHubExtractor = {
    extract: async () => {
      const parts = [];
      const host = location.hostname.replace(/^www\./, '');
      const pathParts = location.pathname.split('/').filter(Boolean);

      const owner = pathParts[0] || '';
      const repository = pathParts[1] || '';
      const isFileView = location.pathname.includes('/blob/') || location.pathname.includes('/tree/');

      // Repo title/meta
      const repoTitle = `${owner}/${repository}`;

      // Description
      const descEl = document.querySelector('[data-testid="repository-description"], p.f4.my-3, .repository-description, .BorderGrid-cell p.color-fg-muted');
      const description = descEl?.textContent?.trim() || '';

      // Primary Language
      const langEl = document.querySelector('li.d-inline-flex a[data-ga-click*="Repository, language"] span, li.d-inline-flex span:not([class])');
      const language = langEl?.textContent?.trim() || '';

      // Topics
      const topics = Array.from(document.querySelectorAll('[data-octo-dimensions*="topic"], a.topic-tag, a[href*="/topics/"]'))
        .map(t => t.textContent.trim())
        .filter(Boolean);

      // Stats
      const starsEl = document.querySelector('a[href$="/stargazers"] .Counter, #repo-stars-counter-star');
      const forksEl = document.querySelector('a[href$="/forks"] .Counter, #repo-network-counter');
      const watchersEl = document.querySelector('a[href$="/watchers"] .Counter, #repo-notifications-counter');
      const stars = starsEl?.textContent?.trim() || '0';
      const forks = forksEl?.textContent?.trim() || '0';
      const watchers = watchersEl?.textContent?.trim() || '0';

      // Latest Release
      const releaseEl = document.querySelector('.BorderGrid-cell a[href*="/releases"] span, a[href*="/releases/tag/"] span');
      const release = releaseEl?.textContent?.trim() || 'None';

      // README Content
      let readme = '';
      const readmeEl = document.querySelector('#readme article.markdown-body, #readme .markdown-body, article.markdown-body[class], div[data-target="readme-toc.content"] .markdown-body');
      if (readmeEl) {
        const c = readmeEl.cloneNode(true);
        c.querySelectorAll('script, style, svg, canvas, img[src*="shields.io"], img[src*="badge"], a.anchor').forEach(e => e.remove());
        readme = (c.innerText || c.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
      }

      // Directory listing
      const fileEls = document.querySelectorAll(
        '.react-directory-row-name-cell-wrapper a, td.content a, .js-navigation-open, .react-directory-filename-column a'
      );
      const files = Array.from(fileEls)
        .map(el => el.textContent.trim())
        .filter(f => f && !f.includes('..') && !f.includes('Go to parent'));

      // File view details
      let currentFile = '';
      let currentCode = '';
      if (isFileView) {
        currentFile = document.querySelector('.final-path')?.textContent?.trim() || pathParts.slice(3).join('/');
        const fileLines = document.querySelectorAll('.blob-code-inner, #read-only-cursor-text-area, .react-file-line-html');
        currentCode = Array.from(fileLines).map(el => el.textContent).join('\n').trim();
      }

      // Tech Stack heuristics based on files & elements
      const techStackList = new Set();
      if (language) techStackList.add(language);
      files.forEach(f => {
        const lower = f.toLowerCase();
        if (lower === 'package.json') techStackList.add('Node.js/npm');
        if (lower === 'cargo.toml') techStackList.add('Rust/Cargo');
        if (lower === 'go.mod') techStackList.add('Go');
        if (lower === 'pyproject.toml' || lower === 'requirements.txt') techStackList.add('Python');
        if (lower === 'composer.json') techStackList.add('PHP/Composer');
        if (lower === 'makefile') techStackList.add('Makefile');
        if (lower === 'gemfile') techStackList.add('Ruby/Bundler');
      });
      const techStack = Array.from(techStackList).join(', ');

      // License
      const licenseEl = document.querySelector('.BorderGrid-cell a[href*="LICENSE"], a[href*="LICENSE"]');
      const license = licenseEl?.textContent?.trim() || 'Not specified';

      const extractedData = {
        repository: repoTitle,
        owner,
        description,
        language,
        topics,
        release,
        stars,
        forks,
        watchers,
        readme: readme.slice(0, 8000), // budget README
        files: files.slice(0, 50),     // top 50 files
        currentFile,
        currentCode: currentCode.slice(0, 6000), // budget code content
        techStack,
        license
      };

      const hasRepoName = !!repoTitle;
      const hasDescription = !!description;
      const success = hasRepoName && hasDescription;

      // Log extracted object size
      const dataStr = JSON.stringify(extractedData);
      const dataSize = dataStr.length;

      console.log("[Brief Adapter]", {
        adapter: "GitHubExtractor",
        success,
        repository: hasRepoName,
        owner: !!owner,
        description: hasDescription,
        readme: !!extractedData.readme,
        currentFile: !!currentFile,
        currentCode: !!extractedData.currentCode,
        files: files.length,
        sizeBytes: dataSize
      });

      if (!success) {
        console.warn("[Brief] GitHubExtractor marked as failed due to missing repository name or description.");
        return null;
      }

      return extractedData;
    }
  };

  // ── YouTube Extractor ──────────────────────────────────────────────────────
  BriefSiteAdapters.YouTubeExtractor = {
    extract: async () => {
      // 1. Verify description is expanded to make metadata accessible
      const expandButton = document.querySelector('#expand, ytd-text-inline-expander [role="button"], #description-inline-expander tp-yt-paper-button');
      if (expandButton && expandButton.getAttribute('aria-expanded') !== 'true') {
        expandButton.click();
        await new Promise(r => setTimeout(r, 200));
      }

      // 2. Transcript trigger
      let segs = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (!segs.length) {
        const showTranscriptBtn = document.querySelector(
          'button[aria-label*="transcript" i], ytd-button-renderer#trigger-button, tp-yt-paper-button[aria-label*="transcript" i], [aria-label*="Show transcript" i]'
        ) || [...document.querySelectorAll('button, tp-yt-paper-button, ytd-button-renderer')]
          .find(el => el.textContent?.toLowerCase().includes('transcript'));

        if (showTranscriptBtn) {
          showTranscriptBtn.click();
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            segs = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segs.length) break;
          }
        }
      }

      // Metadata
      const title = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, ytd-watch-metadata h1 yt-formatted-string')?.textContent?.trim() || document.title;
      const channel = document.querySelector('ytd-channel-name a, ytd-video-owner-renderer #channel-name a')?.textContent?.trim() || '';
      const descEl = document.querySelector('#description-inline-expander, #description-text, ytd-expandable-video-description-body-renderer');
      const description = descEl?.textContent?.trim() || '';

      const videoEl = document.querySelector('video');
      const durationSec = videoEl ? videoEl.duration : 0;
      let durationMins = durationSec ? Math.round(durationSec / 60) : 0;
      let currentTimestamp = '';
      if (videoEl) {
        const curr = Math.round(videoEl.currentTime);
        const hrs = Math.floor(curr / 3600);
        const mins = Math.floor((curr % 3600) / 60);
        const secs = curr % 60;
        currentTimestamp = hrs > 0 
          ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          : `${mins}:${String(secs).padStart(2, '0')}`;
      }

      // Parse transcript segments with timestamps
      const transcriptList = [];
      segs.forEach(s => {
        const ts = s.querySelector('.segment-timestamp')?.textContent?.trim() || '';
        const txt = s.querySelector('.segment-text')?.textContent?.trim() || '';
        if (txt) {
          transcriptList.push({ ts, text: txt });
        }
      });

      // Chapters
      const chapterEls = document.querySelectorAll('#panels ytd-chapter-renderer #title, ytd-macro-markers-list-item-renderer #headline');
      const chapters = Array.from(chapterEls).map(c => {
        const timeEl = c.closest('ytd-macro-markers-list-item-renderer')?.querySelector('#time') || c.parentElement?.querySelector('.time');
        return `${timeEl?.textContent?.trim() || ''} ${c.textContent.trim()}`.trim();
      }).filter(Boolean);

      // Pinned comment
      let pinnedComment = '';
      const commentThreads = document.querySelectorAll('ytd-comment-thread-renderer');
      for (const t of commentThreads) {
        const pinnedBadge = t.querySelector('ytd-pinned-comment-badge-renderer');
        if (pinnedBadge) {
          pinnedComment = t.querySelector('#content-text')?.textContent?.trim() || '';
          break;
        }
      }

      const extractedData = {
        title,
        channel,
        description: description.slice(0, 2000),
        duration: durationMins ? `${durationMins} minutes` : 'Unknown',
        currentTimestamp,
        transcript: transcriptList.length ? transcriptList : null,
        chapters: chapters.length ? chapters : null,
        pinnedComment
      };

      const success = !!title;

      console.log("[Brief Adapter]", {
        adapter: "YouTubeExtractor",
        success,
        title: !!title,
        channel: !!channel,
        transcript: !!transcriptList.length,
        description: !!description
      });

      console.log("[Brief YouTube Details]", {
        title,
        channel,
        descriptionLength: description.length,
        transcriptLength: transcriptList.length,
        chapterCount: chapters.length
      });

      return extractedData;
    }
  };

  // ── Reddit Extractor ───────────────────────────────────────────────────────
  BriefSiteAdapters.RedditExtractor = {
    extract: async () => {
      const title = document.querySelector('shreddit-title')?.getAttribute('title')
                 || document.querySelector('[data-testid="post-title"], .Post h1, h1, .top-matter p.title a')?.textContent?.trim()
                 || document.title;

      const bodyEl = document.querySelector('shreddit-post [slot="text-body"], [data-click-id="text"] div, .RichTextJSON-root, .usertext-body .md');
      const body = bodyEl?.textContent?.trim() || '';

      const commentsList = [];
      const shredditComments = document.querySelectorAll('shreddit-comment');
      if (shredditComments.length) {
        shredditComments.forEach(c => {
          const author = c.getAttribute('author') || 'Anonymous';
          const score = parseInt(c.getAttribute('score') || '0', 10);
          const bodyText = c.querySelector('[id*="-post-rtjson-content"], p, .md')?.textContent?.trim() || '';
          if (bodyText) {
            commentsList.push({ author, score, text: bodyText });
          }
        });
      } else {
        const oldComments = document.querySelectorAll('.comment, [data-testid="comment"]');
        oldComments.forEach(c => {
          const author = c.querySelector('.author, [data-testid="comment-author"]')?.textContent?.trim() || 'Anonymous';
          const scoreText = c.querySelector('.score.unvoted, [data-testid="comment-score"]')?.textContent?.trim() || '0';
          const score = parseInt(scoreText.replace(/[^0-9-]/g, ''), 10) || 0;
          const bodyText = c.querySelector('.usertext-body .md, .RichTextJSON-root')?.textContent?.trim() || '';
          if (bodyText) {
            commentsList.push({ author, score, text: bodyText });
          }
        });
      }

      // Sort comments by score descending to get top inputs
      commentsList.sort((a, b) => b.score - a.score);

      const extractedData = {
        title,
        body,
        comments: commentsList.slice(0, 25) // Top 25 comments
      };

      const success = !!title;

      console.log("[Brief Adapter]", {
        adapter: "RedditExtractor",
        success,
        title: !!title,
        body: !!body,
        commentsCount: commentsList.length
      });

      return extractedData;
    }
  };

  // ── Documentation Extractor ────────────────────────────────────────────────
  BriefSiteAdapters.DocumentationExtractor = {
    extract: async () => {
      const docRoot = document.querySelector('article')
                   || document.querySelector('main')
                   || document.querySelector('[role="main"]')
                   || document.querySelector('.md-content, .rst-content, #main-content, .documentation-content');
      
      if (!docRoot) return null;

      const clone = docRoot.cloneNode(true);
      // Clean noise (navigation, sidebars, headers, footers, ads)
      const NOISE_SELECTORS = [
        'nav', 'aside', 'footer', 'header', '.sidebar', '.toc', '.table-of-contents',
        '.navigation', '.ads', 'script', 'style', '[class*="nav"]', '[class*="sidebar"]',
        '[class*="toc"]', '[class*="footer"]', '[class*="header"]', '[class*="ads"]',
        '[class*="menu"]', '.breadcrumbs', '.breadcrumb', '.related-links', '.banner'
      ].join(',');
      clone.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove());

      // Extract main structural elements
      const elements = [];
      function walk(n) {
        if (n.nodeType === 3) {
          const txt = n.textContent.trim();
          if (txt) {
            const last = elements[elements.length - 1];
            if (last && last.type === 'text') {
              last.content += ' ' + txt;
            } else {
              elements.push({ type: 'text', content: txt });
            }
          }
          return;
        }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        
        if (tag === 'pre' || tag === 'code') {
          const codeText = n.textContent.trim();
          if (codeText) {
            elements.push({ type: 'code', content: codeText });
          }
          return;
        }

        if (/^h[1-6]$/.test(tag)) {
          const headingText = n.textContent.trim();
          if (headingText) {
            elements.push({ type: 'heading', level: parseInt(tag[1], 10), content: headingText });
          }
          return;
        }

        n.childNodes.forEach(walk);
      }
      walk(clone);

      const extractedData = {
        title: document.title,
        elements: elements.slice(0, 150) // limit size to keep prompt constraints
      };

      const success = !!(elements && elements.length > 0);

      console.log("[Brief Adapter]", {
        adapter: "DocumentationExtractor",
        success,
        title: !!document.title,
        elementsCount: elements.length
      });

      return extractedData;
    }
  };

  // ── Readability Extractor ──────────────────────────────────────────────────
  BriefSiteAdapters.ReadabilityExtractor = {
    extract: async () => {
      if (typeof window.Readability !== 'function') {
        throw new Error('Readability parser is not loaded.');
      }
      // Clone document to avoid destroying live page elements
      const docClone = document.cloneNode(true);
      const article = new window.Readability(docClone).parse();
      if (!article) return null;

      const extractedData = {
        title: article.title,
        byline: article.byline,
        siteName: article.siteName,
        content: article.content,
        textContent: article.textContent,
        excerpt: article.excerpt
      };

      const success = !!article.textContent;

      console.log("[Brief Adapter]", {
        adapter: "ReadabilityExtractor",
        success,
        title: !!article.title,
        textContent: !!article.textContent
      });

      return extractedData;
    }
  };

  // ── Generic Extractor ──────────────────────────────────────────────────────
  BriefSiteAdapters.GenericExtractor = {
    extract: async () => {
      // Score and extract page content using a semantic paragraph density heuristic
      const NOISE = [
        'script','style','noscript','iframe','svg','canvas',
        'header:not(article header)','footer:not(article footer)',
        'nav','[role="navigation"]','aside','[role="complementary"]',
        '#sidebar','.sidebar','[class*="sidebar"]','[class*="menu"]',
        '[class*="cookie"]','[class*="popup"]','[class*="modal"]',
        '[class*="overlay"]','[class*="banner"]','[class*="advert"]',
        '[class*="social"]','[class*="share"]','[class*="related"]',
        '[class*="newsletter"]','[class*="-ad-"]','[class*="promo"]',
        '[aria-label*="advertisement" i]','form:not(article form)',
        '[class*="recommend"]','[class*="toc"]','.toc','.table-of-contents'
      ].join(',');

      const CONTENT = [
        'article','[role="main"]','main',
        '.post-content','.article-content','.entry-content',
        '.post-body','.article-body','.story-body',
        '#content','#main-content','#article-content','.content-body',
      ].join(',');

      function scoreEl(el) {
        const c = el.cloneNode(true);
        try { c.querySelectorAll(NOISE).forEach(n => n.remove()); } catch {}
        const t = (c.innerText || c.textContent || '').trim();
        const words = t.split(/\s+/).filter(Boolean).length;
        if (words < 50) return -1;
        const links = c.querySelectorAll('a');
        let lc = 0; links.forEach(a => { lc += (a.textContent || '').length; });
        const lr = lc / Math.max(t.length, 1);
        if (lr > 0.5) return -1;
        return words - Math.round(words * lr * 2);
      }

      let best = null, bestScore = -1;
      document.querySelectorAll(CONTENT).forEach(el => {
        const s = scoreEl(el);
        if (s > bestScore) { bestScore = s; best = el; }
      });
      const root = best ?? document.body;
      const clone = root.cloneNode(true);
      try { clone.querySelectorAll(NOISE).forEach(e => e.remove()); } catch {}

      const blocks = [];
      function walk(n) {
        if (n.nodeType === 3) {
          const t = n.textContent.replace(/\s+/g,' ');
          if (t.trim()) blocks.push(t);
          return;
        }
        if (n.nodeType !== 1) return;
        const tag = (n.tagName||'').toLowerCase();
        const isBlock = /^(p|div|section|blockquote|li|h[1-6]|pre|figure|figcaption)$/.test(tag);
        if (isBlock && blocks.length && blocks[blocks.length-1] !== '\n\n') blocks.push('\n\n');
        if (tag === 'br') { blocks.push('\n'); return; }
        n.childNodes.forEach(walk);
        if (isBlock) blocks.push('\n\n');
      }
      walk(clone);

      let text = blocks.join('').replace(/\n{3,}/g,'\n\n').trim();
      if (!text) text = (clone.textContent||'').replace(/\s+/g,' ').trim();

      const extractedData = {
        title: document.title,
        text
      };

      const success = !!text;

      console.log("[Brief Adapter]", {
        adapter: "GenericExtractor",
        success,
        title: !!document.title,
        text: !!text
      });

      return extractedData;
    }
  };

  // Expose to window context for extension scripting execution
  window.BriefSiteAdapters = BriefSiteAdapters;

})();
