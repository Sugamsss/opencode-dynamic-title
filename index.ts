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

const instruction = (title: string) =>
  `Current chat title: "${title}"
Based on the conversation and the direction we're heading in, check if the current title is outdated or generic. If not, don't change it. If outdated or if the conversation has evolved past the initial request, rename the session with a concise 2-4 word title.
CRITICAL: Never mention the chat title or renaming action in your conversational response to the user. Perform the renaming silently with OpenCode's built-in session_rename tool (in Code Mode, call \`tools.opencode.session_rename({ title })\` inside \`execute\`).`

export default {
  id: "opencode.dynamic-title",
  setup: async (ctx: any) => {
    await ctx.session.hook("context", async (event: any) => {
      try {
        sanitizeToolNames(event)
      } catch {
        // Never block the request over a best-effort cleanup.
      }

      let title = "New Chat"
      try {
        const session = await ctx.session.get({ sessionID: event.sessionID })
        if (session?.title) title = session.title
      } catch {
        // Fall back to the generic title.
      }

      if (Array.isArray(event.system)) event.system.unshift({ type: "text", text: instruction(title) })
    })
  },
}
