import { BodyView } from "@/features/bodyview/BodyView";
import type { MessageSchemaIpc } from "@/ipc/bindings";

export interface ResponseBodyProps {
  json: string;
  /** Output-message schema → inlay type hints on the rendered response. */
  schema?: MessageSchemaIpc | null;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView. */
export function ResponseBody({ json, schema }: ResponseBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} schema={schema} />
    </div>
  );
}
