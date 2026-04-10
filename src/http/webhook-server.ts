import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface WebhookServerOptions {
  onBody: (body: string, req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export function createWebhookServer(options: WebhookServerOptions): Server {
  return createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });

    req.on('end', async () => {
      await options.onBody(body, req, res);
      if (!res.writableEnded) {
        res.statusCode = 200;
        res.end('ok');
      }
    });
  });
}
