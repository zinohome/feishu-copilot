const fs = require('fs');
const path = require('path');
const { parseChatSessionJsonl, parseChatSessionJson } = require('./dist/src/copilot/session-parser.js');

const storagePath = '/Users/zhangjun/Library/Application Support/Code/User/workspaceStorage/dd6d6d7b05933408d1501cc196d16257';
const chatDir = path.join(storagePath, 'chatSessions');
const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));

for (const file of files) {
  const filePath = path.join(chatDir, file);
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const summary = file.endsWith('.json') 
    ? parseChatSessionJson(file, content, stat.mtimeMs)
    : parseChatSessionJsonl(file, content, stat.mtimeMs);
  
  console.log('=== File:', file, '===');
  console.log('Total turns:', summary.turns.length);
  console.log('lastUserMessageAt:', summary.lastUserMessageAt);
  console.log('lastAssistantMessageAt:', summary.lastAssistantMessageAt);
  
  const emptyAsst = summary.turns.filter(t => !t.assistantText).length;
  const withAsst = summary.turns.filter(t => t.assistantText).length;
  console.log('Turns WITH assistant text:', withAsst);
  console.log('Turns WITHOUT assistant text:', emptyAsst);
  
  console.log('\n--- Last 8 turns ---');
  for (const turn of summary.turns.slice(-8)) {
    const u = (turn.userText || '').slice(0, 40).replace(/\n/g, ' ');
    const a = (turn.assistantText || '<EMPTY>').slice(0, 80).replace(/\n/g, ' ');
    console.log('  req=' + turn.requestId.slice(0, 24) + ' user=' + u + '... asst=' + a + '...');
  }
}