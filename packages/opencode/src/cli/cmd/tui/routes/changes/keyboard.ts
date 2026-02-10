export function canHandleChangesKeys(input: { dialogOpen: boolean; leader: boolean }) {
  if (input.dialogOpen) return false
  if (input.leader) return false
  return true
}

export function isChangesExitKey(name: string) {
  if (name === "escape") return true
  if (name === "q") return true
  return false
}

export function isCommentDeleteKey(name: string) {
  if (name === "x") return true
  if (name === "delete") return true
  return false
}
