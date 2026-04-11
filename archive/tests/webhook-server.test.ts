import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../archive/src/commands/chat-commands';
import { createWebhookServer } from '../archive/src/http/webhook-server';

describe('parseCommand', () => {
  it("parses '/status' with empty args", () => {
    expect(parseCommand('/status')).toEqual({ name: 'status', args: [] });
  });
});

describe('createWebhookServer', () => {
  it('accepts POST, invokes onBody, and returns ok', async () => {
    let receivedBody = '';

    const server = createWebhookServer({
      onBody: (body) => {
        receivedBody = body;
      },
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to get server address');
    }

    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          method: 'POST',
          host: '127.0.0.1',
          port: address.port,
          path: '/',
          headers: {
            'content-type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, body });
          });
        },
      );

      req.on('error', reject);
      req.end('{"ping":true}');
    });

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    expect(receivedBody).toBe('{"ping":true}');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');
  });

  it('rejects non-POST with 405', async () => {
    const server = createWebhookServer({
      onBody: () => {
        throw new Error('onBody should not be called for non-POST');
      },
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to get server address');
    }

    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          method: 'GET',
          host: '127.0.0.1',
          port: address.port,
          path: '/',
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, body });
          });
        },
      );

      req.on('error', reject);
      req.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    expect(response.statusCode).toBe(405);
    expect(response.body).toBe('method not allowed');
  });
});
