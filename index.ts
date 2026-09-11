import { tool } from "@opencode-ai/plugin"

let pluginContext: any = null

export default {
  id: "opencode.dynamic-title",
  setup: async (ctx: any) => {
    pluginContext = ctx

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
CRITICAL: Never mention the chat title or renaming action in your conversational response to the user. Perform the renaming silently using the session_rename tool (or tools.antigravity.session_rename).`

          if (Array.isArray(event.system)) {
            event.system.unshift({ type: "text", text: instruction })
          } else if (typeof event.system === "string") {
            event.system = instruction + "\n\n" + event.system
          }
        } catch {
          // Silent fallback to avoid disrupting session execution
        }
      })
    }
  },
  server: async () => ({
    tool: {
      session_rename: tool({
        description: "Rename the current chat session with a concise 2-4 word title when the current title is outdated or generic.",
        args: {
          title: tool.schema.string().describe("Concise descriptive 2-4 word title"),
        },
        async execute(args: { title: string }, context: any) {
          try {
            if (pluginContext?.session?.rename) {
              await pluginContext.session.rename({
                sessionID: context.sessionID,
                title: args.title,
              })
              return `Chat title updated to: "${args.title}"`
            }
            return "Failed: session.rename is not available in plugin context"
          } catch (err: any) {
            return `Error updating title: ${err?.message}`
          }
        },
      }),
    },
  }),
}

