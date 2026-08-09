import assert from 'node:assert';
import { test } from 'node:test';
import { tryBuildDeterministicFactAnswer } from '../lib/server/ai/deterministic-facts.ts';

test('uses Kazakh wording when the question is in Kazakh', () => {
  const chunks = [
    {
      content: 'Если ученик отучился 3 месяца и забросил курс, доступ останется только к материалам этих 3 месяцев.',
      similarity: 0.91,
    },
    {
      content: 'Для 11 класса срок обучения составляет 6 ай. Для 11 сынып оқудың ұзақтығы 6 ай. Это точный факт для 11 класса.',
      similarity: 0.87,
    },
  ];

  const answer = tryBuildDeterministicFactAnswer('Мен 11 сыныпта оқимын. Канша уакыт окимын?', chunks, 11);

  assert.equal(answer, 'Оқу ұзақтығы — 6 ай.');
});

test('uses Russian wording when the question is in Russian', () => {
  const chunks = [
    {
      content: 'Если ученик отучился 3 месяца и забросил курс, доступ останется только к материалам этих 3 месяцев.',
      similarity: 0.91,
    },
    {
      content: 'Для 11 класса срок обучения составляет 6 ай. Для 11 сынып оқудың ұзақтығы 6 ай. Это точный факт для 11 класса.',
      similarity: 0.87,
    },
  ];

  const answer = tryBuildDeterministicFactAnswer('Сколько времени длится курс для 11 класса?', chunks, 11);

  assert.equal(answer, 'Срок обучения — 6 ай.');
});
