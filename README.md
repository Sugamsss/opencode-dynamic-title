# OpenCode Dynamic Title Plugin

Dynamic title manager for [OpenCode](https://opencode.ai) that silently updates chat session titles as conversations evolve.

## The Problem

In OpenCode (and similar AI harnesses), chat titles are typically generated once from the very first user message. If a conversation starts with a greeting like *"hey"*, or transitions from debugging a minor issue into designing an entire system architecture, the chat title remains stuck on the original turn forever.

## The Solution

This plugin brings the dynamic naming pattern to OpenCode:

1. **Context Injection**: Before each model turn, `ctx.session.hook("context")` appends an instruction with the session's live title to the end of the system prompt. At the end, a title change does not invalidate the cached system parts before it.
2. **Conservative Renames**: The model renames only when the title is generic (such as "New Chat") or the main goal has clearly changed, not for sub-tasks or follow-ups. It uses OpenCode's built-in `session_rename` tool (`tools.opencode.session_rename` in Code Mode) with a concise 2–4 word title. The plugin does not register its own rename tool.
3. **Skips**: No instruction is added to subagent sessions (they keep their task title), or before OpenCode has generated the session's first title.
4. **Zero Text / Stream Pollution**: The rename happens silently through OpenCode's session API. No bracketed tags, HTML comments, or acknowledgments leak into chat messages.
5. **`antigravity` Namespace Fix**: Some gateways rewrite "opencode" to "antigravity" in system prompts (9Router does this on its Antigravity `ag/` routes), so models read the Code Mode catalog as `tools.antigravity.*` and call tools that do not exist. A `tool.hook("execute.before")` maps `tools.antigravity.*`, `tools["antigravity"]` and `namespace: "antigravity"` back to `opencode` in Code Mode calls. It stands down if a real `antigravity` namespace is ever registered.
6. **Malformed History Guard**: Before dispatch, tool definitions with invalid names are dropped, and old tool calls with invalid names (such as `antigravity:session_rename`) are renamed to a valid form on both the call and its result, so pairs stay intact. This only changes the outgoing request; stored history is left untouched.

## Requirements

OpenCode v2 (tested on 2.0.16).

## Installation

1. Clone or copy this directory to your OpenCode plugins folder:
   ```bash
   git clone https://github.com/Sugamsss/opencode-dynamic-title.git ~/.config/opencode/plugins/opencode-dynamic-title
   ```

2. Register the plugin in `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugin": [
       "file:///Users/<your-user>/.config/opencode/plugins/opencode-dynamic-title"
     ]
   }
   ```

3. Restart or reload OpenCode. The plugin will be active across all sessions.

## License

[MIT](LICENSE)
