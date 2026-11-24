import type { EditorDraftRegistration } from "../session/editor-draft-coordinator";
import {
  sameEditorVersion,
  type EditorSessionVersion,
} from "../session/editor-session-version";

export interface ChordEditContext {
  identity: EditorDraftRegistration;
  version: EditorSessionVersion;
  targetKey: string;
  parentValue: string;
}

/** Modal token 不拥有父草稿；只证明返回值仍属于捕获时的原输入。 */
export const createChordEditSession = (
  initialRead: () => ChordEditContext | null = () => null,
) => {
  let read = initialRead;
  let sequence = 0;
  let active: { id: number; context: ChordEditContext } | null = null;
  const isCurrent = (id: number) => {
    const now = read(),
      entry = active;
    return (
      !!entry &&
      entry.id === id &&
      !!now &&
      entry.context.identity.owner === now.identity.owner &&
      entry.context.identity.generation === now.identity.owner.generation &&
      entry.context.identity.generation === now.identity.generation &&
      sameEditorVersion(entry.context.version, now.version) &&
      entry.context.targetKey === now.targetKey &&
      entry.context.parentValue === now.parentValue
    );
  };
  return {
    setReader(reader: () => ChordEditContext | null) {
      read = reader;
    },
    open() {
      const context = read();
      if (!context || active) return null;
      active = { id: ++sequence, context };
      return active.id;
    },
    isCurrent,
    complete(id: number, write: () => void) {
      if (!isCurrent(id)) {
        if (active?.id === id) active = null;
        return false;
      }
      active = null;
      write();
      return true;
    },
    cancel(id: number) {
      if (active?.id === id) active = null;
    },
  };
};
