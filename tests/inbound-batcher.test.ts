import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundBatcher } from '../lib/channels/inbound-batcher';
import { stripLeadingGreeting, hasAssistantReplied } from '../lib/ai/greeting-guard';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('batcher: несколько сообщений подряд дают ОДИН вызов', async () => {
  const flushed: string[][] = [];
  const b = createInboundBatcher<string>({ onFlush: async (_k, items) => { flushed.push(items); } });
  const timing = { debounceMs: 60, maxWaitMs: 1000 };

  b.add('c1', 'привет', timing);
  await sleep(20);
  b.add('c1', 'сколько стоит массаж', timing);
  await sleep(20);
  b.add('c1', 'и есть ли запись на завтра', timing);
  await sleep(150);

  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0], ['привет', 'сколько стоит массаж', 'и есть ли запись на завтра']);
});

test('batcher: maxWait не даёт ждать бесконечно', async () => {
  const flushed: string[][] = [];
  const b = createInboundBatcher<string>({ onFlush: async (_k, items) => { flushed.push(items); } });
  const timing = { debounceMs: 80, maxWaitMs: 120 };

  for (let i = 0; i < 6; i += 1) {
    b.add('c1', `m${i}`, timing);
    await sleep(40);
  }
  await sleep(150);
  assert.ok(flushed.length >= 2, 'пачка должна уйти по maxWait, не дожидаясь тишины');
});

test('batcher: пачки одного клиента обрабатываются строго по очереди', async () => {
  const log: string[] = [];
  const b = createInboundBatcher<string>({
    onFlush: async (_k, items) => {
      log.push(`start:${items.join(',')}`);
      await sleep(80);
      log.push(`end:${items.join(',')}`);
    },
  });
  const timing = { debounceMs: 10, maxWaitMs: 100 };

  b.add('c1', 'a', timing);
  await sleep(30); // первая пачка ушла и ещё обрабатывается
  b.add('c1', 'b', timing);
  await sleep(250);

  assert.deepEqual(log, ['start:a', 'end:a', 'start:b', 'end:b']);
});

test('batcher: разные клиенты не мешают друг другу', async () => {
  const flushed: Array<[string, string[]]> = [];
  const b = createInboundBatcher<string>({ onFlush: async (k, items) => { flushed.push([k, items]); } });
  const timing = { debounceMs: 30, maxWaitMs: 500 };
  b.add('c1', 'x', timing);
  b.add('c2', 'y', timing);
  await sleep(100);
  assert.equal(flushed.length, 2);
});

test('greeting guard: вырезает повторное приветствие', () => {
  assert.equal(
    stripLeadingGreeting('Здравствуйте! Рада вас приветствовать в bibi_massage. Подскажите, какой массаж вас интересует?'),
    'Подскажите, какой массаж вас интересует?'
  );
  assert.equal(stripLeadingGreeting('Добрый день, Айгерим! Чем помочь?'), 'Чем помочь?');
  assert.equal(stripLeadingGreeting('Привет! Лечебный массаж 15 000 тенге.'), 'Лечебный массаж 15 000 тенге.');
});

test('greeting guard: обычный ответ не трогает, одинокое приветствие не превращает в пустоту', () => {
  assert.equal(stripLeadingGreeting('Лечебный массаж стоит 15 000 тенге.'), 'Лечебный массаж стоит 15 000 тенге.');
  assert.equal(stripLeadingGreeting('Здравствуйте!'), 'Здравствуйте!');
});

test('hasAssistantReplied', () => {
  assert.equal(hasAssistantReplied([{ role: 'user' }]), false);
  assert.equal(hasAssistantReplied([{ role: 'user' }, { role: 'model' }]), true);
});
