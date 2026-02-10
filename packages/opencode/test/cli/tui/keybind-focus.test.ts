import { describe, expect, test } from "bun:test"
import { canRestoreFocus } from "../../../src/cli/cmd/tui/context/keybind-focus"

describe("keybind focus restore", () => {
  test("returns false for empty focus targets", () => {
    expect(canRestoreFocus(undefined)).toBe(false)
    expect(canRestoreFocus(null)).toBe(false)
  })

  test("returns false for destroyed focus targets", () => {
    expect(canRestoreFocus({ isDestroyed: true })).toBe(false)
  })

  test("returns true for active focus targets", () => {
    expect(canRestoreFocus({ isDestroyed: false })).toBe(true)
    expect(canRestoreFocus({})).toBe(true)
  })
})
