/**
 * Brief v5.0.1 — quality-validation.js
 * Quality validation layer to inspect and rate extraction payloads.
 */

(function () {
  'use strict';

  const BriefQualityValidation = {};

  BriefQualityValidation.validate = (result) => {
    if (!result) {
      return {
        sourceType: 'unknown',
        extractionMethod: 'none',
        wordCount: 0,
        confidence: 0,
        extractionQuality: 'poor'
      };
    }

    const { pageType, extractionMethod, wordCount, confidence, data } = result;
    let quality = 'fair';

    if (!data) {
      quality = 'poor';
    } else {
      switch (pageType) {
        case 'github':
          if (data.readme && data.repository && data.techStack && data.stars !== '0') {
            quality = 'excellent';
          } else if (data.readme || data.currentCode) {
            quality = 'good';
          } else {
            quality = 'poor';
          }
          break;

        case 'youtube':
          if (data.title && data.channel && data.transcript && data.chapters) {
            quality = 'excellent';
          } else if (data.title && data.transcript) {
            quality = 'good';
          } else if (data.title && data.description) {
            quality = 'fair';
          } else {
            quality = 'poor';
          }
          break;

        case 'reddit':
          if (data.title && data.comments && data.comments.length >= 10) {
            quality = 'excellent';
          } else if (data.title && data.comments && data.comments.length > 0) {
            quality = 'good';
          } else {
            quality = 'poor';
          }
          break;

        case 'docs':
          if (data.title && data.elements && data.elements.length >= 15) {
            quality = 'excellent';
          } else if (data.title && data.elements && data.elements.length > 0) {
            quality = 'good';
          } else {
            quality = 'poor';
          }
          break;

        case 'article':
          if (data.title && data.textContent && data.textContent.length > 1500) {
            quality = 'excellent';
          } else if (data.title && data.textContent && data.textContent.length > 300) {
            quality = 'good';
          } else {
            quality = 'poor';
          }
          break;

        default: // generic
          if (wordCount > 500) {
            quality = 'good';
          } else if (wordCount > 100) {
            quality = 'fair';
          } else {
            quality = 'poor';
          }
          break;
      }
    }

    return {
      sourceType: pageType,
      extractionMethod,
      wordCount,
      confidence,
      extractionQuality: quality
    };
  };

  window.BriefQualityValidation = BriefQualityValidation;

})();
