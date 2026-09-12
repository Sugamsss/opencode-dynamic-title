let pluginContext: any = null

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

export default {
  id: "opencode.dynamic-title",
  setup: async (ctx: any) => {
    pluginContext = ctx

    if (ctx.tool?.transform && ctx.session?.rename) {
      await ctx.tool.transform((editor: any) => {
        if (editor.get?.("session_rename")) return

        editor.add({
          name: "session_rename",
          description: "Silently rename the current session.",
          input: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1 },
            },
            required: ["title"],
            additionalProperties: false,
          },
          execute: async (input: any, tool: any) => {
            await ctx.session.rename({ sessionID: tool.sessionID, title: input.title })
            return { content: "Session title updated." }
          },
        })
      })
    }

    if (ctx.session?.hook) {
      await ctx.session.hook("context", async (event: any) => {
        try {
          // Check current title
          let currentTitle = "New Chat"
          if (ctx.session?.get) {
            const session = await ctx.session.get({ sessionID: event.sessionID })
            if (session?.title) {
              currentTitle = session.title
            }
          }

          const instruction = 
`Current chat title: "${currentTitle}"
Based on the conversation and the direction we're heading in, check if the current title is outdated or generic. If not, don't change it. If outdated or if the conversation has evolved past the initial request, rename the session with a concise 2-4 word title.
CRITICAL: Never mention the chat title or renaming action in your conversational response to the user. Perform the renaming silently with the session_rename tool.`

          if (Array.isArray(event.system)) {
            event.system.unshift({ type: "text", text: instruction })
          } else if (typeof event.system === "string") {
            event.system = instruction + "\n\n" + event.system
          }

          sanitizeToolNames(event)
        } catch {
          // Silent fallback to avoid disrupting session execution
        }
      })
    }
  },
  server: async () => ({}),
}
