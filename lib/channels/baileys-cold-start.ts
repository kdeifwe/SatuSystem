import { promises as fs } from 'node:fs';
import path from 'node:path';

export type DisconnectReasonCode = 'generic' | 'replaced';

export function getReconnectDelayMs(attempt: number, reason: DisconnectReasonCode = 'generic', maxDelayMs = 300_000): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));

  if (reason === 'replaced') {
    const delays = [30_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000, 300_000];
    const delay = delays[Math.min(normalizedAttempt - 1, delays.length - 1)] ?? 300_000;
    return Math.min(delay, maxDelayMs);
  }

  const delays = [5_000, 10_000, 20_000, 40_000, 60_000, 120_000, 180_000, 300_000, 300_000, 300_000];
  const delay = delays[Math.min(normalizedAttempt - 1, delays.length - 1)] ?? 300_000;
  return Math.min(delay, maxDelayMs);
}

export function shouldClearAuthStateOnDisconnect(statusCode?: number): boolean {
  return statusCode === undefined || statusCode === 0 || statusCode === 1 ? true : statusCode !== 401 && statusCode !== 440;
}

async function readJsonIfPresent(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeCredsWithBackup(credsPath: string, contents: string): Promise<void> {
  const dir = path.dirname(credsPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${credsPath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${credsPath}.bak`;
  const backupTempPath = `${backupPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tempPath, contents, 'utf8');
  await fs.rm(credsPath, { force: true });
  await fs.rename(tempPath, credsPath);

  await fs.writeFile(backupTempPath, contents, 'utf8');
  await fs.rm(backupPath, { force: true });
  await fs.rename(backupTempPath, backupPath);
}

export async function restoreCredsFromBackupIfNeeded(dirPath: string): Promise<boolean> {
  const credsPath = path.join(dirPath, 'creds.json');
  const backupPath = `${credsPath}.bak`;

  const primary = await readJsonIfPresent(credsPath);
  if (primary && primary.registered === true) {
    return true;
  }

  const backup = await readJsonIfPresent(backupPath);
  if (backup && backup.registered === true) {
    await writeCredsWithBackup(credsPath, JSON.stringify(backup, null, 2));
    return true;
  }

  return false;
}

export async function discoverPersistedAuthAgentIds(authRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(authRoot, { withFileTypes: true });
    const agentIds = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const dirPath = path.join(authRoot, entry.name);
          const credsPath = path.join(dirPath, 'creds.json');

          try {
            const primary = await readJsonIfPresent(credsPath);
            if (primary && primary.registered === true) {
              return entry.name;
            }

            const backup = await readJsonIfPresent(`${credsPath}.bak`);
            if (backup && backup.registered === true) {
              await writeCredsWithBackup(credsPath, JSON.stringify(backup, null, 2));
              return entry.name;
            }
          } catch {
            // ignore missing/invalid creds; backup recovery is handled below
          }

          return null;
        })
    );

    return agentIds.filter((agentId): agentId is string => Boolean(agentId)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}
