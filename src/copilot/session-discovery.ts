import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export async function listChatSessionFiles(storagePath: string): Promise<string[]> {
  const chatSessionsDir = path.join(storagePath, 'chatSessions');
  const entries = await fs.readdir(chatSessionsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(chatSessionsDir, entry.name));
}
