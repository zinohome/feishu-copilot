import { createHmac } from 'node:crypto';

export interface SignatureInput {
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
  encryptKey: string;
}

export function verifySignature(input: SignatureInput): boolean {
  const payload = `${input.timestamp}${input.nonce}${input.body}`;
  const digest = createHmac('sha256', input.encryptKey).update(payload).digest('base64');
  return digest === input.signature;
}
