import { Identifier } from "@/id/id"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useTextareaKeybindings } from "@tui/component/textarea-keybindings"
import { useKV } from "@tui/context/kv"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import type { MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import path from "node:path"
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ChangesHelp } from "./help"
import {
  deserializeComments,
  type CommentsByFile,
  formatCommentsForPrompt,
  hasComments,
  serializeComments,
} from "./format-comments"
import {
  compactPath,
  fileStageArgs,
  hunkLine,
  moveFileCursor,
  parseHunks,
  parseNumstat,
  parseStatus,
  reviewNoteForSelection,
  type StatusFile,
} from "./git"
import { canHandleChangesKeys, isChangesExitKey, isCommentDeleteKey } from "./keyboard"
import { frame, paneForKey, sidebarColumnWidth, statusline } from "./layout"

const SIDEBAR_WIDTH = 46
const FILE_COMMENT_ANCHOR = "file"
const FILE_COMMENT_HEADER = "File Review"

type Section = "unstaged" | "staged"
type Pane = "sidebar" | "diff"
type Cursor = "files" | "hunks" | "comment"

type FileItem = StatusFile & {
  additions: number
  deletions: number
}

async function runGit(input: { cwd: string; args: string[]; stdin?: string }) {
  const proc = Bun.spawn(input.args, {
    cwd: input.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  proc.stdin.write(input.stdin ?? "")
  proc.stdin.end()
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

function bound(index: number, total: number) {
  if (total <= 0) return 0
  return Math.min(Math.max(index, 0), total - 1)
}

function order(items: FileItem[]) {
  return items.toSorted((a, b) => a.path.localeCompare(b.path))
}

export function Changes() {
  const routeData = useRouteData("changes")
  const route = useRoute()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const dialog = useDialog()
  const textareaKeybindings = useTextareaKeybindings()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  const [files, setFiles] = createStore({
    unstaged: [] as FileItem[],
    staged: [] as FileItem[],
  })
  const [patch, setPatch] = createSignal("")
  const [comments, setComments] = createSignal<CommentsByFile>(new Map())
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const [store, setStore] = createStore({
    pane: "sidebar" as Pane,
    cursor: "files" as Cursor,
    sidebarVisible: true,
    section: "unstaged" as Section,
    file: {
      unstaged: 0,
      staged: 0,
    },
    hunk: 0,
    busy: false,
    token: 0,
    commentEditing: false,
    commentDraft: "",
  })
  let commentInput: TextareaRenderable | undefined

  const [wrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const cwd = createMemo(() => sync.data.path.directory || process.cwd())
  const storage = createMemo(() => `changes_comments:${cwd()}`)
  const list = createMemo(() => files[store.section])
  const selected = createMemo(() => list()[store.file[store.section]])
  const hunks = createMemo(() => parseHunks(patch()))
  const currentComment = createMemo(() => {
    const file = selected()?.path
    if (!file) return undefined
    return comments().get(file)?.get(FILE_COMMENT_ANCHOR)
  })
  const hasAny = createMemo(() => hasComments(comments()))
  const ui = createMemo(() =>
    statusline({
      pane: store.pane,
      section: store.section,
      cursor: store.cursor,
      hasComments: hasAny(),
    }),
  )
  const shell = frame()
  const sidebarWidth = createMemo(() =>
    sidebarColumnWidth({
      sidebarVisible: store.sidebarVisible,
      expanded: SIDEBAR_WIDTH,
    }),
  )
  const sidebarKey = createMemo(() => keybind.print("sidebar_toggle"))
  const pathWidth = createMemo(() => Math.max(18, sidebarWidth() - 16))
  const filetype = createMemo(() => {
    const file = selected()
    if (!file) return "none"
    const ext = path.extname(file.path)
    const language = LANGUAGE_EXTENSIONS[ext]
    if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
    return language ?? "none"
  })
  const view = createMemo(() => {
    const style = sync.data.config.tui?.diff_style
    if (style === "stacked") return "unified"
    return dimensions().width > 120 ? "split" : "unified"
  })

  const hasSidebar = () => store.sidebarVisible

  function toggleSidebar() {
    const next = !store.sidebarVisible
    setStore("sidebarVisible", next)
    if (!next) {
      setStore("pane", "diff")
      setStore("cursor", "files")
    }
  }

  function showHelp() {
    dialog.replace(() => <ChangesHelp sidebarKey={sidebarKey()} />)
  }

  command.register(() => [
    {
      title: "Show changes keybindings",
      value: "changes.help",
      category: "Changes",
      onSelect: (dialog) => {
        dialog.clear()
        queueMicrotask(() => showHelp())
      },
    },
    {
      title: store.sidebarVisible ? "Hide sidebar" : "Show sidebar",
      value: "changes.sidebar.toggle",
      category: "Changes",
      keybind: "sidebar_toggle",
      onSelect: (dialog) => {
        toggleSidebar()
        dialog.clear()
      },
    },
    {
      title: "Submit review comments",
      value: "changes.submit",
      category: "Changes",
      enabled: hasAny(),
      onSelect: (dialog) => {
        submitReview()
        dialog.clear()
      },
    },
  ])

  async function refresh() {
    const dir = cwd()
    const [statusText, unstagedNumstatText, stagedNumstatText] = await Promise.all([
      runGit({
        cwd: dir,
        args: ["git", "-c", "core.quotepath=false", "status", "--porcelain"],
      }),
      runGit({
        cwd: dir,
        args: ["git", "-c", "core.quotepath=false", "diff", "--numstat", "--"],
      }),
      runGit({
        cwd: dir,
        args: ["git", "-c", "core.quotepath=false", "diff", "--cached", "--numstat", "--"],
      }),
    ])

    const base = parseStatus(statusText.stdout)
    const unstagedCounts = parseNumstat(unstagedNumstatText.stdout)
    const stagedCounts = parseNumstat(stagedNumstatText.stdout)
    const unstaged = order(
      base
        .filter((item) => item.unstaged)
        .map((item) => {
          const count = unstagedCounts.get(item.path) ?? { additions: 0, deletions: 0 }
          return {
            ...item,
            additions: count.additions,
            deletions: count.deletions,
          }
        }),
    )
    const staged = order(
      base
        .filter((item) => item.staged)
        .map((item) => {
          const count = stagedCounts.get(item.path) ?? { additions: 0, deletions: 0 }
          return {
            ...item,
            additions: count.additions,
            deletions: count.deletions,
          }
        }),
    )

    setFiles("unstaged", unstaged)
    setFiles("staged", staged)
    setStore("file", "unstaged", (value) => bound(value, unstaged.length))
    setStore("file", "staged", (value) => bound(value, staged.length))

    if (store.section === "unstaged" && unstaged.length === 0 && staged.length > 0) setStore("section", "staged")
    if (store.section === "staged" && staged.length === 0 && unstaged.length > 0) setStore("section", "unstaged")
  }

  async function diffText(input: { file: FileItem; section: Section }) {
    if (input.section === "unstaged" && input.file.untracked) {
      return runGit({
        cwd: cwd(),
        args: ["git", "-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", input.file.path],
      }).then((x) => x.stdout)
    }
    const args = ["git", "-c", "core.quotepath=false", "diff", "--no-ext-diff"]
    if (input.section === "staged") args.push("--cached")
    args.push("--", input.file.path)
    return runGit({ cwd: cwd(), args }).then((x) => x.stdout)
  }

  function setSection(section: Section) {
    setStore("section", section)
    setStore("cursor", "files")
    setStore("hunk", 0)
    if (!hasSidebar()) setStore("pane", "diff")
  }

  function setPane(key: "h" | "l") {
    setStore(
      "pane",
      paneForKey({
        key,
        sidebarVisible: hasSidebar(),
      }),
    )
  }

  function focusHunk(next: number) {
    const total = hunks().length
    if (total === 0) {
      setStore("hunk", 0)
      return
    }
    const index = (next + total) % total
    setStore("hunk", index)
    const line = hunkLine(patch(), index)
    scroll()?.scrollTo(Math.max(0, line - 4))
  }

  function moveFile(direction: number) {
    const next = moveFileCursor({
      section: store.section,
      index: store.file[store.section],
      direction,
      unstaged: files.unstaged.length,
      staged: files.staged.length,
    })
    setStore("section", next.section)
    setStore("file", next.section, next.index)
    setStore("hunk", 0)
  }

  function moveHunk(direction: number) {
    focusHunk(store.hunk + direction)
  }

  function startComment() {
    if (!selected()) return
    setStore("commentDraft", currentComment()?.text ?? "")
    setStore("commentEditing", true)
    setStore("cursor", "comment")
    setStore("pane", "diff")
  }

  function cancelComment() {
    setStore("commentEditing", false)
    setStore("commentDraft", "")
    setStore("cursor", "hunks")
  }

  function saveComment() {
    const file = selected()
    if (!file) return
    const text = (commentInput?.plainText ?? store.commentDraft).trim()
    if (!text) {
      cancelComment()
      return
    }
    const key = FILE_COMMENT_ANCHOR
    setComments((prev) => {
      const next = new Map(prev)
      const fileMap = new Map(next.get(file.path) ?? new Map())
      fileMap.set(key, {
        anchor: key,
        header: FILE_COMMENT_HEADER,
        text,
      })
      next.set(file.path, fileMap)
      return next
    })
    setStore("commentEditing", false)
    setStore("cursor", "hunks")
    setStore("commentDraft", "")
  }

  function addSelectionComment() {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text || text.trim().length === 0) return

    const file = selected()
    if (!file) {
      renderer.clearSelection()
      return
    }

    const note = reviewNoteForSelection({
      path: file.path,
      patch: patch(),
      selected: text,
    })
    renderer.clearSelection()
    if (!note) return

    const base = store.commentEditing ? (commentInput?.plainText ?? store.commentDraft) : (currentComment()?.text ?? "")
    const draft = base.trim()
    setStore("commentDraft", draft.includes(note) ? `${draft}\n` : [draft, note].filter(Boolean).join("\n\n"))
    setStore("commentEditing", true)
    setStore("cursor", "comment")
    setStore("pane", "diff")
  }

  function removeComment(path?: string) {
    const key = FILE_COMMENT_ANCHOR
    const file = path ?? selected()?.path
    if (!file) return
    setComments((prev) => {
      const next = new Map(prev)
      const fileMap = new Map(next.get(file) ?? new Map())
      fileMap.delete(key)
      if (fileMap.size === 0) {
        next.delete(file)
      } else {
        next.set(file, fileMap)
      }
      return next
    })
    if (path === selected()?.path && store.commentEditing) cancelComment()
  }

  async function stageFile(input: { file: FileItem; section: Section }) {
    if (store.busy) return
    setStore("busy", true)
    const result = await runGit({
      cwd: cwd(),
      args: fileStageArgs(input.section, input.file.path),
    })
    setStore("busy", false)

    if (result.code !== 0) {
      toast.show({
        variant: "error",
        message: result.stderr.trim() || `Failed to ${input.section === "unstaged" ? "stage" : "unstage"} file`,
      })
      return
    }

    await refresh()
    setStore("token", (value) => value + 1)
    toast.show({
      variant: "success",
      message: input.section === "unstaged" ? "File staged" : "File unstaged",
    })
  }

  function stageSelectedFile() {
    const file = selected()
    if (!file) return
    stageFile({
      file,
      section: store.section,
    })
  }

  async function submitReview() {
    const commentMap = comments()
    if (!hasComments(commentMap)) {
      toast.show({
        variant: "warning",
        message: "Add at least one comment before submitting",
      })
      return
    }

    const selectedModel = local.model.current()
    if (!selectedModel) {
      toast.show({
        variant: "warning",
        message: "Connect a provider to submit review comments",
      })
      return
    }

    const text = formatCommentsForPrompt(commentMap)
    if (!text) return

    const sessionID =
      routeData.sessionID ??
      (await sdk.client.session
        .create({})
        .then((x) => x.data?.id)
        .catch(() => undefined))

    if (!sessionID) {
      toast.show({
        variant: "error",
        message: "Failed to create session for review submission",
      })
      return
    }

    sdk.client.session
      .prompt({
        sessionID,
        messageID: Identifier.ascending("message"),
        agent: local.agent.current().name,
        model: selectedModel,
        variant: local.model.variant.current(),
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text,
          },
        ],
      })
      .then(() => {
        setComments(new Map())
        route.navigate({
          type: "session",
          sessionID,
        })
      })
      .catch(() => {
        toast.show({
          variant: "error",
          message: "Failed to submit review comments",
        })
      })
  }

  useKeyboard((evt) => {
    if (store.busy) return
    const down = evt.name === "j" || evt.name === "down" || (evt.ctrl && evt.name === "j")
    const up = evt.name === "k" || evt.name === "up" || (evt.ctrl && evt.name === "k")

    if (
      !canHandleChangesKeys({
        dialogOpen: dialog.stack.length > 0,
        leader: keybind.leader,
      })
    )
      return

    if (evt.ctrl && evt.name === "return" && !store.commentEditing) {
      evt.preventDefault()
      submitReview()
      return
    }

    if (store.commentEditing) {
      if (evt.name === "escape") {
        evt.preventDefault()
        cancelComment()
      }
      if (evt.name === "return" && !evt.shift) {
        evt.preventDefault()
        saveComment()
      }
      return
    }

    if (isChangesExitKey(evt.name)) {
      evt.preventDefault()
      route.navigate(routeData.sessionID ? { type: "session", sessionID: routeData.sessionID } : { type: "home" })
      return
    }

    if (evt.name === "tab" && hasSidebar()) {
      evt.preventDefault()
      setStore("pane", store.pane === "sidebar" ? "diff" : "sidebar")
      return
    }

    if (evt.name === "space" && store.pane === "sidebar" && selected()) {
      evt.preventDefault()
      stageSelectedFile()
      return
    }

    if (evt.name === "?") {
      evt.preventDefault()
      showHelp()
      return
    }

    if (evt.name === "[") {
      evt.preventDefault()
      setSection("unstaged")
      return
    }

    if (evt.name === "]") {
      evt.preventDefault()
      setSection("staged")
      return
    }

    if (isCommentDeleteKey(evt.name)) {
      evt.preventDefault()
      removeComment(selected()?.path)
      return
    }

    if (store.pane === "diff") {
      const box = scroll()
      if (!box) return

      if (evt.name === "n") {
        evt.preventDefault()
        moveHunk(1)
      }
      if (evt.name === "p") {
        evt.preventDefault()
        moveHunk(-1)
      }
      if (down) {
        evt.preventDefault()
        box.scrollBy(3)
      }
      if (up) {
        evt.preventDefault()
        box.scrollBy(-3)
      }
      if (evt.name === "pageup") {
        evt.preventDefault()
        box.scrollBy(-Math.max(4, Math.floor(box.height * 0.75)))
      }
      if (evt.name === "pagedown") {
        evt.preventDefault()
        box.scrollBy(Math.max(4, Math.floor(box.height * 0.75)))
      }
      if (evt.name === "g" && evt.shift) {
        evt.preventDefault()
        box.scrollTo(box.scrollHeight)
      }
      if (evt.name === "g" && !evt.shift) {
        evt.preventDefault()
        box.scrollTo(0)
      }
      if (evt.name === "h" || evt.name === "left") {
        evt.preventDefault()
        setPane("h")
      }
      if (evt.name === "l" || evt.name === "right") {
        evt.preventDefault()
        setPane("l")
      }
      if (evt.name === "c") {
        evt.preventDefault()
        startComment()
      }
      return
    }

    if (!hasSidebar()) return

    if (store.cursor === "files") {
      if (down) {
        evt.preventDefault()
        moveFile(1)
      }
      if (up) {
        evt.preventDefault()
        moveFile(-1)
      }
      if (evt.name === "c" || evt.name === "e") {
        evt.preventDefault()
        startComment()
      }
      if (evt.name === "h" || evt.name === "left") {
        evt.preventDefault()
        setPane("h")
      }
      if (evt.name === "l" || evt.name === "right") {
        evt.preventDefault()
        setPane("l")
      }
      if (evt.name === "return" && hunks().length > 0) {
        evt.preventDefault()
        setStore("cursor", "hunks")
      }
      return
    }

    if (store.cursor === "hunks") {
      if (down) {
        evt.preventDefault()
        moveHunk(1)
      }
      if (up) {
        evt.preventDefault()
        moveHunk(-1)
      }
      if (evt.name === "h") {
        evt.preventDefault()
        setPane("h")
      }
      if (evt.name === "left") {
        evt.preventDefault()
        setStore("cursor", "files")
      }
      if (evt.name === "l" || evt.name === "right") {
        evt.preventDefault()
        setPane("l")
      }
      if (evt.name === "return") {
        evt.preventDefault()
        setStore("pane", "diff")
      }
      if (evt.name === "c" || evt.name === "e") {
        evt.preventDefault()
        startComment()
      }
    }
  })

  let hydrated = ""
  createEffect(() => {
    if (!kv.ready) return
    const key = storage()
    if (hydrated === key) return
    hydrated = key
    setComments(deserializeComments(kv.get(key, "")))
  })

  createEffect(() => {
    if (!kv.ready || hydrated !== storage()) return
    kv.set(storage(), serializeComments(comments()))
  })

  onMount(() => {
    refresh().then(() => setStore("token", (value) => value + 1))
  })

  let token = 0
  createEffect(() => {
    const file = selected()
    const section = store.section
    const stamp = store.token

    token += 1
    const current = token

    if (!file) {
      setPatch("")
      return
    }

    diffText({ file, section }).then((nextPatch) => {
      if (current !== token) return
      setPatch(nextPatch)
      setStore("hunk", (value) => bound(value, parseHunks(nextPatch).length))
      scroll()?.scrollTo(0)
    })
    stamp
  })

  createEffect(() => {
    const editing = store.commentEditing
    if (!editing) return
    const text = store.commentDraft
    queueMicrotask(() => {
      if (!commentInput || commentInput.isDestroyed) return
      commentInput.setText(text)
      commentInput.gotoBufferEnd()
      commentInput.focus()
    })
  })

  const hasHunks = createMemo(() => hunks().length > 0)
  const commentCount = (file: string) => comments().get(file)?.size ?? 0

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      flexDirection="column"
    >
      <box flexGrow={1} minHeight={shell.mainMinHeight} flexDirection="row">
        <box
          flexGrow={1}
          minHeight={0}
          flexDirection="column"
          border={store.sidebarVisible ? ["right"] : []}
          borderColor={store.pane === "diff" ? theme.primary : theme.border}
        >
          <scrollbox
            ref={setScroll}
            flexGrow={1}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            backgroundColor={theme.diffContextBg}
            onMouseDown={() => setStore("pane", "diff")}
            onMouseUp={(evt: MouseEvent) => {
              evt.stopPropagation()
              addSelectionComment()
            }}
            scrollbarOptions={{ visible: false }}
          >
            <Show when={selected()} fallback={<text fg={theme.textMuted}>No changed files found</text>}>
              <box paddingBottom={1}>
                <text fg={theme.textMuted}>
                  {compactPath(
                    selected()?.path ?? "",
                    Math.max(18, dimensions().width - sidebarWidth() - 8),
                  )}
                </text>
              </box>
              <diff
                id={selected()?.path ?? ""}
                filetype={filetype()}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                view={view()}
                diff={patch()}
                wrapMode={wrapMode()}
                virtualize={true}
                overscan={50}
                fg={theme.text}
                addedBg={theme.diffAddedBg}
                removedBg={theme.diffRemovedBg}
                contextBg={theme.diffContextBg}
                addedSignColor={theme.diffHighlightAdded}
                removedSignColor={theme.diffHighlightRemoved}
                lineNumberFg={theme.diffLineNumber}
                lineNumberBg={theme.diffContextBg}
                addedLineNumberBg={theme.diffAddedLineNumberBg}
                removedLineNumberBg={theme.diffRemovedLineNumberBg}
              />
            </Show>
          </scrollbox>

          <box
            border={["top"]}
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
          >
            <Show when={selected()} fallback={<text fg={theme.textMuted}>Select a file to leave a review comment.</text>}>
              <text fg={theme.textMuted}>
                File review comment · {compactPath(selected()?.path ?? "", Math.max(30, Math.floor(dimensions().width / 2)))}
              </text>
              <Show when={!store.commentEditing}>
                <Show when={currentComment()}>
                  <text fg={theme.text}>{currentComment()?.text}</text>
                  <box flexDirection="row" gap={1}>
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={theme.backgroundElement}
                      onMouseDown={() => startComment()}
                    >
                      <text fg={theme.text}>Edit</text>
                    </box>
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={theme.error}
                      onMouseDown={() => removeComment(selected()?.path)}
                    >
                      <text fg={theme.background}>-</text>
                    </box>
                  </box>
                </Show>
              </Show>
              <Show when={store.commentEditing}>
                <box
                  marginTop={1}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                  backgroundColor={theme.backgroundElement}
                >
                  <textarea
                    ref={(r) => {
                      commentInput = r
                    }}
                    keyBindings={textareaKeybindings()}
                    textColor={theme.text}
                    focusedTextColor={theme.text}
                    cursorColor={theme.primary}
                    minHeight={4}
                    maxHeight={8}
                    onContentChange={() => setStore("commentDraft", commentInput?.plainText ?? "")}
                    focused
                  />
                </box>
                <box flexDirection="row" gap={1}>
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.success}
                    onMouseDown={() => saveComment()}
                  >
                    <text fg={theme.background}>Save</text>
                  </box>
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundElement}
                    onMouseDown={() => cancelComment()}
                  >
                    <text fg={theme.text}>Cancel</text>
                  </box>
                  <text fg={theme.textMuted}>enter save · esc cancel</text>
                </box>
              </Show>
            </Show>
          </box>
        </box>

        <Show when={store.sidebarVisible}>
          <box
            width={sidebarWidth()}
            minHeight={0}
            flexDirection="column"
            border={["left"]}
            borderColor={store.pane === "sidebar" ? theme.primary : theme.border}
          >
            <scrollbox
              flexGrow={1}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={1}
              onMouseDown={() => {
                setStore("pane", "sidebar")
              }}
              scrollbarOptions={{ visible: false }}
            >
              <box gap={1}>
                <text fg={theme.text}>
                  <b>Files</b>
                </text>
                <text fg={theme.textMuted}>space stage/unstage</text>

                <box gap={0}>
                  <text fg={store.section === "unstaged" ? theme.primary : theme.textMuted}>
                    <b>Unstaged</b> ({files.unstaged.length})
                  </text>
                  <For each={files.unstaged}>
                    {(item, index) => (
                      <box
                        flexDirection="row"
                        justifyContent="space-between"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={
                          store.section === "unstaged" && index() === store.file.unstaged
                            ? theme.backgroundElement
                            : undefined
                        }
                        onMouseDown={() => {
                          setSection("unstaged")
                          setStore("file", "unstaged", index())
                          setStore("cursor", "files")
                          setStore("pane", "sidebar")
                        }}
                      >
                        <text fg={theme.text} wrapMode="none" flexShrink={1}>
                          {compactPath(item.path, pathWidth())}
                        </text>
                        <box flexDirection="row" gap={1} flexShrink={0}>
                          <box
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={theme.success}
                            onMouseDown={(evt: MouseEvent) => {
                              evt.stopPropagation()
                              stageFile({
                                file: item,
                                section: "unstaged",
                              })
                            }}
                          >
                            <text fg={theme.background}>+</text>
                          </box>
                          <Show when={commentCount(item.path) > 0}>
                            <box flexDirection="row" gap={1}>
                              <text fg={theme.warning}>●{commentCount(item.path)}</text>
                              <box
                                paddingLeft={1}
                                paddingRight={1}
                                backgroundColor={theme.error}
                                onMouseDown={(evt: MouseEvent) => {
                                  evt.stopPropagation()
                                  removeComment(item.path)
                                }}
                              >
                                <text fg={theme.background}>-</text>
                              </box>
                            </box>
                          </Show>
                          <Show when={item.additions > 0}>
                            <text fg={theme.diffAdded}>+{item.additions}</text>
                          </Show>
                          <Show when={item.deletions > 0}>
                            <text fg={theme.diffRemoved}>-{item.deletions}</text>
                          </Show>
                        </box>
                      </box>
                    )}
                  </For>
                  <Show when={files.unstaged.length === 0}>
                    <text fg={theme.textMuted}>No unstaged files</text>
                  </Show>
                </box>

                <box gap={0}>
                  <text fg={store.section === "staged" ? theme.primary : theme.textMuted}>
                    <b>Staged</b> ({files.staged.length})
                  </text>
                  <For each={files.staged}>
                    {(item, index) => (
                      <box
                        flexDirection="row"
                        justifyContent="space-between"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={
                          store.section === "staged" && index() === store.file.staged
                            ? theme.backgroundElement
                            : undefined
                        }
                        onMouseDown={() => {
                          setSection("staged")
                          setStore("file", "staged", index())
                          setStore("cursor", "files")
                          setStore("pane", "sidebar")
                        }}
                      >
                        <text fg={theme.text} wrapMode="none" flexShrink={1}>
                          {compactPath(item.path, pathWidth())}
                        </text>
                        <box flexDirection="row" gap={1} flexShrink={0}>
                          <box
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={theme.error}
                            onMouseDown={(evt: MouseEvent) => {
                              evt.stopPropagation()
                              stageFile({
                                file: item,
                                section: "staged",
                              })
                            }}
                          >
                            <text fg={theme.background}>-</text>
                          </box>
                          <Show when={commentCount(item.path) > 0}>
                            <box flexDirection="row" gap={1}>
                              <text fg={theme.warning}>●{commentCount(item.path)}</text>
                              <box
                                paddingLeft={1}
                                paddingRight={1}
                                backgroundColor={theme.error}
                                onMouseDown={(evt: MouseEvent) => {
                                  evt.stopPropagation()
                                  removeComment(item.path)
                                }}
                              >
                                <text fg={theme.background}>-</text>
                              </box>
                            </box>
                          </Show>
                          <Show when={item.additions > 0}>
                            <text fg={theme.diffAdded}>+{item.additions}</text>
                          </Show>
                          <Show when={item.deletions > 0}>
                            <text fg={theme.diffRemoved}>-{item.deletions}</text>
                          </Show>
                        </box>
                      </box>
                    )}
                  </For>
                  <Show when={files.staged.length === 0}>
                    <text fg={theme.textMuted}>No staged files</text>
                  </Show>
                </box>

                <box gap={0}>
                  <text fg={theme.text}>
                    <b>Hunks</b> ({hunks().length})
                  </text>
                  <For each={hunks()}>
                    {(hunk, index) => (
                      <box
                        gap={0}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={
                          store.cursor === "hunks" && index() === store.hunk && store.pane === "sidebar"
                            ? theme.backgroundElement
                            : undefined
                        }
                        onMouseDown={() => {
                          setStore("cursor", "hunks")
                          focusHunk(index())
                          setStore("pane", "diff")
                        }}
                      >
                        <box flexDirection="row" justifyContent="space-between" gap={1}>
                          <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
                            {hunk.header}
                          </text>
                        </box>
                      </box>
                    )}
                  </For>
                  <Show when={!hasHunks()}>
                    <text fg={theme.textMuted}>No hunks in selected file</text>
                  </Show>
                </box>
              </box>
            </scrollbox>
          </box>
        </Show>
      </box>

      <box
        flexShrink={shell.statusFlexShrink}
        border={["top"]}
        borderColor={theme.border}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2} flexShrink={1}>
          <For each={ui().actions}>
            {(item) => (
              <text fg={theme.text}>
                {item.key} <span style={{ fg: theme.textMuted }}>{item.label}</span>
              </text>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} alignItems="center" flexShrink={0}>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={ui().submitEnabled ? theme.success : theme.backgroundElement}
            onMouseUp={() => submitReview()}
          >
            <text fg={ui().submitEnabled ? theme.background : theme.text}>{ui().submitLabel}</text>
          </box>
          <box width={SIDEBAR_WIDTH} minWidth={SIDEBAR_WIDTH} flexDirection="row" justifyContent="flex-end">
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.backgroundElement}
              onMouseUp={() => toggleSidebar()}
            >
              <text fg={theme.text}>{ui().sidebarLabel}</text>
            </box>
          </box>
        </box>
      </box>

    </box>
  )
}
