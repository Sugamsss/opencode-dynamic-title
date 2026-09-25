const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const removeInvalidTools = (event: any) => {
  const tools = event?.tools
  if (!tools || typeof tools !== "object") return

  if (Array.isArray(tools)) {
    event.tools = tools.filter((tool: any) => {
      return typeof tool?.name !== "string" || TOOL_NAME_PATTERN.test(tool.name)
    })
    return
  }

  for (const name of Object.keys(tools)) {
    if (!TOOL_NAME_PATTERN.test(name)) delete tools[name]
  }
}

const removeInvalidToolHistory = (event: any) => {
  if (!Array.isArray(event?.messages)) return

  for (const message of event.messages) {
    if (!Array.isArray(message?.content)) continue

    message.content = message.content.filter((part: any) => {
      if (part?.type !== "tool" || typeof part.name !== "string") return true
      return TOOL_NAME_PATTERN.test(part.name)
    })
  }
}

const sanitizeToolNames = (event: any) => {
  removeInvalidTools(event)
  removeInvalidToolHistory(event)
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
