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
          const contents = await fs.readdir(dirPath);
          return contents.length > 0 ? entry.name : null;
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
