const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]+$/

export const safeToolName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_")

// Providers reject tool names outside [a-zA-Z0-9_-]. Fix outgoing requests only.
export const sanitizeToolNames = (event: any) => {
  const tools = event.tools
  if (tools && typeof tools === "object") {
    for (const name of Object.keys(tools)) {
      if (VALID_TOOL_NAME.test(name)) continue
      const fixed = safeToolName(name)
      if (!(fixed in tools)) tools[fixed] = tools[name]
      delete tools[name]
    }
  }

  if (!Array.isArray(event.messages)) return
  for (const message of event.messages) {
    if (!Array.isArray(message?.content)) continue
    message.content = message.content.map((part: any) => {
      if (part?.type !== "tool-call" && part?.type !== "tool-result") return part
      if (typeof part.name !== "string" || VALID_TOOL_NAME.test(part.name)) return part
      return { ...part, name: safeToolName(part.name) }
    })
  }
}

// 9Router rewrites "opencode" to "antigravity" in system prompts on ag/ routes, so those models
// read the Code Mode catalog as tools.antigravity.*. Map those calls back to the real namespace.
// Case matters: the rewrite keeps the original casing, so `OpenCode` arrives as `Antigravity`.
export const fixNamespace = (code: string) =>
  code.replace(/(tools\.|tools\[\s*["']|namespace\s*:\s*["'])antigravity\b/gi, "$1opencode")

// Code Mode needs the full path; a bare call throws "session_rename is not defined".
const BARE_RENAME = /(?<![\w.$"'])session_rename\s*\(/g
export const fixRenameCall = (code: string) =>
  code.includes("session_rename") ? code.replace(BARE_RENAME, "tools.opencode.session_rename(") : code

// The path is written without a "tools." prefix on purpose: models copy the string and re-wrap it,
// producing tools["tools.opencode.session_rename"] / tools.tools.opencode.*, which the runtime
// rejects with "Unknown tool 'tools.opencode.session_rename'. Did you mean tools.opencode.session_rename?"
//
// There is deliberately no "follow-ups keep the title" guard. It was measured doing the opposite of
// its job: the model renamed on turn one, then treated every later turn as a follow-up and skipped
// the check (4 of 6 drift sessions). "If it no longer describes the work" already covers staying put.
export const buildTitleInstruction = (title: string): string =>
  `Session title: "${title}". Each turn, check it still describes what you are doing; if not — or if it is still a default or greeting placeholder — rename it with opencode.session_rename, 2-4 words. Never mention the title or the rename.`

// The system prompt is long, and a reminder at its end loses attention (2 of 6 drift sessions).
// The Code Mode `execute` tool description is the second placement: read at the moment the model
// decides to act, and tool descriptions are never rewritten by a gateway the way system-prompt text
// is (see fixNamespace). The title value itself can only be read in the context hook, so it stays in
// the system prompt. A trailing `system` message was tried and rejected: it reaches the model, but
// the TUI renders it as a visible <system-update> block on every step.
export const EXECUTE_REMINDER = `If this session's title no longer describes the work, rename it with opencode.session_rename (2-4 words) before you finish.`

export const remindAtActTime = (event: any) => {
  const execute = event?.tools?.execute
  if (!execute || typeof execute.description !== "string") return
  if (execute.description.includes("session_rename")) return
  execute.description = `${execute.description}\n\n${EXECUTE_REMINDER}`
}

const debug = (message: string) => {
  if (process.env.DYNAMIC_TITLE_DEBUG) console.error(`[dynamic-title] ${message}`)
}

export default {
  id: "opencode.dynamic-title",
  setup: async (ctx: any) => {
    await ctx.tool.hook("execute.before", async (event: any) => {
      const code = event.input?.code
      if (event.tool !== "execute" || typeof code !== "string") return
      if (!code.includes("antigravity") && !code.includes("session_rename")) return
      let next = code
      if (code.includes("antigravity")) {
        // Leave the code alone if a real "antigravity" namespace is ever registered.
        const tools = await ctx.tool.list()
        if (!tools.some((tool: any) => tool.options?.namespace === "antigravity")) next = fixNamespace(next)
      }
      next = fixRenameCall(next)
      if (next === code) return
      debug("repaired a Code Mode call")
      event.input = { ...event.input, code: next }
    })

    await ctx.session.hook("context", async (event: any) => {
      try {
        sanitizeToolNames(event)
      } catch {
        // Never block the request over a best-effort cleanup.
      }

      let session: any
      try {
        session = await ctx.session.get({ sessionID: event.sessionID })
      } catch {
        debug("could not read session; skipping title instruction")
        return
      }

      debug(`tools: ${Object.keys(event.tools ?? {}).join(",")}`)

      // Subagent child sessions keep their task title from the parent
      if (session?.parentID) return

      const currentTitle = session?.title || "New session"

      try {
        remindAtActTime(event)
      } catch {
        // A frozen tool definition must not break the request.
      }

      // Injected at the very end of the system prompt so it is immediately visible to the model
      if (Array.isArray(event.system)) {
        event.system.push({ type: "text", text: buildTitleInstruction(currentTitle) })
      } else debug("event.system is not an array; skipping title instruction")
    })
  },
}
