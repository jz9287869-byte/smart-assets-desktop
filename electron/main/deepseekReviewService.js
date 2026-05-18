const fs = require('fs');
const path = require('path');
let sharp = null;
try {
  sharp = require('sharp');
} catch (_) {
  sharp = null;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_PROVIDER = 'openai_compatible';

const ALLOWED_STRUCTURED_CATEGORIES = new Set([
  'scene',
  'location',
  'animal',
  'people',
  'device',
  'event',
]);

function normalizeScore(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeStringArray(values = [], limit = 12) {
  const list = Array.isArray(values) ? values : [values];
  const normalized = [];
  const seen = new Set();
  for (const value of list) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function inferMimeTypeFromPath(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function normalizeBaseUrl(baseURL) {
  return String(baseURL || '').trim().replace(/\/+$/, '').toLowerCase();
}

class DeepSeekReviewService {
  constructor(options = {}) {
    this.updateConfig(options);
  }

  updateConfig(options = {}) {
    this.enabled = options.enabled !== false;
    this.provider = String(options.provider || DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
    this.apiKey = String(options.apiKey || '').trim();
    this.baseURL = String(options.baseURL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    this.model = String(options.model || DEFAULT_MODEL).trim();
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 15000;
  }

  isEnabled() {
    if (!this.enabled || !this.model || !this.baseURL) {
      return false;
    }
    if (this.provider === 'google_ai') {
      return Boolean(this.apiKey);
    }
    return true;
  }

  isLocalOllamaEndpoint() {
    const normalizedBaseURL = normalizeBaseUrl(this.baseURL);
    return (
      normalizedBaseURL === 'http://127.0.0.1:11434'
      || normalizedBaseURL === 'http://127.0.0.1:11434/v1'
      || normalizedBaseURL === 'http://localhost:11434'
      || normalizedBaseURL === 'http://localhost:11434/v1'
    );
  }

  resolveOllamaApiBase() {
    return String(this.baseURL || '').trim().replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
  }

  encodeImagePayload(imagePath, options = {}) {
    if (!imagePath || !fs.existsSync(imagePath)) {
      return null;
    }
    const preferCompact = options.preferCompact !== false;
    if (preferCompact && sharp) {
      try {
        const maxSide = Math.max(320, Number(options.maxSide) || 896);
        const quality = Math.max(55, Math.min(92, Number(options.quality) || 82));
        const compactBuffer = sharp(imagePath)
          .rotate()
          .resize(maxSide, maxSide, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        return compactBuffer.then((buffer) => {
          const base64Data = buffer.toString('base64');
          return {
            mimeType: 'image/jpeg',
            base64Data,
            dataUrl: `data:image/jpeg;base64,${base64Data}`,
          };
        });
      } catch (_) {
        // Fall back to the original file path when compact encoding is unavailable.
      }
    }

    const mimeType = inferMimeTypeFromPath(imagePath);
    const base64Data = fs.readFileSync(imagePath).toString('base64');
    return Promise.resolve({
      mimeType,
      base64Data,
      dataUrl: `data:${mimeType};base64,${base64Data}`,
    });
  }

  buildDimensionMessages(payload) {
    return [
      {
        role: 'system',
        content: [
          'You are a strict tag quality reviewer for travel photos.',
          'Review only these dimension tags: 人物, 单人, 多人, 纯风景.',
          'If people evidence is weak, noisy, or conflicting, remove people-related dimension tags.',
          'If architecture/landmark evidence is strong and face evidence is weak, prefer dropping 单人/多人.',
          'Return JSON only.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: {
            filename: payload.filename || '',
            folder: payload.folder || '',
          },
          people_analysis: payload.peopleAnalysis || null,
          semantic_tags: payload.semanticTags || [],
          final_tags: payload.finalTags || [],
          risk_flags: payload.riskFlags || [],
          output_schema: {
            keep_dimension_tags: ['人物', '单人', '多人', '纯风景'],
            confidence: 'number between 0 and 1',
            rationale: 'short reason',
          },
        }, null, 2),
      },
    ];
  }

  buildTagExtractionInstruction(payload) {
    const existingTags = normalizeStringArray(payload.existingTags || [], 24);
    const intentHints = normalizeStringArray(payload.intentHints || [], 16);
    return [
      'You are a multimodal travel-photo tagging assistant.',
      'Analyze the image and output strict JSON with concise, high-precision labels.',
      'All label name values must be Simplified Chinese. Do not output English label names.',
      'Do not output placeholder labels such as unknown, none, n/a, other, or misc.',
      'Required categories are: scene, location, animal, people, device, event.',
      'Each category should be an array of { name, confidence }.',
      'Keep labels sparse and precise. Prefer fewer high-quality tags.',
      'Also output ocr_keywords as short text snippets read from signs/posters/documents.',
      'Also output people_decision with fields: has_people(boolean), count(one of none/single/multi), confidence.',
      'Do not hallucinate OCR text.',
      'Return JSON only.',
      `Context filename: ${String(payload.filename || '')}`,
      `Context folder: ${String(payload.folder || '')}`,
      `Existing tags (reference only): ${existingTags.join(', ')}`,
      `Query/intent hints (optional): ${intentHints.join(', ')}`,
      'Output schema:',
      JSON.stringify({
        categories: {
          scene: [{ name: '雪山', confidence: 0.72 }],
          location: [{ name: '西湖', confidence: 0.81 }],
          animal: [{ name: '鹿', confidence: 0.64 }],
          people: [{ name: '人物', confidence: 0.75 }],
          device: [],
          event: [],
        },
        ocr_keywords: ['西湖景区', '雷峰塔'],
        people_decision: { has_people: true, count: 'single', confidence: 0.77 },
        confidence: 0.7,
      }, null, 2),
    ].join('\n');
  }

  buildQueryScoringInstruction(payload) {
    const query = String(payload.query || '').trim();
    const requiredTags = normalizeStringArray(payload.requiredTags || [], 16);
    const implicitTags = normalizeStringArray(payload.implicitTags || [], 16);
    const existingTags = normalizeStringArray(payload.existingTags || [], 24);
    return [
      'You are a visual search reranker for a photo library.',
      'Given the query intent and one candidate image, score relevance between 0 and 1.',
      'Favor exact semantic matches and penalize contradictions.',
      'Return JSON only.',
      `Query: ${query}`,
      `Required tags: ${requiredTags.join(', ')}`,
      `Implicit tags: ${implicitTags.join(', ')}`,
      `Candidate filename: ${String(payload.filename || '')}`,
      `Candidate folder: ${String(payload.folder || '')}`,
      `Candidate existing tags: ${existingTags.join(', ')}`,
      'Output schema:',
      JSON.stringify({
        relevance_score: 0.0,
        matched_tags: ['雪山', '鹿'],
        contradictions: ['多人'],
        rationale: 'short reason',
      }, null, 2),
    ].join('\n');
  }

  normalizeJsonText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      throw new Error('Cloud review returned empty content');
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
    if (fenced?.[1]) {
      return fenced[1].trim();
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return text.slice(objectStart, objectEnd + 1);
    }

    return text;
  }

  async requestOpenAICompatible({ messages, temperature = 0, maxTokens = 700, controller }) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Cloud review failed: ${response.status}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  async requestGoogleAI({ instruction, imagePayload = null, temperature = 0, controller }) {
    const endpoint = `${this.baseURL}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const parts = [{ text: instruction }];
    if (imagePayload?.base64Data && imagePayload?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: imagePayload.mimeType,
          data: imagePayload.base64Data,
        },
      });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        generationConfig: {
          temperature,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Google AI review failed: ${response.status}`);
    }

    const data = await response.json();
    const contentParts = data?.candidates?.[0]?.content?.parts || [];
    return contentParts
      .map((part) => part?.text || '')
      .join('\n')
      .trim();
  }

  async requestLocalOllamaChat({ instruction, imagePayload = null, temperature = 0, maxTokens = 700, controller }) {
    const apiBase = this.resolveOllamaApiBase();
    const message = {
      role: 'user',
      content: instruction,
    };

    if (imagePayload?.base64Data) {
      message.images = [imagePayload.base64Data];
    }

    const response = await fetch(`${apiBase}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [message],
        stream: false,
        format: 'json',
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Local Ollama chat failed: ${response.status}`);
    }

    const data = await response.json();
    return data?.message?.content || '';
  }

  buildOpenAIMessages(instruction, imagePayload = null) {
    if (!imagePayload?.dataUrl) {
      return [{ role: 'user', content: instruction }];
    }

    return [{
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: imagePayload.dataUrl } },
      ],
    }];
  }

  async requestJsonInstruction({ instruction, imagePath = null, temperature = 0, maxTokens = 700 }) {
    if (!this.isEnabled()) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const imagePayload = imagePath
        ? await this.encodeImagePayload(imagePath, {
          preferCompact: this.isLocalOllamaEndpoint(),
          maxSide: 896,
          quality: 80,
        })
        : null;
      let content = '';
      if (this.provider === 'google_ai') {
        content = await this.requestGoogleAI({
          instruction,
          imagePayload,
          temperature,
          controller,
        });
      } else if (imagePayload && this.isLocalOllamaEndpoint()) {
        content = await this.requestLocalOllamaChat({
          instruction,
          imagePayload,
          temperature,
          maxTokens,
          controller,
        });
      } else {
        content = await this.requestOpenAICompatible({
          messages: this.buildOpenAIMessages(instruction, imagePayload),
          temperature,
          maxTokens,
          controller,
        });
      }

      const parsed = JSON.parse(this.normalizeJsonText(content));
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  async reviewDimensions(payload) {
    if (!this.isEnabled()) {
      return null;
    }

    const messages = this.buildDimensionMessages(payload);
    const instruction = messages
      .map((item) => `${item.role.toUpperCase()}:\n${item.content}`)
      .join('\n\n');

    const parsed = await this.requestJsonInstruction({
      instruction,
      imagePath: payload.imagePath || null,
      temperature: 0,
      maxTokens: 450,
    });

    const keepDimensionTags = normalizeStringArray(
      parsed?.keep_dimension_tags || parsed?.keepDimensionTags || [],
      4
    );

    return {
      keepDimensionTags,
      confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : null,
      rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : '',
      source: 'deepseek_review',
    };
  }

  normalizeStructuredCategories(rawCategories = {}) {
    const output = {
      scene: [],
      location: [],
      animal: [],
      people: [],
      device: [],
      event: [],
    };

    for (const [key, value] of Object.entries(rawCategories || {})) {
      const normalizedCategory = String(key || '').trim().toLowerCase();
      if (!ALLOWED_STRUCTURED_CATEGORIES.has(normalizedCategory)) {
        continue;
      }
      const values = Array.isArray(value) ? value : [];
      output[normalizedCategory] = values
        .map((item) => {
          if (typeof item === 'string') {
            return {
              name: item.trim(),
              confidence: 0.55,
            };
          }
          return {
            name: String(item?.name || '').trim(),
            confidence: normalizeScore(item?.confidence, 0.55),
          };
        })
        .filter((item) => item.name)
        .slice(0, 8);
    }

    return output;
  }

  async extractImageStructuredTags(payload = {}) {
    if (!this.isEnabled()) {
      return null;
    }

    const parsed = await this.requestJsonInstruction({
      instruction: this.buildTagExtractionInstruction(payload),
      imagePath: payload.imagePath || null,
      temperature: 0.1,
      maxTokens: 900,
    });
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const categories = this.normalizeStructuredCategories(parsed.categories || {});
    const flattenedTags = [];
    for (const category of Object.keys(categories)) {
      for (const item of categories[category]) {
        flattenedTags.push({
          name: item.name,
          confidence: item.confidence,
          category,
          source: 'deepseek_review',
        });
      }
    }

    const peopleDecisionRaw = parsed.people_decision || parsed.peopleDecision || {};
    const peopleDecision = {
      hasPeople: Boolean(peopleDecisionRaw?.has_people ?? peopleDecisionRaw?.hasPeople),
      count: String(peopleDecisionRaw?.count || 'none').trim().toLowerCase(),
      confidence: normalizeScore(peopleDecisionRaw?.confidence, 0.5),
    };

    return {
      tags: flattenedTags,
      categories,
      ocrKeywords: normalizeStringArray(parsed.ocr_keywords || parsed.ocrKeywords || [], 10),
      peopleDecision,
      confidence: normalizeScore(parsed.confidence, 0.6),
      source: 'deepseek_review',
    };
  }

  async scoreImageRelevance(payload = {}) {
    if (!this.isEnabled()) {
      return null;
    }

    const parsed = await this.requestJsonInstruction({
      instruction: this.buildQueryScoringInstruction(payload),
      imagePath: payload.imagePath || null,
      temperature: 0,
      maxTokens: 350,
    });
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      relevanceScore: normalizeScore(parsed.relevance_score ?? parsed.relevanceScore, 0.5),
      matchedTags: normalizeStringArray(parsed.matched_tags || parsed.matchedTags || [], 12),
      contradictions: normalizeStringArray(parsed.contradictions || [], 10),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      source: 'deepseek_review',
    };
  }
}

module.exports = { DeepSeekReviewService };
