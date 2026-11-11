import type { EditorDraftCoordinator } from "../session/editor-draft-coordinator";
import { createEditorDraftOwner } from "../session/editor-draft-coordinator";
import type { EditorSessionVersion } from "../session/editor-session-version";

/** Owns close/handoff protection independently of Popover visibility. */
export const createTechniqueParameterOwner = (drafts: EditorDraftCoordinator) => {
  const owner = createEditorDraftOwner();
  let dirty = false;
  let composing = false;
  let compositionBuffer = false;
  let busy = false;
  let unregister: (() => void) | undefined;
  const blocked = () => composing || compositionBuffer || busy;
  return {
    owner,
    isDirty: () => dirty,
    canHide: () => !blocked(),
    canEdit: () => !busy,
    canHandoff: () => !blocked(),
    setDirty: (value: boolean) => { dirty = value; },
    setBusy: (value: boolean) => { busy = value; },
    compositionStart: () => { composing = true; compositionBuffer = false; },
    compositionEnd: () => { composing = false; compositionBuffer = true; },
    releaseCompositionBuffer: () => { compositionBuffer = false; },
    register(options: {
      targetKey: string;
      inputKey: string;
      version: EditorSessionVersion;
      focus: () => boolean;
      apply: (context: { isCurrent: () => boolean }) => Promise<"applied" | "blocked" | "stale">;
      discard: () => boolean;
    }) {
      unregister?.();
      unregister = drafts.register({
        id: "technique-parameters", kind: "technique", label: "技巧参数",
        // Unapplied technique parameters are transient; only active input/submission blocks navigation.
        ...options, dirty: false, composing: composing || compositionBuffer || busy,
        canApply: !blocked(), error: null,
      }, { owner, generation: owner.generation });
    },
    reset() {
      dirty = false;
      composing = false;
      compositionBuffer = false;
      busy = false;
      drafts.invalidateOwner(owner);
      unregister?.();
      unregister = undefined;
    },
    complete() {
      dirty = false;
      unregister?.();
      unregister = undefined;
    },
    dispose() { drafts.invalidateOwner(owner); unregister?.(); },
  };
};
export type TechniqueParameterOwner = ReturnType<typeof createTechniqueParameterOwner>;
