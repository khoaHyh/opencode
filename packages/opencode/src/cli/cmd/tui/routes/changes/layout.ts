export function statusline<T extends { hasComments: boolean }>(input: T) {
  return {
    actions: [
      { key: "?", label: "help" },
      { key: "space", label: "stage" },
      { key: "c", label: "comment" },
      { key: "q", label: "quit" },
    ],
    sidebarLabel: "Toggle Sidebar",
    submitLabel: "Submit Review",
    submitEnabled: input.hasComments,
  }
}

export function sidebarColumnWidth(input: { sidebarVisible: boolean; expanded: number }) {
  if (input.sidebarVisible) return input.expanded
  return 0
}

export function paneForKey(input: {
  key: "h" | "l"
  sidebarVisible: boolean
}) {
  if (!input.sidebarVisible) return "diff"
  if (input.key === "h") return "diff"
  return "sidebar"
}

export function frame() {
  return {
    mainMinHeight: 0,
    statusFlexShrink: 0,
  }
}
