import { DialogSelect } from "@tui/ui/dialog-select"
import { helpOptions } from "./help-options"

export function ChangesHelp(props: { sidebarKey: string }) {
  return (
    <DialogSelect
      title="Changes Keybindings"
      placeholder="Search keybindings..."
      options={helpOptions({ sidebarKey: props.sidebarKey })}
    />
  )
}
