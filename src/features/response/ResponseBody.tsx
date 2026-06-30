import { BodyView } from "@/features/bodyview/BodyView";

export interface ResponseBodyProps {
  json: string;
  /** Save the full response body to a file (context-menu action). */
  onSaveBody?: () => void;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView.
 *  Right-click a value to decode base64 or save it, Collapse/Expand all, or save
 *  the whole body to a file. */
export function ResponseBody({ json, onSaveBody }: ResponseBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} onSaveBody={onSaveBody} />
    </div>
  );
}
