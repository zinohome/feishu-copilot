export type ExecuteCommand = (command: string, ...args: unknown[]) => Thenable<unknown>;

export class ChatCommandService {
  constructor(private readonly executeCommand: ExecuteCommand) {}

  async submitToChat(text: string): Promise<void> {
    await this.executeCommand('workbench.action.chat.open', { query: text });
  }
}
