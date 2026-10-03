const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]+$/

export const safeToolName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_")

// Providers reject tool names outside [a-zA-Z0-9_-]. Fix outgoing requests only.
export const sanitizeToolNames = (event: any) => {
  const tools = event.tools
  if (tools && typeof tools === "object") {
    for (const name of Object.keys(tools)) {
      if (!VALID_TOOL_NAME.test(name)) delete tools[name]
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
export const fixNamespace = (code: string) =>
  code.replace(/(tools\.|tools\[\s*["']|namespace\s*:\s*["'])antigravity\b/g, "$1opencode")

export const isGenericTitle = (title?: string): boolean => {
  if (!title) return true
  const lower = title.toLowerCase().trim()
  return (
    lower === "" ||
    lower === "untitled" ||
    lower.startsWith("new session") ||
    lower.startsWith("new chat") ||
    lower.startsWith("chat ") ||
    lower.startsWith("session ")
  )
}

export const buildTitleInstruction = (title: string): string => {
  const generic = isGenericTitle(title)
  return [
    `Current chat title: "${title}"`,
    generic
      ? `ACTION REQUIRED: This session currently has an unnamed/generic title. Rename it as your FIRST tool call before working on the task (concise 2-4 words naming the core goal) so the user's workspace updates immediately. Your SECOND tool call must be 'planner({ init: [...] })' to initialize the roadmap before touching code or running tools.`
      : `Rename the session only when the overarching goal has fundamentally changed or expanded beyond this title. Keep it stable during ordinary follow-ups. If a rename is needed, execute it as your FIRST tool call in this turn, followed immediately by 'planner({ init: [...] })'. If no rename is needed, 'planner' must be your FIRST tool call before touching code or running tools.`,
    `Call Code Mode: \`await tools.opencode.session_rename({ title: "Concise 2-4 Words" })\`.`,
    `CRITICAL: Never mention the chat title or renaming in your response. Perform the rename silently.`,
    `ORDER OF OPERATIONS: (1) session_rename (if generic/changed) -> (2) planner({ init: [...] }) -> (3) execute work. NEVER work first and retrospectively plan later.`,
  ].join("\n")
}

export default {
  id: "opencode.dynamic-title",
  setup: async (ctx: any) => {
    await ctx.tool.hook("execute.before", async (event: any) => {
      const code = event.input?.code
      if (event.tool !== "execute" || typeof code !== "string" || !code.includes("antigravity")) return
      // Leave the code alone if a real "antigravity" namespace is ever registered.
      const tools = await ctx.tool.list()
      if (tools.some((tool: any) => tool.options?.namespace === "antigravity")) return
      event.input = { ...event.input, code: fixNamespace(code) }
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
        return
      }

      // Subagent child sessions keep their task title from the parent
      if (session?.parentID) return

      const currentTitle = session?.title || "New session"

      // Injected at the very end of the system prompt so it is immediately visible to the model
      if (Array.isArray(event.system)) {
        event.system.push({ type: "text", text: buildTitleInstruction(currentTitle) })
      }
    })
  },
}
