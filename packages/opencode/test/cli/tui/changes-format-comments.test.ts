import { describe, expect, test } from "bun:test"
import {
  deserializeComments,
  formatCommentsForPrompt,
  hasComments,
  serializeComments,
} from "../../../src/cli/cmd/tui/routes/changes/format-comments"

describe("changes format comments", () => {
  test("formats grouped comments by file and hunk", () => {
    const input = new Map([
      [
        "src/a.ts",
        new Map([
          [
            "hunk:1:1",
            {
              anchor: "hunk:1:1",
              header: "@@ -1,2 +1,2 @@",
              text: "rename foo to bar",
            },
          ],
        ]),
      ],
      [
        "src/b.ts",
        new Map([
          [
            "hunk:20:20",
            {
              anchor: "hunk:20:20",
              header: "@@ -20,2 +20,3 @@",
              text: "nit: tighten error message",
            },
          ],
        ]),
      ],
    ])

    const result = formatCommentsForPrompt(input)
    expect(result).toContain("## src/a.ts")
    expect(result).toContain("### @@ -1,2 +1,2 @@")
    expect(result).toContain("rename foo to bar")
    expect(result).toContain("## src/b.ts")
  })

  test("hasComments works for empty and non-empty maps", () => {
    const empty = new Map<string, Map<string, { anchor: string; header: string; text: string }>>()
    const filled = new Map([
      [
        "src/a.ts",
        new Map([
          [
            "hunk:1:1",
            {
              anchor: "hunk:1:1",
              header: "@@ -1,2 +1,2 @@",
              text: "comment",
            },
          ],
        ]),
      ],
    ])

    expect(hasComments(empty)).toBe(false)
    expect(hasComments(filled)).toBe(true)
  })

  test("serializeComments and deserializeComments round-trip data", () => {
    const input = new Map([
      [
        "src/a.ts",
        new Map([
          [
            "hunk:1:1",
            {
              anchor: "hunk:1:1",
              header: "@@ -1,2 +1,2 @@",
              text: "first",
            },
          ],
        ]),
      ],
      [
        "src/b.ts",
        new Map([
          [
            "hunk:9:9",
            {
              anchor: "hunk:9:9",
              header: "@@ -9,2 +9,2 @@",
              text: "second",
            },
          ],
        ]),
      ],
    ])

    const serialized = serializeComments(input)
    const output = deserializeComments(serialized)

    expect(output).toEqual(input)
  })

  test("deserializeComments returns empty map for invalid input", () => {
    expect(deserializeComments("not-json")).toEqual(new Map())
    expect(deserializeComments("[]")).toEqual(new Map())
  })
})
