import * as vscode from 'vscode';
import type { CopilotAdapter } from './copilot-adapter';
import type { InboundChatMessage } from '../domain/message-types';

export class VscodeLmAdapter implements CopilotAdapter {
  private readonly modelFamily: string;

  constructor(modelFamily = 'gpt-4o') {
    this.modelFamily = modelFamily;
  }

  async *generate(message: InboundChatMessage, signal?: AbortSignal): AsyncIterable<string> {
    const models = await vscode.lm.selectChatModels({ family: this.modelFamily });
    if (models.length === 0) {
      throw new Error('No Copilot model available');
    }

    const model = models[0];
    const cts = new vscode.CancellationTokenSource();
    signal?.addEventListener('abort', () => cts.cancel());

    try {
      const request = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(message.text)],
        {},
        cts.token,
      );

      for await (const chunk of request.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          yield chunk.value;
        }
      }
    } finally {
      cts.dispose();
    }
  }
}
