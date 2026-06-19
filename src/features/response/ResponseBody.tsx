import { forwardRef } from "react";
import { BodyView, type BodyViewHandle } from "@/features/bodyview/BodyView";

export interface ResponseBodyProps {
  json: string;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView.
 *  Right-click a value to decode base64 (copies the decoded text) or save it.
 *  Forwards a `{ collapseAll, expandAll }` handle so the ResponsePanel header
 *  buttons can fold/unfold the body. */
export const ResponseBody = forwardRef<BodyViewHandle, ResponseBodyProps>(function ResponseBody(
  { json },
  ref,
) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView ref={ref} mode="response" value={json} />
    </div>
  );
});
