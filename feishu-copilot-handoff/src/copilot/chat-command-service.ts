export type ExecuteCommand = (command: string, ...args: unknown[]) => Thenable<unknown>;

export class ChatCommandService {
  constructor(private readonly executeCommand: ExecuteCommand) {}

  async submitToChat(text: string): Promise<void> {
    // Known Phase-1 limitation: `workbench.action.chat.open` submits to whichever Copilot Chat
    // panel is currently focused, which may differ from the mirrored session. A future phase
    // should resolve the correct panel before submission.
    await this.executeCommand('workbench.action.chat.open', { query: text });
  }
}
