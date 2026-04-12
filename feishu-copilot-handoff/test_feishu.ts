import { sendFeishuMirrorMessage, getTenantAccessToken } from './src/feishu/client.ts';
import fs from 'fs';

async function test() {
  const config = JSON.parse(fs.readFileSync('/Users/zhangjun/.gemini/antigravity/brain/e43a86c3-fa4d-49a7-9c66-303eb06d194a/scratch/config.json', 'utf-8'));
  // I don't have the config file, wait. I can't test because I don't have the App ID and Secret!
}
