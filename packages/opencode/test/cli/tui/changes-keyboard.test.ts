import { describe, expect, test } from "bun:test"
import { canHandleChangesKeys, isChangesExitKey, isCommentDeleteKey } from "../../../src/cli/cmd/tui/routes/changes/keyboard"

describe("changes keyboard helpers", () => {
  test("isChangesExitKey supports escape and q", () => {
    expect(isChangesExitKey("escape")).toBe(true)
    expect(isChangesExitKey("q")).toBe(true)
    expect(isChangesExitKey("c")).toBe(false)
  })

  test("canHandleChangesKeys blocks route shortcuts while dialog or leader is active", () => {
    expect(canHandleChangesKeys({ dialogOpen: false, leader: false })).toBe(true)
    expect(canHandleChangesKeys({ dialogOpen: true, leader: false })).toBe(false)
    expect(canHandleChangesKeys({ dialogOpen: false, leader: true })).toBe(false)
  })

  test("isCommentDeleteKey supports keyboard-first delete actions", () => {
    expect(isCommentDeleteKey("x")).toBe(true)
    expect(isCommentDeleteKey("delete")).toBe(true)
    expect(isCommentDeleteKey("backspace")).toBe(false)
  })
})
