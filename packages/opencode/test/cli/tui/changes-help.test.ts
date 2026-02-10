import { describe, expect, test } from "bun:test"
import { helpOptions } from "../../../src/cli/cmd/tui/routes/changes/help-options"

describe("changes help options", () => {
  test("includes sidebar toggle key entry when provided", () => {
    const result = helpOptions({ sidebarKey: "ctrl+b" })
    const match = result.find((item) => item.value === "toggle:ctrl+b")

    expect(match?.title).toBe("ctrl+b")
    expect(match?.description).toBe("Show/hide sidebar")
  })

  test("maps h and l help entries to diff and sidebar focus", () => {
    const result = helpOptions({ sidebarKey: "" })
    const h = result.find((item) => item.title === "h / \u2190")
    const l = result.find((item) => item.title === "l / \u2192")

    expect(h?.description).toBe("Focus diff pane")
    expect(l?.description).toBe("Focus sidebar pane")
  })
})
