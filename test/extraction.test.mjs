/**
 * Brief v5.0.1 — extraction.test.mjs
 * Zero-dependency unit tests for Site Adapters, Extraction Engine,
 * Context Engine, Prompt Engine, and Quality Validation Layer.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Mock DOM Environment Setup ───────────────────────────────────────────────
global.window = global;
global.location = { href: '', hostname: '', pathname: '' };

// Minimal mock document
const mockElements = new Map();
global.document = {
  title: 'Default Page Title',
  querySelector(selector) {
    const parts = [];
    let current = '';
    let inBrackets = 0;
    let inQuotes = null;
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i];
      if (char === '"' || char === "'") {
        if (inQuotes === char) inQuotes = null;
        else if (!inQuotes) inQuotes = char;
      }
      if (!inQuotes) {
        if (char === '[') inBrackets++;
        else if (char === ']') inBrackets--;
      }
      if (char === ',' && inBrackets === 0 && !inQuotes) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current) parts.push(current.trim());

    for (const part of parts) {
      if (mockElements.has(part)) return mockElements.get(part);
    }
    if (mockElements.has(selector)) return mockElements.get(selector);
    return null;
  },
  querySelectorAll(selector) {
    const parts = [];
    let current = '';
    let inBrackets = 0;
    let inQuotes = null;
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i];
      if (char === '"' || char === "'") {
        if (inQuotes === char) inQuotes = null;
        else if (!inQuotes) inQuotes = char;
      }
      if (!inQuotes) {
        if (char === '[') inBrackets++;
        else if (char === ']') inBrackets--;
      }
      if (char === ',' && inBrackets === 0 && !inQuotes) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current) parts.push(current.trim());

    const list = [];
    for (const part of parts) {
      mockElements.forEach((val, key) => {
        if (key === part || key.includes(part) || part.includes(key)) {
          if (Array.isArray(val)) {
            list.push(...val);
          } else {
            if (!list.includes(val)) list.push(val);
          }
        }
      });
    }
    return list;
  },
  cloneNode() {
    return {
      querySelectorAll(selector) { return []; },
      firstElementChild: null,
      childNodes: []
    };
  }
};

// Mock Readability class
global.Readability = class MockReadability {
  constructor(doc) {}
  parse() {
    return {
      title: 'Mock Article Title',
      byline: 'Mock Author',
      siteName: 'Mock Site',
      content: '<div>Mock article content text here.</div>',
      textContent: 'Mock article content text here.',
      excerpt: 'Mock article excerpt.'
    };
  }
};

// Load Extension Scripts in global scope (matching tab context injection)
const adaptersCode = fs.readFileSync(path.join(__dirname, '../js/site-adapters.js'), 'utf8');
const engineCode = fs.readFileSync(path.join(__dirname, '../js/extraction-engine.js'), 'utf8');
const validationCode = fs.readFileSync(path.join(__dirname, '../js/quality-validation.js'), 'utf8');

eval(adaptersCode);
eval(engineCode);
eval(validationCode);

// Import Context & Prompt engines
import { ContextEngine } from '../js/context-engine.js';
import { PromptEngine } from '../js/prompt-engine.js';

// Helper to clear DOM mocks
function clearMocks() {
  mockElements.clear();
  global.document.title = 'Default Page Title';
  global.location.href = 'https://example.com';
  global.location.hostname = 'example.com';
  global.location.pathname = '/';
}

// ── Run Tests ────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('🚀 Starting Brief v5.0.1 Unit & Validation Tests...');

  // Test 1: GitHub Extractor & Classifier
  await (async () => {
    clearMocks();
    global.location.href = 'https://github.com/googlemind/brief';
    global.location.hostname = 'github.com';
    global.location.pathname = '/googlemind/brief';

    mockElements.set('[data-testid="repository-description"]', { textContent: 'Local AI browser companion.' });
    mockElements.set('li.d-inline-flex a[data-ga-click*="Repository, language"] span', { textContent: 'JavaScript' });
    mockElements.set('a[href$="/stargazers"] .Counter', { textContent: '120' });
    mockElements.set('#readme article.markdown-body', {
      cloneNode: () => ({
        querySelectorAll: () => [],
        innerText: 'Brief is a calm local AI companion for web pages.'
      })
    });
    
    // Directory files mock
    mockElements.set('.react-directory-filename-column a', [
      { textContent: 'package.json' },
      { textContent: 'README.md' }
    ]);

    const result = await window.BriefExtractionEngine.extract();
    assert.strictEqual(result.pageType, 'github');
    assert.strictEqual(result.extractionMethod, 'github');
    assert.strictEqual(result.data.repository, 'googlemind/brief');
    assert.strictEqual(result.data.techStack, 'JavaScript, Node.js/npm');
    assert.ok(result.data.readme.includes('calm local AI'));
    
    const validation = window.BriefQualityValidation.validate(result);
    assert.strictEqual(validation.sourceType, 'github');
    assert.strictEqual(validation.extractionQuality, 'excellent');
    console.log('✅ GitHub Extractor & Classifier passed!');
  })();

  // Test 2: YouTube Extractor & Fallbacks
  await (async () => {
    clearMocks();
    global.location.href = 'https://www.youtube.com/watch?v=123';
    global.location.hostname = 'youtube.com';
    global.location.pathname = '/watch';
    global.document.title = 'YouTube Video Title';

    // Mock segment renderers for transcripts
    mockElements.set('ytd-transcript-segment-renderer', [
      {
        querySelector: (sel) => {
          if (sel === '.segment-timestamp') return { textContent: '0:15' };
          if (sel === '.segment-text') return { textContent: 'Hello world transcript segment.' };
          return null;
        }
      }
    ]);

    mockElements.set('ytd-watch-metadata h1 yt-formatted-string', { textContent: 'Test Video Title' });
    mockElements.set('ytd-channel-name a', { textContent: 'Mind Channel' });
    mockElements.set('#description-inline-expander', { textContent: 'Video description is here.' });

    const result = await window.BriefExtractionEngine.extract();
    assert.strictEqual(result.pageType, 'youtube');
    assert.strictEqual(result.data.channel, 'Mind Channel');
    assert.strictEqual(result.data.transcript.length, 1);
    assert.strictEqual(result.data.transcript[0].text, 'Hello world transcript segment.');

    const validation = window.BriefQualityValidation.validate(result);
    assert.strictEqual(validation.extractionQuality, 'good'); // good since chapters are missing
    console.log('✅ YouTube Extractor & Transcript passed!');
  })();

  // Test 3: Reddit Discussion Extractor
  await (async () => {
    clearMocks();
    global.location.href = 'https://www.reddit.com/r/javascript/comments/abc/def';
    global.location.hostname = 'reddit.com';
    
    mockElements.set('shreddit-title', { getAttribute: () => 'Reddit Title' });
    mockElements.set('shreddit-comment', [
      {
        getAttribute: (attr) => {
          if (attr === 'author') return 'user_a';
          if (attr === 'score') return '42';
          return '';
        },
        querySelector: () => ({ textContent: 'I think ES modules are the future!' })
      }
    ]);

    const result = await window.BriefExtractionEngine.extract();
    assert.strictEqual(result.pageType, 'reddit');
    assert.strictEqual(result.data.title, 'Reddit Title');
    assert.strictEqual(result.data.comments.length, 1);
    assert.strictEqual(result.data.comments[0].author, 'user_a');
    assert.strictEqual(result.data.comments[0].score, 42);

    const validation = window.BriefQualityValidation.validate(result);
    assert.strictEqual(validation.extractionQuality, 'good');
    console.log('✅ Reddit Extractor passed!');
  })();

  // Test 4: Docs Extractor
  await (async () => {
    clearMocks();
    global.location.href = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch';
    global.location.hostname = 'developer.mozilla.org';
    global.location.pathname = '/en-US/docs/Web/API/Fetch';

    const childNodes = [
      { nodeType: 1, tagName: 'H1', textContent: 'Fetch API', childNodes: [] },
      { nodeType: 3, textContent: 'The Fetch API provides an interface for fetching resources.', childNodes: [] },
      { nodeType: 1, tagName: 'PRE', textContent: 'fetch("/api")', childNodes: [] }
    ];

    mockElements.set('article', {
      cloneNode: () => ({
        nodeType: 1,
        tagName: 'ARTICLE',
        querySelectorAll: () => [],
        childNodes
      })
    });

    const result = await window.BriefExtractionEngine.extract();
    assert.strictEqual(result.pageType, 'docs');
    assert.strictEqual(result.data.elements.length, 3);
    assert.strictEqual(result.data.elements[0].type, 'heading');
    assert.strictEqual(result.data.elements[2].type, 'code');
    console.log('✅ Docs Extractor passed!');
  })();

  // Test 5: Readability Article Extractor
  await (async () => {
    clearMocks();
    global.location.href = 'https://medium.com/engineering/our-new-architecture';
    global.location.hostname = 'medium.com';

    const result = await window.BriefExtractionEngine.extract();
    assert.strictEqual(result.pageType, 'article');
    assert.strictEqual(result.data.title, 'Mock Article Title');
    assert.strictEqual(result.data.byline, 'Mock Author');
    console.log('✅ Readability Extractor passed!');
  })();

  // Test 6: Context Engine formatting
  (() => {
    const mockExtraction = {
      pageType: 'github',
      url: 'https://github.com/mind/brief',
      wordCount: 400,
      data: {
        repository: 'mind/brief',
        owner: 'mind',
        description: 'Local AI browser engine.',
        language: 'JavaScript',
        techStack: 'JavaScript, npm',
        readme: 'Markdown readme content.'
      }
    };

    const context = ContextEngine.buildContext(mockExtraction);
    assert.ok(context.includes('Repository: mind/brief'));
    assert.ok(context.includes('Tech Stack: JavaScript, npm'));
    assert.ok(context.includes('README Content:\nMarkdown readme content.'));

    const intel = ContextEngine.computeReadingIntel(mockExtraction);
    assert.strictEqual(intel.readTimeStr, '1 min'); // readme wordcount 3 / 200 => capped at min 1 min.

    console.log('✅ Context Engine passed!');
  })();

  // Test 7: Prompt Engine construction
  (() => {
    const mockExtraction = {
      pageType: 'github',
      url: 'https://github.com/mind/brief',
      data: {
        repository: 'mind/brief',
        owner: 'mind',
        description: 'Local AI browser engine.',
        language: 'JavaScript',
        techStack: 'JavaScript, npm',
        readme: 'Markdown readme content.'
      }
    };

    const messages = PromptEngine.buildMessages(mockExtraction, 'explainRepo');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
    assert.ok(messages[0].content.includes('senior systems engineer'));
    assert.ok(messages[1].content.includes('Explain this GitHub repository'));
    console.log('✅ Prompt Engine passed!');
  })();

  console.log('\n🎉 All Brief v5.0.1 tests completed successfully!');
}

runTests();
