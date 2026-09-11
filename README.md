# OpenCode Dynamic Title Plugin

Dynamic title manager for [OpenCode](https://opencode.ai) that silently updates chat session titles as conversations evolve.

## The Problem

In OpenCode (and similar AI harnesses), chat titles are typically generated once from the very first user message. If a conversation starts with a greeting like *"hey"*, or transitions from debugging a minor issue into designing an entire system architecture, the chat title remains stuck on the original turn forever.

## The Solution

This plugin brings the dynamic naming pattern to OpenCode:

1. **Top-Level Context Injection**: Before each model turn, `ctx.session.hook("context")` unshifts an instruction containing the session's live title.
2. **Silent Evaluation**: If the current title is generic or if the conversation has evolved past the initial request, the model calls the built-in `session_rename` tool with a concise 2–4 word title.
3. **Zero Text / Stream Pollution**: The agent executes the rename silently via OpenCode's session API. No bracketed tags, HTML comments, or acknowledgments leak into user chat messages.

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
