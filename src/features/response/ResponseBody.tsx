import { useState } from "react";
import { BodyView } from "@/features/bodyview/BodyView";
import { DecodeDialog } from "./DecodeDialog";

export interface ResponseBodyProps {
  json: string;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView,
 *  plus a base64 decode dialog driven by the body's context menu. */
export function ResponseBody({ json }: ResponseBodyProps) {
  const [decodeValue, setDecodeValue] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} onDecode={setDecodeValue} />
      <DecodeDialog value={decodeValue} onClose={() => setDecodeValue(null)} />
    </div>
  );
}
