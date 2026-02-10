import type { DialogSelectOption } from "@tui/ui/dialog-select"

type Item = {
  key: string
  action: string
  category: string
}

const ITEMS: Item[] = [
  { key: "j/k or ↑/↓", action: "Move selection across unstaged/staged files", category: "Navigation" },
  { key: "ctrl+j / ctrl+k", action: "Neovim-style down/up movement", category: "Navigation" },
  { key: "h / ←", action: "Focus diff pane", category: "Navigation" },
  { key: "l / →", action: "Focus sidebar pane", category: "Navigation" },
  { key: "tab", action: "Switch sidebar/diff pane", category: "Navigation" },
  { key: "space", action: "Stage/unstage selected file (sidebar)", category: "Staging" },
  { key: "[ / ]", action: "Jump to unstaged / staged section", category: "Staging" },
  { key: "n / p", action: "Next / previous hunk in diff", category: "Diff" },
  { key: "c", action: "Add or edit review comment for selected file", category: "Comments" },
  { key: "x / del", action: "Remove file review comment", category: "Comments" },
  { key: "ctrl+enter", action: "Submit review comments", category: "Review" },
  { key: "esc / q", action: "Exit /changes", category: "General" },
]

export function helpOptions(input: { sidebarKey: string }) {
  const toggle =
    input.sidebarKey.length > 0
      ? [
          {
            title: input.sidebarKey,
            description: "Show/hide sidebar",
            value: `toggle:${input.sidebarKey}`,
            category: "General",
          },
        ]
      : []

  return [
    ...toggle,
    ...ITEMS.map((item) => ({
      title: item.key,
      description: item.action,
      value: `${item.category}:${item.key}`,
      category: item.category,
    })),
  ] satisfies DialogSelectOption<string>[]
}
