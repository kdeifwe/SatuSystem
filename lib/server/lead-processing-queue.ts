const leadProcessingQueues = new Map<string, Promise<unknown>>();

export async function withLeadProcessingLock<T>(leadKey: string, callback: () => Promise<T>): Promise<T> {
  const previous = leadProcessingQueues.get(leadKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => callback());

  const tail = next.catch(() => undefined);
  leadProcessingQueues.set(leadKey, tail);

  try {
    return await next;
  } finally {
    if (leadProcessingQueues.get(leadKey) === tail) {
      leadProcessingQueues.delete(leadKey);
    }
  }
}
