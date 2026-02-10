import { parsePatch } from "diff"

export type StatusFile = {
  path: string
  index: string
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export type Count = {
  additions: number
  deletions: number
}

export type DiffHunk = {
  index: number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

type ReviewAnchor = {
  hunk: string
  oldStart: number | null
  oldEnd: number | null
  newStart: number | null
  newEnd: number | null
}

type ReviewEntry = {
  hunk: string
  text: string
  oldLine: number | null
  newLine: number | null
}

export function fileStageArgs(section: "unstaged" | "staged", path: string) {
  if (section === "unstaged") return ["git", "add", "-A", "--", path]
  return ["git", "reset", "-q", "--", path]
}

export function moveFileCursor(input: {
  section: "unstaged" | "staged"
  index: number
  direction: number
  unstaged: number
  staged: number
}) {
  const total = input.unstaged + input.staged
  if (total <= 0) return { section: "unstaged" as const, index: 0 }
  const offset = input.section === "unstaged" ? input.index : input.unstaged + input.index
  const next = (offset + input.direction + total) % total
  if (next < input.unstaged) {
    return {
      section: "unstaged" as const,
      index: next,
    }
  }
  return {
    section: "staged" as const,
    index: next - input.unstaged,
  }
}

export function compactPath(input: string, max: number) {
  if (input.length <= max) return input
  const segments = input.split("/").filter(Boolean)
  const name = segments[segments.length - 1] ?? input
  if (name.length + 4 >= max) return `...${name.slice(-(max - 3))}`

  let tail = name
  for (let i = segments.length - 2; i >= 0; i--) {
    const next = `${segments[i]}/${tail}`
    if (next.length + 4 > max) break
    tail = next
  }

  return `.../${tail}`
}

export function normalizePath(input: string) {
  if (!input.includes(" -> ")) return input.trim()
  const parts = input.split(" -> ")
  return parts[parts.length - 1]!.trim()
}

export function parseStatus(input: string): StatusFile[] {
  return input
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const index = line[0] ?? " "
      const worktree = line[1] ?? " "
      const raw = line.slice(3).trim()
      if (!raw) return []
      if (index === "!" && worktree === "!") return []
      const untracked = index === "?" && worktree === "?"
      return [
        {
          path: normalizePath(raw),
          index,
          worktree,
          staged: !untracked && index !== " ",
          unstaged: untracked || worktree !== " ",
          untracked,
        },
      ]
    })
}

export function parseNumstat(input: string): Map<string, Count> {
  return input
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .reduce((acc, line) => {
      const [a, d, raw] = line.split("\t")
      if (!raw) return acc
      const additions = a === "-" ? 0 : Number.parseInt(a, 10)
      const deletions = d === "-" ? 0 : Number.parseInt(d, 10)
      acc.set(normalizePath(raw), {
        additions: Number.isNaN(additions) ? 0 : additions,
        deletions: Number.isNaN(deletions) ? 0 : deletions,
      })
      return acc
    }, new Map<string, Count>())
}

export function parseHunks(input: string): DiffHunk[] {
  const file = parsePatch(input)[0]
  if (!file) return []

  const header = (oldStart: number, oldLines: number, newStart: number, newLines: number) =>
    `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`

  return file.hunks.map((hunk, index) => ({
    index,
    header: header(hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines),
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
  }))
}

function selectionLines(input: string) {
  const lines = input
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line, index, arr) => {
      if (line.length > 0) return true
      if (index === 0) return false
      if (index === arr.length - 1) return false
      return true
    })

  if (lines.length === 0) return []
  const first = lines.findIndex((line) => line.length > 0)
  const last = lines.findLastIndex((line) => line.length > 0)
  if (first < 0 || last < 0) return []
  return lines.slice(first, last + 1)
}

function normalize(line: string) {
  return line
    .replace(/^\s*\d+\s+/, "")
    .replace(/^[+\- ]/, "")
    .trimEnd()
}

function findMatch(lines: string[], selected: string[]) {
  if (lines.length === 0 || selected.length === 0 || selected.length > lines.length) return -1
  for (let i = 0; i <= lines.length - selected.length; i++) {
    let ok = true
    for (let j = 0; j < selected.length; j++) {
      if (lines[i + j] !== selected[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

export function reviewAnchorForSelection(input: string, selected: string): ReviewAnchor | null {
  const file = parsePatch(input)[0]
  if (!file) return null

  const entries = file.hunks.flatMap<ReviewEntry>((hunk) => {
    let old = hunk.oldStart
    let next = hunk.newStart
    return hunk.lines.flatMap<ReviewEntry>((line) => {
      const sign = line[0]
      if (!sign || sign === "\\") return []
      const text = line.slice(1).trimEnd()
      const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
      if (sign === " ") {
        const item: ReviewEntry = {
          hunk: hunkHeader,
          text,
          oldLine: old,
          newLine: next,
        }
        old += 1
        next += 1
        return [item]
      }
      if (sign === "-") {
        const item: ReviewEntry = {
          hunk: hunkHeader,
          text,
          oldLine: old,
          newLine: null,
        }
        old += 1
        return [item]
      }
      if (sign === "+") {
        const item: ReviewEntry = {
          hunk: hunkHeader,
          text,
          oldLine: null,
          newLine: next,
        }
        next += 1
        return [item]
      }
      return []
    })
  })

  const wanted = selectionLines(selected)
  if (wanted.length === 0) return null

  const source = entries.map((entry) => entry.text)
  const index = findMatch(source, wanted)
  const fallback = index >= 0 ? index : findMatch(source.map(normalize), wanted.map(normalize))
  if (fallback < 0) return null

  const range = entries.slice(fallback, fallback + wanted.length)
  const oldLines = range.flatMap((entry) => (entry.oldLine !== null ? [entry.oldLine] : []))
  const newLines = range.flatMap((entry) => (entry.newLine !== null ? [entry.newLine] : []))

  return {
    hunk: range[0]?.hunk ?? "",
    oldStart: oldLines[0] ?? null,
    oldEnd: oldLines[oldLines.length - 1] ?? null,
    newStart: newLines[0] ?? null,
    newEnd: newLines[newLines.length - 1] ?? null,
  }
}

function range(start: number | null, end: number | null) {
  if (!start || !end) return "none"
  if (start === end) return String(start)
  return `${start}-${end}`
}

export function reviewNoteForSelection(input: { path: string; patch: string; selected: string }) {
  const info = reviewAnchorForSelection(input.patch, input.selected)
  if (!info) return null
  return [
    "Review focus:",
    `file: ${input.path}`,
    `hunk: ${info.hunk}`,
    `old_lines: ${range(info.oldStart, info.oldEnd)}`,
    `new_lines: ${range(info.newStart, info.newEnd)}`,
  ].join("\n")
}

export function hunkLine(input: string, index: number) {
  if (index < 0) return 0
  const lines = input.split("\n")
  let seen = 0

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.startsWith("@@ ")) continue
    if (seen === index) return i
    seen += 1
  }

  return 0
}

