import { describe, it, expect } from "bun:test"
import plugin, {
  EXECUTE_REMINDER,
  buildTitleInstruction,
  fixDoubledPath,
  fixNamespace,
  fixRenameCall,
  remindAtActTime,
  sanitizeToolNames,
} from "./index"

describe("dynamic title instructions", () => {
  it("uses one concise standing instruction", () => {
    const instruction = buildTitleInstruction("Hey")
    expect(instruction).toContain("Each turn")
    expect(instruction).toContain("opencode.session_rename")
    // A "tools." prefix in prose makes models re-wrap the string: tools["tools.opencode.session_rename"].
    expect(instruction).not.toContain("tools.")
    expect(instruction).toContain("Never mention the title or the rename.")
    // The old guard line vetoed the standing check: the model renamed once, then called every later
    // turn a "follow-up" and skipped it (4 of 6 drift sessions).
    expect(instruction).not.toContain("Follow-ups keep the title")
    expect(instruction).not.toContain("planner")
    expect(instruction).not.toContain("ORDER OF OPERATIONS")
    expect(instruction).not.toContain('"<2-4 words>"')
    expect(instruction.split(/\s+/).length).toBeLessThan(50)
  })

  it("rekeys invalid tool definitions and preserves their identity", () => {
    const definition = { description: "rename", execute: () => undefined }
    const event = { tools: { "a.b": definition }, messages: [] }
    sanitizeToolNames(event)
    expect(event.tools.a_b).toBe(definition)
    expect("a.b" in event.tools).toBe(false)
  })

  it("renames invalid tool call and result names consistently", () => {
    const event = { messages: [{ content: [
      { type: "tool-call", name: "antigravity:session_rename" },
      { type: "tool-result", name: "antigravity:session_rename" },
    ] }] }
    sanitizeToolNames(event)
    expect(event.messages[0].content.map((part) => part.name)).toEqual(["antigravity_session_rename", "antigravity_session_rename"])
  })
})

describe("Code Mode call repairs", () => {
  it("fixes antigravity namespace rewriting", () => {
    expect(fixNamespace("await tools.antigravity.session_rename({})")).toBe("await tools.opencode.session_rename({})")
    expect(fixNamespace('tools["antigravity"].session_rename({})')).toBe('tools["opencode"].session_rename({})')
  })

  it("fixes the capitalised namespace 9Router actually produces", () => {
    expect(fixNamespace("await tools.Antigravity.session_rename({})")).toBe("await tools.opencode.session_rename({})")
    expect(fixNamespace('tools["Antigravity"].session_rename({})')).toBe('tools["opencode"].session_rename({})')
    expect(fixNamespace('namespace: "Antigravity"')).toBe('namespace: "opencode"')
  })

  it("repairs the doubled tools path that models paste from the prompt", () => {
    // Reproduced live: both throw "Unknown tool 'tools.opencode.session_rename'".
    expect(fixDoubledPath('tools["tools.opencode.session_rename"]({})')).toBe('tools["opencode.session_rename"]({})')
    expect(fixDoubledPath("tools.tools.opencode.session_rename({})")).toBe("tools.opencode.session_rename({})")
    expect(fixDoubledPath("tools.opencode.session_rename({})")).toBe("tools.opencode.session_rename({})")
  })

  it("leaves the word antigravity alone when it is not a namespace call", () => {
    for (const code of [
      'search({ query: "antigravity bug" })',
      'await tools.webfetch({ url: "https://example.com/antigravity" })',
      "// tools.antigravity is rewritten by the gateway",
    ])
      expect(fixNamespace(code)).toBe(code)
  })

  it("repairs bare rename calls without matching qualified names", () => {
    expect(fixRenameCall("await session_rename({")).toBe("await tools.opencode.session_rename({")
    expect(fixRenameCall("return session_rename({")).toBe("return tools.opencode.session_rename({")
    for (const code of ["tools.opencode.session_rename(", 'tools["opencode"].session_rename(', "my_session_rename("])
      expect(fixRenameCall(code)).toBe(code)
  })
})

const runContextHook = async (session: any) => {
  const hooks: Record<string, any> = {}
  const ctx = {
    tool: { hook: async () => {}, list: async () => [] },
    session: {
      hook: async (name: string, fn: any) => { hooks[name] = fn },
      get: async () => { if (session instanceof Error) throw session; return session },
    },
  }
  await (plugin as any).setup(ctx)
  const event: any = { sessionID: "ses_test", system: [], messages: [], tools: {} }
  await hooks.context(event)
  return event
}

describe("context hook", () => {
  it("appends the title instruction for a root session", async () => {
    const event = await runContextHook({ id: "ses_test", title: "Greeting" })
    expect(event.system.length).toBe(1)
    expect(event.system[0].text).toContain('Session title: "Greeting"')
  })
  it("leaves subagent child sessions alone", async () => {
    const event = await runContextHook({ id: "ses_child", title: "Task", parentID: "ses_parent" })
    expect(event.system).toEqual([])
  })
  it("survives a failed session lookup", async () => {
    const event = await runContextHook(new Error("host unavailable"))
    expect(event.system).toEqual([])
  })
})

describe("execute hook", () => {
  it("repairs both namespaces when antigravity is not registered", async () => {
    const hooks: Record<string, any> = {}
    const ctx = {
      tool: { hook: async (name: string, fn: any) => { hooks[name] = fn }, list: async () => [] },
      session: { hook: async () => {}, get: async () => ({}) },
    }
    await (plugin as any).setup(ctx)
    const event: any = { tool: "execute", input: { code: "await tools.antigravity.session_rename({}); return session_rename({})" } }
    await hooks["execute.before"](event)
    expect(event.input.code).toBe("await tools.opencode.session_rename({}); return tools.opencode.session_rename({})")
  })

  it("repairs a doubled path and a capitalised namespace in one call", async () => {
    const hooks: Record<string, any> = {}
    const ctx = {
      tool: { hook: async (name: string, fn: any) => { hooks[name] = fn }, list: async () => [] },
      session: { hook: async () => {}, get: async () => ({}) },
    }
    await (plugin as any).setup(ctx)
    const event: any = { tool: "execute", input: { code: 'return tools["tools.opencode.session_rename"]({ title: "Kyoto" })' } }
    await hooks["execute.before"](event)
    expect(event.input.code).toBe('return tools["opencode.session_rename"]({ title: "Kyoto" })')
  })
})

describe("act-time reminder", () => {
  it("appends the reminder to the execute tool description once", () => {
    const event = { tools: { execute: { description: "Run JavaScript.", input: {} }, read: { description: "Read." } } }
    remindAtActTime(event)
    expect(event.tools.execute.description.endsWith(EXECUTE_REMINDER)).toBe(true)
    const once = event.tools.execute.description
    remindAtActTime(event)
    expect(event.tools.execute.description).toBe(once)
    expect(event.tools.read.description).toBe("Read.")
  })

  it("does nothing when the execute description already mentions session_rename", () => {
    const description = "Run JavaScript. Rename with session_rename when the title is stale."
    const event = { tools: { execute: { description } } }
    remindAtActTime(event)
    expect(event.tools.execute.description).toBe(description)
  })

  it("ignores requests without an execute tool", () => {
    const event = { tools: { read: { description: "Read." } } }
    remindAtActTime(event)
    expect(event.tools.read.description).toBe("Read.")
  })
})
