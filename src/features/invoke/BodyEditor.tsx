import { BodyView } from "@/features/bodyview/BodyView";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/** Request-body editor: editable Monaco (raw text) via the shared BodyView. */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return <BodyView mode="request" value={value} onChange={onChange} />;
}
