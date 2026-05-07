const assert = require('assert');

const { DeepSeekReviewService } = require('../../electron/main/deepseekReviewService');

async function run() {
  const localOpenAI = new DeepSeekReviewService({
    enabled: true,
    provider: 'openai_compatible',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'gemma4:e2b',
    apiKey: '',
  });
  assert.strictEqual(
    localOpenAI.isEnabled(),
    true,
    'openai-compatible local gateways should not require API key when model/baseURL are configured'
  );

  const googleWithoutKey = new DeepSeekReviewService({
    enabled: true,
    provider: 'google_ai',
    baseURL: 'https://generativelanguage.googleapis.com',
    model: 'gemma-4-test',
    apiKey: '',
  });
  assert.strictEqual(
    googleWithoutKey.isEnabled(),
    false,
    'google provider should still require API key'
  );

  const googleWithKey = new DeepSeekReviewService({
    enabled: true,
    provider: 'google_ai',
    baseURL: 'https://generativelanguage.googleapis.com',
    model: 'gemma-4-test',
    apiKey: 'dummy-key',
  });
  assert.strictEqual(
    googleWithKey.isEnabled(),
    true,
    'google provider should become enabled after key is configured'
  );

  const previousFetch = global.fetch;
  let capturedHeaders = null;
  global.fetch = async (_url, options = {}) => {
    capturedHeaders = options.headers || {};
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                keep_dimension_tags: ['人物'],
                confidence: 0.9,
              }),
            },
          },
        ],
      }),
    };
  };

  try {
    const review = await localOpenAI.reviewDimensions({
      filename: 'sample.jpg',
      folder: 'sample',
      peopleAnalysis: null,
      semanticTags: [],
      finalTags: [],
      riskFlags: [],
    });
    assert.deepStrictEqual(review?.keepDimensionTags, ['人物']);
    assert(
      !Object.prototype.hasOwnProperty.call(capturedHeaders || {}, 'Authorization'),
      'openai-compatible request should omit Authorization header when apiKey is empty'
    );
  } finally {
    global.fetch = previousFetch;
  }
}

module.exports = run;
