import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';
import { formatChunksForPrompt, generateBilingualSearchQueries, rankKnowledgeBaseChunks } from '../lib/knowledge-base/search.ts';

test('rankKnowledgeBaseChunks promotes structured factual chunks over instagram promo content', () => {
  const ranked = rankKnowledgeBaseChunks([
    {
      chunk_id: 'instagram-1',
      source_id: 'src-1',
      content: 'Скидка 20% на курс сегодня!',
      similarity: 0.84,
      priority: 'chunk',
      metadata: { source_type: 'instagram', type: 'other' },
    },
    {
      chunk_id: 'faq-1',
      source_id: 'src-2',
      content: 'Для комбинации Қазақстан тарихы + Мат. сауаттылық длительность курса 6 месяцев.',
      similarity: 0.63,
      priority: 'structured',
      metadata: { source_type: 'faq', type: 'faq' },
    },
  ]);

  assert.equal(ranked[0].chunk_id, 'faq-1');
  assert.equal(ranked[1].chunk_id, 'instagram-1');
});

test('formatChunksForPrompt preserves ranking and metadata for factual chunks', () => {
  const prompt = formatChunksForPrompt([
    {
      chunk_id: 'instagram-1',
      source_id: 'src-1',
      content: 'Скидка 20% на курс сегодня!',
      similarity: 0.84,
      priority: 'chunk',
      metadata: { source_type: 'instagram', type: 'other' },
    },
    {
      chunk_id: 'faq-1',
      source_id: 'src-2',
      content: 'Для комбинации Қазақстан тарихы + Мат. сауаттылық длительность курса 6 месяцев.',
      similarity: 0.63,
      priority: 'structured',
      metadata: { source_type: 'faq', type: 'faq' },
    },
  ]);

  assert.match(prompt, /priority: structured/i);
  assert.match(prompt, /source: faq/i);
  assert.match(prompt, /type: faq/i);
  assert.ok(prompt.indexOf('6 месяцев') < prompt.indexOf('Скидка 20%'));
});

test('generateBilingualSearchQueries uses deterministic mappings without Gemini', async () => {
  assert.deepEqual(await generateBilingualSearchQueries('сколько стоит обучение'), {
    query_ru: 'стоимость обучения',
    query_kk: 'оқу құны',
  });

  assert.deepEqual(await generateBilingualSearchQueries('срок обучения'), {
    query_ru: 'срок обучения',
    query_kk: 'оқу ұзақтығы',
  });

  assert.deepEqual(await generateBilingualSearchQueries('как записаться'), {
    query_ru: 'регистрация на курс',
    query_kk: 'курсқа тіркелу',
  });

  assert.deepEqual(await generateBilingualSearchQueries('погода'), {
    query_ru: 'погода',
    query_kk: 'погода',
  });
});

test('buildSystemPrompt includes uncertainty handling that preserves partial facts', () => {
  const prompt = buildSystemPrompt(
    {
      id: 'agent-1',
      name: 'Алиса',
      role: 'менеджер по продажам',
      goal: 'Помогать клиентам',
      tone_of_voice: 'дружелюбный',
      human_communication_style: 'живой стиль',
      communication_rules: '1. Быть вежливым',
      knowledge_base_principles: 'Используй базу знаний',
      dialogue_flow: { steps: ['Приветствие'] },
      general_capabilities: { can_send_files: true },
    },
    { name: 'ТехноПлюс', timezone: 'Asia/Almaty', currency: 'KZT' },
    []
  );

  assert.match(prompt, /Если данных нет вообще/i);
  assert.match(prompt, /для комбинации/i);
});
