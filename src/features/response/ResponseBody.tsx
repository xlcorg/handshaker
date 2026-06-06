import { BodyView } from "@/features/bodyview/BodyView";

export interface ResponseBodyProps {
  json: string;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView. */
export function ResponseBody({ json }: ResponseBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BodyView mode="response" value={json} />
    </div>
  );
}
