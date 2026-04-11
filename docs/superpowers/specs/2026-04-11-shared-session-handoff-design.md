# Shared Session Handoff Design

Date: 2026-04-11
Status: Drafted for review
Scope: Feishu <-> VS Code handoff continuity, snapshot-based native chat

## 1. Problem Statement

The current bridge does not reliably support handoff between mobile Feishu use and desktop Copilot use.

Observed failures:

- A message sent from Feishu may not appear when the user later continues from desktop unless they open the exact shared Feishu session path.
- A message sent from desktop may not enter the shared Feishu session at all if the user sends it from a general Copilot chat instead of a Feishu-bound session.
- Session state is stored in editor-local global storage, which risks splitting continuity across VS Code and Cursor.

The real requirement is not live refresh of an already opened native chat view. The real requirement is continuity:

- The user can continue from Feishu while away.
- The user can come back to desktop and continue from the same shared conversation.
- The model prompt on both sides is built from the same transcript source.

## 2. Goals And Non-Goals

### Goals

- Use one shared transcript source for Feishu and desktop handoff.
- Make desktop continuation explicit and deterministic instead of relying on ambiguous default Copilot routing.
- Preserve the existing native Feishu Sessions snapshot experience in Copilot.
- Keep current prompt assembly strategy, where both sides build context from stored mixed-source history.

### Non-Goals

- Real-time refresh of an already opened native Copilot chat session.
- Automatic interception of every arbitrary Copilot chat in the panel.
- Cross-device cloud sync beyond a user-configured shared store path or workspace-shared file.

## 3. Approaches Considered

### Approach A: Keep current local storage and try harder to auto-bind general Copilot chat

Pros:
- Minimal code movement.
- Preserves current UI assumptions.

Cons:
- Still relies on ambiguous participant routing in the general Copilot panel.
- Still risks split continuity across VS Code and Cursor.
- Hard to make behavior predictable for handoff.

### Approach B: Shared transcript store plus explicit desktop entry point

Pros:
- Directly fixes the two proven causes of split continuity: local-only storage and non-deterministic desktop routing.
- Keeps the existing Feishu Session concept.
- Aligns with snapshot semantics of native chat sessions.

Cons:
- Requires a small behavior change: the user must continue through a Feishu-bound session entry point, not any arbitrary Copilot conversation.

### Approach C: Replace native chat usage with a custom transcript UI

Pros:
- Maximum control over refresh and handoff UX.
- Removes dependency on chatSessions provider limitations.

Cons:
- Much larger change.
- Unnecessary for the current stated requirement, which accepts snapshot behavior.

### Recommendation

Choose Approach B.

It is the smallest change that matches the real requirement: reliable handoff continuity instead of real-time native chat refresh.

## 4. Design

### 4.1 Shared Store Location

Replace editor-local global storage as the primary session store location with a deterministic shared path.

Recommended priority:

1. If a workspace folder exists, store sessions in a workspace file under `.feishu-copilot/sessions.json`.
2. If no workspace folder exists, fall back to a user-configured absolute store path.
3. If neither is available, fall back to the current editor-local global storage and surface a warning that handoff continuity is limited.

Rationale:

- Workspace storage makes VS Code and Cursor read the same transcript when working in the same project.
- The fallback path preserves current behavior for edge cases.
- Warning on local fallback makes the limitation explicit instead of silent.

### 4.2 Desktop Continuation Entry Point

Desktop-to-shared-session continuation must become explicit.

Rules:

- The extension should provide a command to open the latest active shared Feishu session.
- The extension should provide a command to open a shared session by Feishu identity when available.
- General Copilot panel chats must not be treated as shared-session continuation unless they are already bound to a Feishu session resource.
- Unbound desktop requests should continue to show a clear message telling the user to open a Feishu Session item.

Rationale:

- This removes ambiguity from participant routing.
- It gives the user one stable handoff action when returning to desktop.

### 4.3 Transcript Semantics

The shared transcript remains the source of truth.

Rules:

- Feishu inbound messages append as `source: feishu`.
- Desktop requests append as `source: vscode` only when they originate from a Feishu-bound session.
- Prompt construction continues to include the mixed-source history window from the shared transcript.
- Mirroring from desktop back to Feishu remains best-effort display sync, not the source of truth.

### 4.4 Session Identity

Session identity stays anchored on the Feishu conversation key.

Rules:

- Feishu inbound resolves session by `chat_id` when available, else `open_id`.
- Desktop continuation reuses the existing shared session item instead of creating an unrelated local session.
- There must be at most one active non-archived shared session for a given Feishu key.

## 5. Error Handling

- If the shared store path cannot be created or written, the bridge should fail closed into explicit local-only mode and warn the user.
- If the user sends a desktop message from an unbound general Copilot chat, the extension should not silently create or guess a shared session.
- If no shared Feishu session exists yet, the desktop entry command should explain that the user must first start from Feishu or create a shared session explicitly.

## 6. Testing Strategy

1. Unit tests for shared store path resolution and fallback order.
2. Unit tests that VS Code and Cursor-compatible paths resolve to the same workspace store file.
3. Unit tests that unbound desktop requests do not append to shared transcripts.
4. Unit tests that the new "open latest shared session" command resolves the correct session.
5. Integration-style tests that a Feishu-originated transcript is later continued from desktop using the explicit shared entry point.

## 7. Implementation Outline

1. Refactor SessionStore to support a configurable storage path resolver.
2. Add shared-store path selection based on workspace or configured path.
3. Add desktop commands for opening the latest shared Feishu session.
4. Keep existing Feishu Session item behavior, but remove assumptions that general panel chat is shared.
5. Add tests for store path resolution and explicit continuation flow.

## 8. Open Decisions Resolved

- Native chat is treated as a snapshot view, not a live synchronized surface.
- General Copilot chat is not part of the shared-session contract.
- Shared continuity depends on deterministic store location plus explicit shared-session entry.
