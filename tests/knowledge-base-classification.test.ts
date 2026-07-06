import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChunkPriority, buildManualChunkMetadata } from '../lib/knowledge-base/classification';

test('QA chunks are tagged as qa for short question-answer text', () => {
  assert.equal(classifyChunkPriority('Вопрос: Какой у вас тариф?\nОтвет: Базовый пакет стоит 5000 тенге.'), 'qa');
});

test('Structured chunks are tagged as structured when they contain price or contact fields', () => {
  assert.equal(classifyChunkPriority('Цена: 15000 тенге\nСрок: 3 дня\nКонтакты: +7 700 000 00 00'), 'structured');
});

test('Generic text falls back to chunk', () => {
  assert.equal(classifyChunkPriority('Мы предоставляем поддержку клиентам круглосуточно и помогаем с настройкой сервиса.'), 'chunk');
});

test('Manual chunk metadata uses structured priority and chunk index 0 for tariff content', () => {
  const metadata = buildManualChunkMetadata({
    content: 'Тарифы и условия оплаты: базовый пакет 5000 тенге, доставка 1000 тенге',
    title: 'Тарифы',
    type: 'product',
  });

  assert.equal(metadata.priority, 'structured');
  assert.equal(metadata.chunk_index, 0);
  assert.equal(metadata.category, 'product');
});
