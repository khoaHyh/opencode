type Focusable = {
  isDestroyed?: boolean
}

export function canRestoreFocus<T extends Focusable>(input: T | null | undefined): input is T {
  if (!input) return false
  return input.isDestroyed !== true
}
