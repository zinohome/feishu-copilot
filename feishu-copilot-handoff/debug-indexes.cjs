const fs = require('fs');
const content = fs.readFileSync('/Users/zhangjun/Library/Application Support/Code/User/workspaceStorage/dd6d6d7b05933408d1501cc196d16257/chatSessions/d6faa006-bfe0-4969-853e-b2ff2c6229a7.jsonl', 'utf8');
const lines = content.split('\n').filter(Boolean);

// Find the last 10 append events and their assigned indexes
let requestIndex = 0;
const appendMap = new Map(); // requestId -> {parserIndex, hasResponse}

for (const line of lines) {
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  
  if (entry.kind === 0 && entry.v && entry.v.requests) {
    requestIndex = entry.v.requests.length;
    for (const req of entry.v.requests) {
      if (req.requestId) {
        appendMap.set(req.requestId, { parserIndex: -1, hasResponse: !!(req.response && req.response.length) });
      }
    }
    continue;
  }
  
  if (entry.kind !== 2 || !Array.isArray(entry.k) || entry.k[0] !== 'requests') continue;
  
  // Append event
  if (entry.k.length === 1 && Array.isArray(entry.v)) {
    for (const req of entry.v) {
      if (req && req.requestId) {
        const idx = requestIndex;
        requestIndex++;
        appendMap.set(req.requestId, { parserIndex: idx, hasResponse: !!(req.response && req.response.length) });
      }
    }
    continue;
  }
  
  // Indexed patch - update requestIndex
  if (entry.k.length >= 2 && typeof entry.k[1] === 'number') {
    requestIndex = Math.max(requestIndex, entry.k[1] + 1);
  }
}

// Show the last 10 appended requests
const last10 = [...appendMap.entries()].slice(-10);
console.log('=== Last 10 appended requests ===');
for (const [reqId, info] of last10) {
  console.log(`  reqId=${reqId.slice(0, 30)} parserIndex=${info.parserIndex} hasResponseInAppend=${info.hasResponse}`);
}

// Now check: for the last few absolute indexes, are there response patches?
const responsePatches = new Map(); // idx -> count
for (const line of lines) {
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  if (entry.kind !== 2 || !Array.isArray(entry.k) || entry.k.length < 3) continue;
  if (entry.k[0] !== 'requests' || typeof entry.k[1] !== 'number') continue;
  if (entry.k[2] === 'response') {
    const idx = entry.k[1];
    responsePatches.set(idx, (responsePatches.get(idx) || 0) + 1);
  }
}

console.log('\n=== Response patches for indexes >= 275 ===');
for (const [idx, count] of [...responsePatches.entries()].filter(([idx]) => idx >= 275).sort((a, b) => a[0] - b[0])) {
  console.log(`  idx=${idx} responsePatchCount=${count}`);
}

// Check: what's the max absolute index in the file?
let maxIdx = 0;
for (const line of lines) {
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  if (entry.kind !== 2 || !Array.isArray(entry.k) || entry.k.length < 2) continue;
  if (typeof entry.k[1] === 'number') {
    maxIdx = Math.max(maxIdx, entry.k[1]);
  }
}
console.log('\nMax absolute index in file:', maxIdx);
console.log('Parser requestIndex after full parse:', requestIndex);

// Now check: for the 3 EMPTY assistant turns, what are their parser indexes?
const emptyReqIds = ['request_8bfbaf07', 'request_62f35545', 'request_42ccf5e3'];
for (const rid of emptyReqIds) {
  const info = appendMap.get(rid);
  if (info) {
    console.log(`\n=== ${rid} ===`);
    console.log(`  parserIndex=${info.parserIndex}`);
    console.log(`  hasResponseInAppend=${info.hasResponse}`);
    const patchCount = responsePatches.get(info.parserIndex) || 0;
    console.log(`  responsePatchCount at parserIndex=${info.parserIndex}: ${patchCount}`);
  } else {
    console.log(`\n=== ${rid} NOT FOUND in appendMap ===`);
  }
}