/**
 * Копит входящие сообщения по ключу (например, agentId + jid клиента)
 * и вызывает onFlush ОДИН раз после паузы debounceMs без новых сообщений.
 *
 * - Каждое новое сообщение сбрасывает таймер (клиент ещё печатает).
 * - maxWaitMs — потолок ожидания, чтобы бот не молчал вечно, если клиент пишет без остановки.
 * - Обработка пачек одного ключа строго последовательная: следующая пачка
 *   ждёт, пока закончится предыдущая, и видит её ответ в истории.
 */
export interface InboundBatcherOptions<T> {
  onFlush: (key: string, items: T[]) => Promise<void>;
  onError?: (key: string, error: unknown) => void;
}

interface Bucket<T> {
  items: T[];
  timer: ReturnType<typeof setTimeout> | null;
  firstAt: number;
}

export function createInboundBatcher<T>(options: InboundBatcherOptions<T>) {
  const buckets = new Map<string, Bucket<T>>();
  const chains = new Map<string, Promise<void>>();

  function flush(key: string) {
    const bucket = buckets.get(key);
    if (!bucket) return;
    buckets.delete(key);
    if (bucket.timer) clearTimeout(bucket.timer);
    if (bucket.items.length === 0) return;

    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => options.onFlush(key, bucket.items))
      .catch((error) => options.onError?.(key, error));

    chains.set(key, next);
    void next.finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  }

  function add(key: string, item: T, timing: { debounceMs: number; maxWaitMs: number }) {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { items: [], timer: null, firstAt: Date.now() };
      buckets.set(key, bucket);
    }

    bucket.items.push(item);
    if (bucket.timer) clearTimeout(bucket.timer);

    const elapsed = Date.now() - bucket.firstAt;
    const wait = Math.max(0, Math.min(timing.debounceMs, timing.maxWaitMs - elapsed));
    bucket.timer = setTimeout(() => flush(key), wait);
  }

  return { add, flush };
}
