const { SessionMonitor } = require('./dist/copilot/session-monitor.js');
const monitor = new SessionMonitor(async (t, m) => { console.log('sendFeishuMessage', t); return 'id'; }, async (id, t, m) => { console.log('updateFeishuMessage', id, t); }, undefined, true);
monitor.processFile('f1', JSON.stringify({ kind: 2, k: ['requests'], v: [{ requestId: 'req-1', timestamp: Date.now(), message: { text: 'hello' } }] })).then(() => monitor.drainQueue());
