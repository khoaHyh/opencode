import { describe, expect, test } from "bun:test"
import { frame, paneForKey, sidebarColumnWidth, statusline } from "../../../src/cli/cmd/tui/routes/changes/layout"

describe("changes layout controls", () => {
  test("statusline labels are static while navigating sidebar state", () => {
    const first = statusline({
      pane: "sidebar",
      section: "unstaged",
      cursor: "files",
      hasComments: false,
    })
    const second = statusline({
      pane: "diff",
      section: "staged",
      cursor: "hunks",
      hasComments: false,
    })

    expect(first.actions).toEqual([
      { key: "?", label: "help" },
      { key: "space", label: "stage" },
      { key: "c", label: "comment" },
      { key: "q", label: "quit" },
    ])
    expect(second.actions).toEqual(first.actions)
    expect(first.sidebarLabel).toBe("Toggle Sidebar")
    expect(second.sidebarLabel).toBe(first.sidebarLabel)
    expect(first.submitLabel).toBe("Submit Review")
    expect(second.submitLabel).toBe(first.submitLabel)
    expect(first.submitEnabled).toBe(false)
    expect(second.submitEnabled).toBe(false)
  })

  test("statusline only toggles submit state when comments exist", () => {
    const result = statusline({
      pane: "sidebar",
      section: "unstaged",
      cursor: "files",
      hasComments: true,
    })

    expect(result.actions).toEqual([
      { key: "?", label: "help" },
      { key: "space", label: "stage" },
      { key: "c", label: "comment" },
      { key: "q", label: "quit" },
    ])
    expect(result.submitLabel).toBe("Submit Review")
    expect(result.submitEnabled).toBe(true)
  })

  test("sidebarColumnWidth collapses to compact width when hidden", () => {
    expect(sidebarColumnWidth({ sidebarVisible: true, expanded: 46 })).toBe(46)
    expect(sidebarColumnWidth({ sidebarVisible: false, expanded: 46 })).toBe(0)
  })

  test("paneForKey maps h to diff and l to sidebar", () => {
    expect(paneForKey({ key: "h", sidebarVisible: true })).toBe("diff")
    expect(paneForKey({ key: "l", sidebarVisible: true })).toBe("sidebar")
    expect(paneForKey({ key: "l", sidebarVisible: false })).toBe("diff")
  })

  test("frame keeps statusline visible and main panel shrinkable", () => {
    const result = frame()
    expect(result.mainMinHeight).toBe(0)
    expect(result.statusFlexShrink).toBe(0)
  })
})
