# Feishu Copilot Bridge

## Prerequisites

- Node.js 22+
- npm 10+

## Install

```bash
npm install
```

## Test

```bash
npm run typecheck
npm run test
```

## Run (Extension Host)

1. Open this repository in VS Code.
2. Press F5 to launch an Extension Development Host.
3. In the new host window, activate the extension to run the bridge runtime.

## Runtime Mode

- Current mode: Feishu SDK WebSocket long connection.
- No webhook endpoint and no public callback URL are required.
- No local port exposure is required.
