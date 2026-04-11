# Feishu Copilot Bridge Design (Phase 1)

Date: 2026-04-10  
Status: Approved for planning  
Scope: Private chat only, VS Code online, streaming card updates

## 1. Goal And Non-Goals

### Goals

- Let the user interact with GitHub Copilot Chat from Feishu private chat when away from keyboard.
- Keep behavior close to in-editor Copilot usage: workspace-aware responses, model/channel selection where available, and controlled execution flow.
- Provide incremental streaming replies through Feishu cards, including progress and final states.
- Enforce a strict permission gate for risky actions.

### Non-Goals (Phase 1)

- Group chat multi-user collaboration.
- Full parity with every VS Code Copilot Chat UI feature on day one.
- Replacing OpenClaw runtime internals.

## 2. Solution Choice

Use a hybrid of:

- A (primary): VS Code extension as runtime host for Copilot interaction and workspace integration.
- C (reference layer): Reuse OpenClaw-Lark protocol patterns (event dedup, queueing, card streaming, approval card flow), not OpenClaw runtime coupling.

Reasoning:

- A gives the most accurate workspace context and native editor-side capabilities.
- C provides proven Feishu communication and safety interaction patterns.
- Directly embedding OpenClaw runtime would add unnecessary dependency and maintenance overhead for this use case.

## 3. High-Level Architecture

Components in VS Code extension process:

1. Feishu Gateway
   - Handles webhook or websocket events.
   - Verifies signatures, deduplicates inbound events, and applies idempotency keys.

2. Session Router
   - Maintains one active queue per Feishu user (private chat mode).
   - Supports cancellation when a newer user message arrives.

3. Copilot Adapter
   - Converts Feishu requests into Copilot runtime calls.
   - Collects streamed chunks and tool/operation events.

4. Card Stream Renderer
   - Sends initial card (thinking state), incremental updates, and final card.
   - Applies update throttling to stay under Feishu rate limits.

5. Permission Gate
   - Pauses flow for risky actions and emits approval cards.
   - Resumes or denies based on button callback result.

6. State Store
   - Persists message mapping, request state, approval state, and replay-safe idempotency records.

## 4. Data Flow And Runtime Semantics

### Standard Request Flow

1. User sends Feishu private message.
2. Gateway verifies signature + dedup + idempotency.
3. Router enqueues by user id and starts request if idle.
4. Renderer sends initial streaming card.
5. Copilot Adapter calls Copilot with workspace context.
6. Stream chunks are buffered and patched to card incrementally.
7. Final state card is emitted with success or failure summary.

### Streaming Card Policy

- Patch cadence: 300-600ms throttling window.
- Immediate patch when semantic boundary appears (sentence end/tool status change).
- Final flush always emits a completion card.

### Cancellation Policy

- New user message cancels the current in-flight task for that user.
- Previous card is updated to interrupted state.
- New message is queued and processed next.

## 5. Permission And Safety Model

Permission classes:

1. read-only (auto-allow)
   - Read/search/explain operations only.

2. workspace-write (approval required)
   - Create/edit/delete files in workspace.

3. command-run (approval required)
   - Any shell command execution.
   - High-risk commands are hard-denied.

4. external-network (approval required)
   - Web fetch/install/dependency/network calls.

5. git-write (approval required)
   - Commit/push/branch-mutating operations.

6. session-control (auto-allow)
   - Stop/status/clear current session.

Security guardrails:

- Private-user allowlist (single owner open_id in phase 1).
- Workspace path allowlist (operations limited to configured roots).
- Command denylist (destructive patterns blocked by policy).
- Approval timeout (auto-deny after timeout, default 120s).
- Full audit logging for request, decision, and action outcome.

## 6. Error Handling And Recovery

1. Feishu API failures
   - Exponential backoff retries.
   - After max retries, degrade to minimal plain-text fallback and log.

2. Copilot runtime failures
   - Mark card as failed with retry action.
   - Support replay of last user message with same context policy.

3. Process restart
   - Persist pending state in State Store.
   - After restart, mark in-flight sessions as interrupted by restart.

4. Duplicate event delivery
   - message_id + event timestamp idempotency gate ensures at-most-once processing.

## 7. Feishu Command Surface (Phase 1)

- /status
- /stop
- /clear
- /model <name> (if model switching is available in adapter)
- /cwd <path> (allowlisted only)
- /approve <id>
- /deny <id>

## 8. Testing Strategy

1. Unit tests
   - Gateway signature verification and dedup logic.
   - Queue/cancel semantics per user session.
   - Permission classifier and denylist matching.
   - Card patch throttling and final flush.

2. Integration tests
   - End-to-end private chat flow: receive -> stream -> finalize.
   - Approval flow: pause -> approve/deny -> resume/abort.
   - Restart recovery: pending session state transition.

3. Manual validation
   - Real Feishu bot private chat with large replies.
   - Rate-limit resilience under rapid streaming updates.
   - Safe handling of destructive command attempts.

## 9. Milestones

1. M1: Feishu Gateway + Session Router + text-only fallback.
2. M2: Copilot Adapter streaming + card incremental updates.
3. M3: Permission Gate + approval card callbacks.
4. M4: Persistence, recovery, and hardening tests.

## 10. Open Decisions Frozen For Phase 1

- Private chat only.
- VS Code process must be online.
- Card streaming is default response mode.
- A+C hybrid boundary: runtime in VS Code, protocol patterns from OpenClaw-Lark.
