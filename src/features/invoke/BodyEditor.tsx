import { BodyView } from "@/features/bodyview/BodyView";
import type { MessageSchemaIpc } from "@/ipc/bindings";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor → send (Monaco swallows the window shortcut). */
  onSubmit?: () => void;
  /** Flat field-schema for the current method; drives autocomplete (null disables it). */
  schema?: MessageSchemaIpc | null;
}

/** Request-body editor: editable Monaco (raw text) via the shared BodyView. */
export function BodyEditor({ value, onChange, onSubmit, schema }: BodyEditorProps) {
  return <BodyView mode="request" value={value} onChange={onChange} onSubmit={onSubmit} schema={schema} />;
}
