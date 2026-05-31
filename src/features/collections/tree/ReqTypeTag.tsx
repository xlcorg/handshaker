/**
 * Type glyph for a saved request row. Always "g" (gRPC) — HTTP / streaming
 * are out of scope for this pass.
 */
export function ReqTypeTag() {
  return (
    <span
      className="font-mono text-[11px] font-semibold text-stream/70 leading-none"
      title="gRPC unary"
    >
      g
    </span>
  );
}
