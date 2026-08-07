const leadProcessingQueues = new Map<string, Promise<unknown>>();

export async function withLeadProcessingLock<T>(leadKey: string, callback: () => Promise<T>): Promise<T> {
  const previous = leadProcessingQueues.get(leadKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => callback());

  leadProcessingQueues.set(leadKey, next.catch(() => undefined));

  try {
    return await next;
  } finally {
    if (leadProcessingQueues.get(leadKey) === next) {
      leadProcessingQueues.delete(leadKey);
    }
  }
}
