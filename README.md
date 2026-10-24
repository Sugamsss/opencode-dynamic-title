# OpenCode Dynamic Title Plugin

Dynamic title manager for [OpenCode](https://opencode.ai) that keeps chat titles honest as conversations evolve.

## The Problem

OpenCode names a session once, from the first message. A chat that starts with *"hey"* and becomes a payment system keeps the name it earned on turn one. Core only auto-titles the exact placeholder it creates (`New session - <timestamp>`), so nothing later revisits the name.

## How It Works

1. **One lean directive, every turn.** `ctx.session.hook("context")` appends a single line to the **end** of the system prompt, so a title change never invalidates the cached system parts before it:

   ```
   Session title: "Dynamic Title Plugin Check". Each turn, check it still describes what you are doing; if not — or if it is still a default or greeting placeholder — rename it with opencode.session_rename, 2-4 words. Never mention the title or the rename.
   ```

   41 words. The check is standing ("each turn, check it still describes what you are doing") rather than a transition trigger, because drift rarely arrives as a discrete switch. There is deliberately no "follow-ups keep the title" guard: measured across six sessions, the model renamed once and then treated every later turn as a follow-up, so the guard cancelled the check. "If it no longer describes the work" already covers staying put.

2. **A second reminder at the moment of action.** The system prompt is long and the line above loses attention part of the time. The same hook appends one sentence to the Code Mode `execute` tool description, which the model reads when it decides to act:

   ```
   If this session's title no longer describes the work, rename it with opencode.session_rename (2-4 words) before you finish.
   ```

   Tool descriptions are not rewritten by gateways the way system-prompt text is, so the path here stays correct on every route. The title value itself can only be read in the context hook, so it stays in the system prompt.

3. **No tool of its own.** Renaming uses OpenCode's built-in `session_rename`, reached as `tools.opencode.session_rename({ title })`. The path is written **without** a `tools.` prefix on purpose: models copy the string and re-wrap it, and `tools["tools.opencode.session_rename"]` is rejected with `Unknown tool 'tools.opencode.session_rename'. Did you mean tools.opencode.session_rename?`. The length is stated in prose ("2-4 words") instead of a `{ title: "<2-4 words>" }` snippet, because a literal template can be passed in verbatim as a title.

4. **No planner coupling.** The plugin says nothing about planning. The planner plugin injects its own ordering rule, and having both made the rename lose to it.

5. **Subagents are skipped.** Child sessions (`parentID`) keep the task title their parent gave them.

6. **`antigravity` namespace fix.** Some gateways rewrite "opencode" to "antigravity" in system prompts (9Router does this on its Antigravity `ag/` routes) and keep the original casing, so models call `tools.Antigravity.*`. A `ctx.tool.hook("execute.before")` maps `tools.antigravity.<name>(`, `tools["antigravity"]` and `namespace: "antigravity"` back to `opencode`, case-insensitively, and stands down if a real `antigravity` namespace is ever registered. Only a real call is rewritten, so the word is left alone inside a string or a comment. The same hook repairs two more shapes that both fail at runtime: a bare `session_rename(`, which throws "session_rename is not defined", and a doubled path such as `tools["tools.opencode.session_rename"]` or `tools.tools.opencode.session_rename`, which throws `Unknown tool 'tools.opencode.session_rename'`.

7. **Malformed history guard.** Before dispatch, a tool definition with a name outside `[a-zA-Z0-9_-]` is moved to a corrected key (core resolves tools by object identity, so the tool stays callable), and matching `tool-call` / `tool-result` parts are renamed on both sides so pairs stay intact. Stored history is never rewritten.

8. **Silent.** The model is told never to mention the title or the rename. Nothing leaks into the transcript. A reminder appended to tool output was measured to raise compliance sharply, but it renders inside the tool result, so it is not used.

## Requirements

OpenCode v2, tested on **2.1.4**. The plugin uses the internal plugin API (`setup(ctx)` with `ctx.session.hook` / `ctx.tool.hook`), which is what the rest of this machine's plugins use.

## Installation

1. Clone or copy this directory into your plugins folder:
   ```bash
   git clone https://github.com/Sugamsss/opencode-dynamic-title.git ~/.config/opencode/plugins/opencode-dynamic-title
   ```

2. Register it in `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugin": [
       "file:///Users/<your-user>/.config/opencode/plugins/opencode-dynamic-title"
     ]
   }
   ```

3. Restart or reload OpenCode. The service hot-reloads plugin files, but a TUI already running keeps the module it loaded — reopen it to be sure.

## Debugging

Set `DYNAMIC_TITLE_DEBUG=1` to print why an injection was skipped (session read failed, `event.system` not an array). Nothing is logged otherwise.

## Development

```bash
bun test          # 14 tests
bunx tsc --noEmit
```

## License

[MIT](LICENSE)
