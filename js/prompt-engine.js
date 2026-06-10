/**
 * Brief v5.0.1 — prompt-engine.js
 * Specialized prompt templates with anti-hallucination rules.
 */

import { ContextEngine } from './context-engine.js';

export class PromptEngine {
  
  // ── System Prompts ─────────────────────────────────────────────────────────
  static getSystemPrompt(pageType) {
    const baseSys = [
      'You are Brief, a concise browser reading assistant.',
      'Rules: plain text only. Do NOT use markdown headings (no #, ##, etc.) or raw HTML. Use only standard hyphens (-) or bullets (•) for lists.',
      'Be extremely direct, specific, and avoid filler phrases.',
      'Always refer to specific repository names, frameworks, technologies, versions, capabilities, or facts where present.',
      'Never use vague corporate buzzwords or filler phrases like "helps developers", "useful tool", "simple application", "improves workflow", or "powerful solution".',
      'Never hallucinate or invent facts, timelines, chapters, repository features, APIs, version numbers, or code behavior not explicitly in the provided context.',
      'If information is unavailable or not covered, state: "Information unavailable" or "Not covered in the context". Accuracy is more important than completeness.'
    ];

    switch (pageType) {
      case 'github':
        return [
          'You are a senior systems engineer explaining a code repository to another engineer.',
          'Your style is technical, precise, and objective. Assume the reader is already looking at the repository.',
          ...baseSys.slice(1)
        ].join(' ');

      case 'youtube':
        return [
          'You are a viewer summarizing a YouTube video you just watched.',
          'Format your summary to match the tone of someone explaining what happened in the video.',
          ...baseSys.slice(1)
        ].join(' ');

      case 'reddit':
        return [
          'You are a forum reader summarizing a Reddit discussion thread.',
          'Analyze comments, votes, consensus, and disagreements. Do not just summarize the post; focus heavily on user discussions.',
          ...baseSys.slice(1)
        ].join(' ');

      case 'docs':
        return [
          'You are a technical writer explaining developer documentation.',
          'Focus on API definitions, config structures, design concepts, and syntax examples.',
          ...baseSys.slice(1)
        ].join(' ');

      default:
        return baseSys.join(' ');
    }
  }

  // ── Prompt Dispatcher ──────────────────────────────────────────────────────
  static buildMessages(extraction, actionType, extra = '') {
    const pageType = extraction.pageType;
    const sysPrompt = PromptEngine.getSystemPrompt(pageType);
    const context = ContextEngine.buildContext(extraction);

    // Call specialized generators if available
    if (pageType === 'github' && actionType === 'explainRepo') {
      return [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: PromptEngine.githubExplainRepoPrompt(context) }
      ];
    }

    if (pageType === 'youtube' && actionType === 'timelineSummary') {
      return [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: PromptEngine.youtubeTimelinePrompt(context, extraction.data) }
      ];
    }

    if (pageType === 'reddit' && (actionType === 'summarizeDiscussion' || actionType === 'communityConsensus' || actionType === 'argumentsFor' || actionType === 'argumentsAgainst')) {
      return [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: PromptEngine.redditActionPrompt(context, actionType) }
      ];
    }

    // Default action prompt builders
    let userPrompt = '';
    switch (actionType) {
      case 'summarize':
        userPrompt = `${context}\n\nSummarize the page content above. Write exactly 4 bullet points. Start each bullet with a dash (-). One sentence per bullet. Focus strictly on concrete facts and key metrics.`;
        break;

      case 'keyPoints':
      case 'keyTakeaways':
        userPrompt = `${context}\n\nList 4 specific key takeaways or decisions from the content. Start each with a dash (-). Include specific names, numbers, or tech stack keywords. Avoid generic generalities.`;
        break;

      case 'explain':
        userPrompt = `${context}\n\nExplain this page in 2 clear sentences. Write for a developer audience but keep it simple, precise, and direct.`;
        break;

      case 'tldr':
        userPrompt = `${context}\n\nProvide a one-sentence TL;DR of the content. Start directly with the subject (no "This article..."). Maximum 25 words.`;
        break;

      case 'ask':
        userPrompt = `${context}\n\nQuestion: ${extra}\n\nAnswer the question using only the facts provided in the content above. If the answer cannot be found in the context, output exactly: "Not covered on this page." Do not write more than 3 sentences.`;
        break;

      case 'explainSelection':
        userPrompt = `Selected Text:\n"${extra}"\n\nExplain this selected phrase or concept in plain language. Under 3 sentences.`;
        break;

      case 'define':
        userPrompt = `Word/Phrase: "${extra}"\n\nProvide a clear one-sentence definition followed by one natural example sentence. Total of two sentences.`;
        break;

      case 'synonyms':
        userPrompt = `Word: "${extra}"\n\nProvide synonyms and antonyms in this exact format:\nSynonyms: word1, word2, word3, word4\nAntonyms: word1, word2\nNothing else.`;
        break;

      case 'explainCode':
      case 'whatDoesThisCodeDo':
        userPrompt = `Code Snippet:\n\`\`\`\n${extra || context}\n\`\`\`\n\nExplain the purpose, operations, inputs, and outputs of this code in 2-3 sentences. Identify the programming language.`;
        break;

      case 'findBug':
        userPrompt = `Code:\n\`\`\`\n${extra}\n\`\`\`\n\nAnalyze this code for bugs, race conditions, memory leaks, or logical errors. Be highly specific. If no issues are visible, state that no bugs were found. Under 4 sentences.`;
        break;

      case 'explainDocsConcepts':
        userPrompt = `${context}\n\nExtract and explain the 3 most important concepts described in this documentation. Format as exactly 3 bullet points starting with a dash (-). One sentence per concept.`;
        break;

      case 'beginnerExplanation':
        userPrompt = `${context}\n\nExplain the main topic or API described on this page as if to a beginner programmer. Avoid advanced jargon. Under 3 sentences.`;
        break;

      case 'productSummary':
        userPrompt = `${context}\n\nProvide a brief Product Summary, followed by a list of key specs, exactly 3 Pros, and exactly 3 Cons based on user features. Use bullet points starting with a dash (-).`;
        break;

      default:
        userPrompt = `${context}\n\nSummarize the page content above. Write exactly 4 bullet points starting with a dash (-).`;
        break;
    }

    return [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  // ── GitHub specialized prompts ─────────────────────────────────────────────
  static githubExplainRepoPrompt(context) {
    return [
      context,
      'Explain this GitHub repository by answering these points in a clean text block:',
      '1. What this project is and why it exists.',
      '2. Main capabilities and unique features.',
      '3. Architecture overview, directories structure, and notable implementation details.',
      '4. Intended users and current maturity level.',
      'Be highly technical and concrete. Use actual class names, directories, libraries, or files from the directory listing. Do not use generic filler words.'
    ].join('\n\n');
  }

  // ── YouTube specialized prompts ─────────────────────────────────────────────
  static youtubeTimelinePrompt(context, data) {
    if (!data.transcript && (!data.chapters || !data.chapters.length)) {
      return [
        context,
        'Provide a summary of this video based ONLY on the metadata. Note: Transcript unavailable. Summary based on metadata only.'
      ].join('\n\n');
    }

    return [
      context,
      'Create a timeline summary using only the provided transcript and/or chapters.',
      'Format each timeline item exactly as: "- [timestamp/section]: description"',
      'Provide up to 6 entries. Summarize the major sections of the video.',
      'CRITICAL: Never fabricate or guess timestamps. Never invent timeline sections. If you cannot find transcript times, state that the transcript is not loaded.'
    ].join('\n\n');
  }

  // ── Reddit specialized prompts ─────────────────────────────────────────────
  static redditActionPrompt(context, actionType) {
    let instruction = '';
    switch (actionType) {
      case 'communityConsensus':
        instruction = 'Identify the community consensus or majority opinion in the discussion. Do not just summarize the post body. Under 3 sentences.';
        break;
      case 'argumentsFor':
        instruction = 'Extract and list the 3 strongest arguments FOR the main stance discussed in the thread. Start each with a dash (-).';
        break;
      case 'argumentsAgainst':
        instruction = 'Extract and list the 3 strongest arguments AGAINST the main stance discussed in the thread. Start each with a dash (-).';
        break;
      default: // summarizeDiscussion
        instruction = [
          'Summarize the discussion thread. Write exactly 3 bullet points starting with a dash (-).',
          'Include:',
          '- Community consensus / main viewpoints.',
          '- Major arguments for/against.',
          '- Key insights or notable opinions from the comment scores.'
        ].join('\n');
        break;
    }

    return [
      context,
      instruction
    ].join('\n\n');
  }
}
