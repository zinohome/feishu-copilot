import { describe, expect, it, vi } from 'vitest';
import { ChatCommandService } from '../src/copilot/chat-command-service';

describe('ChatCommandService', () => {
  it('submits Feishu text into Copilot Chat', async () => {
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const service = new ChatCommandService(executeCommand);

    await service.submitToChat('帮我继续修这个 bug');

    expect(executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
      query: '帮我继续修这个 bug',
    });
  });
});
