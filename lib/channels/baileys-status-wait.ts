export async function waitForBaileysStatus(
  getStatus: () => string | undefined,
  targetStatuses: readonly string[],
  timeoutMs = 15000,
  pollIntervalMs = 250
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let status = getStatus();

  if (status && targetStatuses.includes(status)) {
    return status;
  }

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    status = getStatus();

    if (status && targetStatuses.includes(status)) {
      return status;
    }
  }

  return getStatus();
}
