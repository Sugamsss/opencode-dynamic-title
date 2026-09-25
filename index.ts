const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]+$/

const safeToolName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_")

// Providers reject tool names outside [a-zA-Z0-9_-]. Older sessions can hold calls such as
// "antigravity:session_rename". Fix the outgoing request only, and rename both the call and its
// result so every call/result pair stays intact. Stored history is not touched.
const sanitizeToolNames = (event: any) => {
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
const fixNamespace = (code: string) =>
  code.replace(/(tools\.|tools\[\s*["']|namespace\s*:\s*["'])antigravity\b/g, "$1opencode")

const instruction = (title: string) =>
  `Current chat title: "${title}"
Rename the session only when this title is generic (such as "New Chat" or "Untitled") or the main goal of the conversation has clearly changed. Do not rename for sub-tasks, follow-ups, or small shifts in focus. When a rename is needed, do it in this turn with a concise 2-4 word title that names the overall goal.
CRITICAL: Never mention the chat title or renaming in your response. Rename silently with OpenCode's built-in session_rename tool.`

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
      // Subagents keep their task title. On turn 1, let OpenCode's own title generator go first.
      if (session?.parentID || !session?.title) return

      // Last in the system prompt, so a title change does not invalidate the cached parts before it.
      if (Array.isArray(event.system)) event.system.push({ type: "text", text: instruction(session.title) })
    })
  },
}
