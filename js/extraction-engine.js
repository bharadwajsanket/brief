/**
 * Brief v5.0.1 — extraction-engine.js
 * Classification, Metadata extraction, and fallback coordinator.
 * Designed to execute in the tab context (web page DOM).
 */

(function () {
  'use strict';

  const BriefExtractionEngine = {};

  // ── Site Classifier ────────────────────────────────────────────────────────
  function classifySite() {
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    const path = location.pathname.toLowerCase();

    // 1. YouTube
    if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
      return { type: 'youtube', confidence: 0.99, extractor: 'YouTubeExtractor' };
    }

    // 2. GitHub / GitLab
    if (host === 'github.com' || host === 'gitlab.com' || host.endsWith('.github.com') || host.endsWith('.gitlab.com')) {
      return { type: 'github', confidence: 0.99, extractor: 'GitHubExtractor' };
    }

    // 3. Reddit
    if (host === 'reddit.com' || host === 'old.reddit.com' || host.endsWith('.reddit.com')) {
      return { type: 'reddit', confidence: 0.99, extractor: 'RedditExtractor' };
    }

    // 4. Documentation
    if (host === 'developer.mozilla.org') {
      return { type: 'docs', confidence: 0.99, extractor: 'DocumentationExtractor' };
    }
    if (host.startsWith('docs.') || path.includes('/docs/') || path.includes('/documentation/')) {
      return { type: 'docs', confidence: 0.90, extractor: 'DocumentationExtractor' };
    }
    if (document.querySelector('meta[name="generator"][content*="Docusaurus" i], .docusaurus')) {
      return { type: 'docs', confidence: 0.95, extractor: 'DocumentationExtractor' };
    }
    if (document.querySelector('meta[name="generator"][content*="GitBook" i], div[id="gitbook-app"], .gitbook-content')) {
      return { type: 'docs', confidence: 0.95, extractor: 'DocumentationExtractor' };
    }
    if (document.querySelector('.rst-content, #readthedocs-embed-options, [class*="readthedocs"]')) {
      return { type: 'docs', confidence: 0.95, extractor: 'DocumentationExtractor' };
    }

    // 5. Articles (Blogs, News)
    if (host.includes('medium.com') || host.includes('substack.com') || host.includes('wikipedia.org')) {
      return { type: 'article', confidence: 0.98, extractor: 'ReadabilityExtractor' };
    }
    if (document.querySelector('meta[property="og:type"][content="article"]')) {
      return { type: 'article', confidence: 0.92, extractor: 'ReadabilityExtractor' };
    }
    const generator = document.querySelector('meta[name="generator"]')?.content || '';
    if (/Ghost|WordPress|Blogger/i.test(generator)) {
      return { type: 'article', confidence: 0.88, extractor: 'ReadabilityExtractor' };
    }

    // Check ld+json schema types
    try {
      const schemas = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of schemas) {
        const text = s.textContent.trim();
        if (text.includes('"Article"') || text.includes('"NewsArticle"') || text.includes('"BlogPosting"')) {
          return { type: 'article', confidence: 0.94, extractor: 'ReadabilityExtractor' };
        }
      }
    } catch {}

    // 6. Generic Fallback
    return { type: 'generic', confidence: 1.0, extractor: 'GenericExtractor' };
  }

  // ── Metadata Extraction ───────────────────────────────────────────────────
  function extractMetadata() {
    const meta = {
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '',
      twitterTitle: document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') || '',
      twitterDescription: document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') || '',
      ldJson: null
    };

    // Grab first valid Article or Product JSON-LD schema
    try {
      const schemas = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of schemas) {
        const parsed = JSON.parse(s.textContent.trim());
        const graph = parsed['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);
        const matched = graph.find(item => 
          /Article|NewsArticle|BlogPosting|Product|TechArticle/i.test(item['@type'] || '')
        );
        if (matched) {
          meta.ldJson = {
            type: matched['@type'],
            name: matched.name || matched.headline,
            description: matched.description
          };
          break;
        }
      }
    } catch {}

    return meta;
  }

  // ── Count words utility ────────────────────────────────────────────────────
  function countWords(txt) {
    if (!txt) return 0;
    return txt.split(/\s+/).filter(Boolean).length;
  }

  // ── Main Extract Function ──────────────────────────────────────────────────
  BriefExtractionEngine.extract = async () => {
    const classification = classifySite();
    const metadata = extractMetadata();

    // Priority ordering fallback chain
    const priorityList = [
      { name: 'GitHubExtractor', method: 'github' },
      { name: 'YouTubeExtractor', method: 'youtube' },
      { name: 'RedditExtractor', method: 'reddit' },
      { name: 'DocumentationExtractor', method: 'docs' },
      { name: 'ReadabilityExtractor', method: 'readability' },
      { name: 'GenericExtractor', method: 'generic' }
    ];

    let currentExtractor = classification.extractor;
    let extractedData = null;
    let finalMethod = classification.type;

    // Run classifier's matching extractor
    try {
      if (window.BriefSiteAdapters && window.BriefSiteAdapters[currentExtractor]) {
        extractedData = await window.BriefSiteAdapters[currentExtractor].extract();
      }
    } catch (e) {
      console.warn(`[Brief] Primary extractor ${currentExtractor} failed:`, e);
    }

    // Fallback loop if primary extraction failed to yield structured data
    if (!extractedData) {
      console.log(`[Brief] Primary extractor ${currentExtractor} returned no data. Initiating fallback chain.`);
      for (const entry of priorityList) {
        if (entry.name === currentExtractor) continue; // skip what already failed
        try {
          if (window.BriefSiteAdapters && window.BriefSiteAdapters[entry.name]) {
            const result = await window.BriefSiteAdapters[entry.name].extract();
            if (result) {
              extractedData = result;
              currentExtractor = entry.name;
              finalMethod = entry.method;
              break;
            }
          }
        } catch (e) {
          console.warn(`[Brief] Fallback extractor ${entry.name} failed:`, e);
        }
      }
    }

    // Compute metrics
    let wordCount = 0;
    let sampleText = '';
    if (extractedData) {
      if (extractedData.readme) {
        sampleText = extractedData.readme;
      } else if (extractedData.currentCode) {
        sampleText = extractedData.currentCode;
      } else if (extractedData.transcript) {
        if (Array.isArray(extractedData.transcript)) {
          sampleText = extractedData.transcript.map(t => t.text).join(' ');
        } else {
          sampleText = String(extractedData.transcript);
        }
      } else if (extractedData.textContent) {
        sampleText = extractedData.textContent;
      } else if (extractedData.text) {
        sampleText = extractedData.text;
      } else if (extractedData.body) {
        sampleText = (extractedData.title || '') + ' ' + extractedData.body;
      } else if (extractedData.elements) {
        sampleText = extractedData.elements.map(e => e.content).join(' ');
      } else if (extractedData.description) {
        sampleText = extractedData.description;
      }

      // If sampleText is still empty, fallback to metadata/title
      if (!sampleText.trim()) {
        sampleText = metadata.description || metadata.ogDescription || metadata.twitterDescription || document.title || '';
      }

      wordCount = countWords(sampleText);
    }

    return {
      url: location.href,
      host: location.hostname.replace(/^www\./, ''),
      title: (extractedData && extractedData.title) || metadata.ogTitle || metadata.twitterTitle || document.title || 'Web Page',
      pageType: classification.type,
      extractionMethod: finalMethod,
      wordCount,
      confidence: classification.confidence,
      metadata,
      text: sampleText,
      data: extractedData
    };
  };

  window.BriefExtractionEngine = BriefExtractionEngine;

})();
