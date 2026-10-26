import type { IssueStatus } from "@paperclipai/shared";
import { createContext, createSignal, useContext, type ParentProps } from "solid-js";

/*
 * The shell's global actions, after ui/src/context/DialogContext.tsx: any page, the nav, the command
 * palette and the keyboard shortcuts open the same new-task dialog, palette and cheatsheet through
 * here, and anything that shows a run opens it in the run modal with `openRunModal(runId)`. The
 * dialogs themselves are mounted once, in CompanyLayout.
 */

/** What a new task starts with when it's opened from somewhere specific, such as a project. */
export type NewTaskDefaults = {
  projectId?: string | null;
  parentId?: string | null;
  assigneeAgentId?: string | null;
  /** The status of the group it was added from, on the task list. */
  status?: IssueStatus;
  /** A title typed into the list's quick add before "More options". */
  title?: string;
};

type CommandsValue = {
  newTask: () => NewTaskDefaults | null;
  openNewTask: (defaults?: NewTaskDefaults) => void;
  closeNewTask: () => void;
  paletteOpen: () => boolean;
  setPaletteOpen: (open: boolean) => void;
  shortcutsOpen: () => boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** The run shown in the run modal (boards 16–18), or null. */
  runModal: () => string | null;
  openRunModal: (runId: string) => void;
  closeRunModal: () => void;
};

const CommandsContext = createContext<CommandsValue>();

export function CommandsProvider(props: ParentProps) {
  const [newTask, setNewTask] = createSignal<NewTaskDefaults | null>(null);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  const [runModal, setRunModal] = createSignal<string | null>(null);
  const value: CommandsValue = {
    newTask,
    openNewTask: (defaults = {}) => {
      setPaletteOpen(false);
      setNewTask(defaults);
    },
    closeNewTask: () => setNewTask(null),
    paletteOpen,
    setPaletteOpen,
    shortcutsOpen,
    setShortcutsOpen,
    runModal,
    openRunModal: (runId) => {
      setPaletteOpen(false);
      setRunModal(runId);
    },
    closeRunModal: () => setRunModal(null),
  };
  return <CommandsContext.Provider value={value}>{props.children}</CommandsContext.Provider>;
}

export function useCommands() {
  const context = useContext(CommandsContext);
  if (!context) throw new Error("useCommands must be used inside <CommandsProvider>");
  return context;
}
