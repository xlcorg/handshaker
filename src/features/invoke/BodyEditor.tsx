import { BodyView } from "@/features/bodyview/BodyView";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor → send (Monaco swallows the window shortcut). */
  onSubmit?: () => void;
}

/** Request-body editor: editable Monaco (raw text) via the shared BodyView. */
export function BodyEditor({ value, onChange, onSubmit }: BodyEditorProps) {
  return <BodyView mode="request" value={value} onChange={onChange} onSubmit={onSubmit} />;
}
