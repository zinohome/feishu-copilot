export interface ParsedCommand {
  name: string;
  args: string[];
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const content = trimmed.slice(1).trim();
  if (content.length === 0) {
    return null;
  }

  const [name, ...args] = content.split(/\s+/);
  return { name, args };
}
