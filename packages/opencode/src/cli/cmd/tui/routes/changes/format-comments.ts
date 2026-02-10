export type ReviewComment = {
  anchor: string
  header: string
  text: string
}

export type CommentsByFile = Map<string, Map<string, ReviewComment>>

type Serialized = {
  version: 1
  files: Array<{
    path: string
    comments: ReviewComment[]
  }>
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function isComment(input: unknown): input is ReviewComment {
  if (!isRecord(input)) return false
  return typeof input.anchor === "string" && typeof input.header === "string" && typeof input.text === "string"
}

export function hasComments(input: CommentsByFile) {
  for (const file of input.values()) {
    if (file.size > 0) return true
  }
  return false
}

export function serializeComments(input: CommentsByFile) {
  const files = [...input.entries()]
    .flatMap(([path, comments]) => {
      const list = [...comments.values()].filter((item) => item.text.trim().length > 0)
      if (list.length === 0) return []
      return [{ path, comments: list }]
    })
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => ({
      path: item.path,
      comments: item.comments.toSorted((a, b) => a.anchor.localeCompare(b.anchor)),
    }))

  return JSON.stringify({
    version: 1,
    files,
  } satisfies Serialized)
}

export function deserializeComments(input?: string) {
  if (!input) return new Map<string, Map<string, ReviewComment>>()

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return new Map<string, Map<string, ReviewComment>>()
  }

  if (!isRecord(parsed)) return new Map<string, Map<string, ReviewComment>>()
  if (parsed.version !== 1) return new Map<string, Map<string, ReviewComment>>()
  if (!Array.isArray(parsed.files)) return new Map<string, Map<string, ReviewComment>>()

  return parsed.files.reduce((acc, file) => {
    if (!isRecord(file)) return acc
    if (typeof file.path !== "string") return acc
    if (!Array.isArray(file.comments)) return acc

    const map = file.comments.reduce((items, comment) => {
      if (!isComment(comment)) return items
      items.set(comment.anchor, comment)
      return items
    }, new Map<string, ReviewComment>())

    if (map.size > 0) acc.set(file.path, map)
    return acc
  }, new Map<string, Map<string, ReviewComment>>())
}

export function formatCommentsForPrompt(input: CommentsByFile) {
  const files = [...input.entries()]
    .filter(([, comments]) => comments.size > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, comments]) => {
      const body = [...comments.values()].map((item) => [`### ${item.header}`, item.text, ""].join("\n")).join("\n")
      return [`## ${path}`, "", body].join("\n")
    })

  if (files.length === 0) return ""

  return ["Code Review Feedback", "", "Please apply the following review comments:", "", ...files].join("\n")
}
