import { describe, expect, test } from "bun:test"
import {
  compactPath,
  fileStageArgs,
  hunkLine,
  moveFileCursor,
  parseHunks,
  parseNumstat,
  parseStatus,
  reviewNoteForSelection,
  reviewAnchorForSelection,
} from "../../../src/cli/cmd/tui/routes/changes/git"

describe("changes git helpers", () => {
  test("parseStatus reads staged and unstaged files", () => {
    const input = ["MM src/a.ts", " M src/b.ts", "A  src/c.ts", "?? src/d.ts", "R  old.ts -> src/e.ts"].join("\n")
    const result = parseStatus(input)

    const map = new Map(result.map((item) => [item.path, item]))

    expect(map.get("src/a.ts")).toMatchObject({ staged: true, unstaged: true })
    expect(map.get("src/b.ts")).toMatchObject({ staged: false, unstaged: true })
    expect(map.get("src/c.ts")).toMatchObject({ staged: true, unstaged: false })
    expect(map.get("src/d.ts")).toMatchObject({ staged: false, unstaged: true, untracked: true })
    expect(map.get("src/e.ts")).toMatchObject({ staged: true, unstaged: false })
  })

  test("parseNumstat maps additions and deletions", () => {
    const input = ["3\t1\tsrc/a.ts", "10\t0\told.ts -> src/e.ts", "-\t-\tbinary.png"].join("\n")
    const result = parseNumstat(input)

    expect(result.get("src/a.ts")).toEqual({ additions: 3, deletions: 1 })
    expect(result.get("src/e.ts")).toEqual({ additions: 10, deletions: 0 })
    expect(result.get("binary.png")).toEqual({ additions: 0, deletions: 0 })
  })

  test("parseHunks returns patch hunks in order", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " same",
      "@@ -10,2 +10,3 @@",
      " foo",
      "-bar",
      "+baz",
      "+qux",
      "",
    ].join("\n")

    const result = parseHunks(diff)
    expect(result.map((item) => item.header)).toEqual(["@@ -1,2 +1,2 @@", "@@ -10,2 +10,3 @@"])
  })

  test("hunkLine returns patch line for selected hunk", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " same",
      "@@ -10,2 +10,3 @@",
      " foo",
      "-bar",
      "+baz",
      "+qux",
      "",
    ].join("\n")

    expect(hunkLine(diff, 0)).toBe(4)
    expect(hunkLine(diff, 1)).toBe(8)
    expect(hunkLine(diff, 9)).toBe(0)
  })

  test("fileStageArgs returns git commands for stage and unstage", () => {
    expect(fileStageArgs("unstaged", "src/a.ts")).toEqual(["git", "add", "-A", "--", "src/a.ts"])
    expect(fileStageArgs("staged", "src/a.ts")).toEqual(["git", "reset", "-q", "--", "src/a.ts"])
  })

  test("moveFileCursor moves between unstaged and staged sections", () => {
    expect(
      moveFileCursor({
        section: "unstaged",
        index: 1,
        direction: 1,
        unstaged: 2,
        staged: 2,
      }),
    ).toEqual({ section: "staged", index: 0 })

    expect(
      moveFileCursor({
        section: "staged",
        index: 0,
        direction: -1,
        unstaged: 2,
        staged: 2,
      }),
    ).toEqual({ section: "unstaged", index: 1 })
  })

  test("compactPath keeps filename visible and shortens long paths", () => {
    expect(compactPath("src/a.ts", 12)).toBe("src/a.ts")
    expect(compactPath("very/long/path/to/some/file-name.ts", 20)).toBe(".../file-name.ts")
  })

  test("reviewAnchorForSelection maps selected diff text to hunk and line ranges", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@",
      " lineA",
      "-old",
      "+new",
      " same",
      "+extra",
    ].join("\n")

    const info = reviewAnchorForSelection(diff, "new\nsame")
    expect(info).toEqual({
      hunk: "@@ -10,3 +10,4 @@",
      oldStart: 12,
      oldEnd: 12,
      newStart: 11,
      newEnd: 12,
    })
  })

  test("reviewAnchorForSelection returns null when selection does not map to patch lines", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n")

    expect(reviewAnchorForSelection(diff, "missing text")).toBeNull()
  })

  test("reviewNoteForSelection formats file, hunk, and old/new line ranges", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@",
      " lineA",
      "-old",
      "+new",
      " same",
      "+extra",
    ].join("\n")

    const note = reviewNoteForSelection({
      path: "src/a.ts",
      patch: diff,
      selected: "new\nsame",
    })

    expect(note).toBe(
      [
        "Review focus:",
        "file: src/a.ts",
        "hunk: @@ -10,3 +10,4 @@",
        "old_lines: 12",
        "new_lines: 11-12",
      ].join("\n"),
    )
  })

  test("reviewNoteForSelection returns null when selection does not map", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n")

    expect(
      reviewNoteForSelection({
        path: "src/a.ts",
        patch: diff,
        selected: "not in patch",
      }),
    ).toBeNull()
  })
})
