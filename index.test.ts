import { describe, it, expect } from "bun:test"
import plugin, { EXECUTE_REMINDER, buildTitleInstruction, remindAtActTime, sanitizeToolNames } from "./index"

// Drives the real hooks against a fake host. The repairs are only worth testing through the hook,
// because the hook decides which of them run and whether it stands down.
const setup = async (namespaces: string[] = []) => {
  const hooks: Record<string, any> = {}
  const ctx = {
    tool: {
      hook: async (name: string, fn: any) => { hooks[name] = fn },
      list: async () => namespaces.map((name) => ({ options: { namespace: name } })),
    },
    session: { hook: async (name: string, fn: any) => { hooks[name] = fn }, get: async () => ({}) },
  }
  await (plugin as any).setup(ctx)
  return async (code: string) => {
    const event: any = { tool: "execute", input: { code } }
    await hooks["execute.before"](event)
    return event.input.code as string
  }
}

describe("execute hook", () => {
  it("repairs the bad call shapes that throw at runtime", async () => {
    const repair = await setup()
    // 9Router rewrites the namespace and keeps the original casing.
    expect(await repair("await tools.antigravity.session_rename({})")).toBe("await tools.opencode.session_rename({})")
    expect(await repair("await tools.Antigravity.session_rename({})")).toBe("await tools.opencode.session_rename({})")
    // The namespace is held and used later, or reached through a bracket.
    expect(await repair("const t = tools.antigravity; t.session_rename({})")).toBe("const t = tools.opencode; t.session_rename({})")
    expect(await repair('tools.antigravity["session_rename"]({})')).toBe('tools.opencode["session_rename"]({})')
    expect(await repair('tools["antigravity"].session_rename({})')).toBe('tools["opencode"].session_rename({})')
    expect(await repair('namespace: "Antigravity"')).toBe('namespace: "opencode"')
    // A bare call throws "session_rename is not defined".
    expect(await repair("return session_rename({})")).toBe("return tools.opencode.session_rename({})")
    // Both doubled shapes throw "Unknown tool 'tools.opencode.session_rename'".
    expect(await repair('tools["tools.opencode.session_rename"]({})')).toBe('tools["opencode.session_rename"]({})')
    expect(await repair("tools.tools.opencode.session_rename({})")).toBe("tools.opencode.session_rename({})")
  })

  it("repairs several bad shapes in a single call", async () => {
    const repair = await setup()
    const code = "await tools.Antigravity.session_rename({}); return session_rename({})"
    expect(await repair(code)).toBe("await tools.opencode.session_rename({}); return tools.opencode.session_rename({})")
  })

  it("leaves correct code and incidental mentions untouched", async () => {
    const repair = await setup()
    for (const code of [
      "tools.opencode.session_rename({})",
      'tools["opencode"].session_rename({})',
      "my_session_rename({})",
      'search({ query: "antigravity bug" })',
      'await tools.webfetch({ url: "https://example.com/antigravity" })',
      "// tools.antigravity is rewritten by the gateway",
    ])
      expect(await repair(code)).toBe(code)
  })

  it("does not rewrite the namespace when a real antigravity namespace is registered", async () => {
    const repair = await setup(["antigravity"])
    expect(await repair("await tools.antigravity.session_rename({})")).toBe("await tools.antigravity.session_rename({})")
    // The other repairs are not about that namespace, so they still apply.
    expect(await repair("return session_rename({})")).toBe("return tools.opencode.session_rename({})")
  })

  it("ignores calls that are not Code Mode execute", async () => {
    const hooks: Record<string, any> = {}
    const ctx = {
      tool: { hook: async (name: string, fn: any) => { hooks[name] = fn }, list: async () => [] },
      session: { hook: async () => {}, get: async () => ({}) },
    }
    await (plugin as any).setup(ctx)
    const event: any = { tool: "read", input: { code: "await tools.antigravity.session_rename({})" } }
    await hooks["execute.before"](event)
    expect(event.input.code).toBe("await tools.antigravity.session_rename({})")
  })
})

const runContext = async (session: any, tools: Record<string, any> = {}) => {
  const hooks: Record<string, any> = {}
  const ctx = {
    tool: { hook: async () => {}, list: async () => [] },
    session: {
      hook: async (name: string, fn: any) => { hooks[name] = fn },
      get: async () => { if (session instanceof Error) throw session; return session },
    },
  }
  await (plugin as any).setup(ctx)
  const event: any = { sessionID: "ses_test", system: [], messages: [], tools }
  await hooks.context(event)
  return event
}

describe("context hook", () => {
  it("appends the title instruction carrying the live title", async () => {
    const event = await runContext({ id: "ses_test", title: "Greeting" })
    expect(event.system).toEqual([{ type: "text", text: buildTitleInstruction("Greeting") }])
  })

  it("falls back to a placeholder when the session has no title yet", async () => {
    const event = await runContext({ id: "ses_test", title: "" })
    expect(event.system[0].text).toContain('Session title: "New session"')
  })

  it("leaves subagent child sessions alone", async () => {
    const event = await runContext({ id: "ses_child", title: "Task", parentID: "ses_parent" })
    expect(event.system).toEqual([])
  })

  it("survives a failed session lookup", async () => {
    const event = await runContext(new Error("host unavailable"))
    expect(event.system).toEqual([])
  })

  it("reminds through the execute tool description, and only once", async () => {
    const event = await runContext({ id: "ses_test", title: "Work" }, { execute: { description: "Run JavaScript." } })
    expect(event.tools.execute.description.endsWith(EXECUTE_REMINDER)).toBe(true)
    const once = event.tools.execute.description
    remindAtActTime(event)
    expect(event.tools.execute.description).toBe(once)
  })

  it("does not remind twice when the description already mentions the rename", async () => {
    const description = "Run JavaScript. Rename with session_rename when the title is stale."
    const event = await runContext({ id: "ses_test", title: "Work" }, { execute: { description } })
    expect(event.tools.execute.description).toBe(description)
  })
})

describe("title instruction", () => {
  it("names the tool without a tools prefix and stays short", () => {
    const instruction = buildTitleInstruction("Hey")
    expect(instruction).toContain('Session title: "Hey"')
    expect(instruction).toContain("opencode.session_rename")
    // A "tools." prefix in prose makes models re-wrap the string: tools["tools.opencode.session_rename"].
    expect(instruction).not.toContain("tools.")
    // A literal template can be passed in verbatim as a title.
    expect(instruction).not.toContain('"<2-4 words>"')
    // The old guard made the model rename once and then skip every later turn.
    expect(instruction).not.toContain("Follow-ups keep the title")
    expect(instruction).not.toContain("planner")
    expect(instruction.split(/\s+/).length).toBeLessThan(50)
  })
})

describe("tool name sanitiser", () => {
  it("moves an invalid tool definition to a safe key and keeps it callable", () => {
    const definition = { description: "rename", execute: () => undefined }
    const event = { tools: { "a.b": definition, read: { description: "ok" } }, messages: [] }
    sanitizeToolNames(event)
    // Core resolves a tool by object identity, so the moved definition must be the same object.
    expect(event.tools.a_b).toBe(definition)
    expect("a.b" in event.tools).toBe(false)
    expect(event.tools.read).toBeDefined()
  })

  it("renames a call and its result the same way so the pair still matches", () => {
    const event = { messages: [{ content: [
      { type: "text", text: "leave me" },
      { type: "tool-call", name: "antigravity:session_rename" },
      { type: "tool-result", name: "antigravity:session_rename" },
    ] }] }
    sanitizeToolNames(event)
    expect(event.messages[0].content.map((part) => part.name ?? part.text)).toEqual([
      "leave me",
      "antigravity_session_rename",
      "antigravity_session_rename",
    ])
  })
})
