import { describe, it, expect } from "bun:test"
import { isGenericTitle, buildTitleInstruction, fixNamespace } from "./index"

describe("Dynamic Title Plugin", () => {
  it("identifies generic and timestamped initial titles", () => {
    expect(isGenericTitle("New session - 2026-10-02T18:00:00.000Z")).toBe(true)
    expect(isGenericTitle("New session - 2026-09-14T05:48:40.581Z")).toBe(true)
    expect(isGenericTitle("New Chat")).toBe(true)
    expect(isGenericTitle("Untitled")).toBe(true)
    expect(isGenericTitle("")).toBe(true)
    expect(isGenericTitle(undefined)).toBe(true)
  })

  it("recognizes specific, meaningful titles as non-generic", () => {
    expect(isGenericTitle("Subagent Router & Dynamic Planner")).toBe(false)
    expect(isGenericTitle("Order Bill Canvas Painter")).toBe(false)
    expect(isGenericTitle("Dependency Security Review")).toBe(false)
  })

  it("builds mandatory first-action instruction for generic titles", () => {
    const inst = buildTitleInstruction("New session - 2026-10-02T18:00:00.000Z")
    expect(inst).toContain("ACTION REQUIRED")
    expect(inst).toContain("FIRST tool call before working on the task")
    expect(inst).toContain("tools.opencode.session_rename")
    expect(inst).toContain("Perform the rename silently")
    expect(inst).toContain("ORDER OF OPERATIONS")
    expect(inst).toContain("planner({ init: [...] })")
  })

  it("builds cautious instruction for established titles", () => {
    const inst = buildTitleInstruction("Subagent Router & Dynamic Planner")
    expect(inst).not.toContain("ACTION REQUIRED")
    expect(inst).toContain("Rename the session only when the overarching goal has fundamentally changed")
    expect(inst).toContain("tools.opencode.session_rename")
    expect(inst).toContain("ORDER OF OPERATIONS")
    expect(inst).toContain("planner")
  })

  it("fixes antigravity namespace rewriting cleanly", () => {
    const code1 = `await tools.antigravity.session_rename({ title: "New Title" })`
    expect(fixNamespace(code1)).toBe(`await tools.opencode.session_rename({ title: "New Title" })`)

    const code2 = `tools["antigravity"].session_rename({ title: "New Title" })`
    expect(fixNamespace(code2)).toBe(`tools["opencode"].session_rename({ title: "New Title" })`)
  })
})
