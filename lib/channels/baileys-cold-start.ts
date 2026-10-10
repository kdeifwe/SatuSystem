import { promises as fs } from 'node:fs';
import path from 'node:path';

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
            const raw = await fs.readFile(credsPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.registered === true) return entry.name;
          } catch (err) {
            // ignore missing/invalid creds
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
