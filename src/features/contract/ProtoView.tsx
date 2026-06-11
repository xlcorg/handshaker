import { useRef } from "react";
import { cn } from "@/lib/cn";
import type { ProtoDoc, ProtoToken } from "./proto";

const TOKEN_CLASS: Record<ProtoToken["kind"], string> = {
  keyword: "hs-proto-kw",
  scalar: "hs-proto-scalar",
  typeRef: "hs-proto-ref",
  name: "hs-proto-name",
  punct: "hs-proto-punct",
};

/** Read-only proto-source listing. Type references are buttons: click scrolls
 *  the target block into view and flashes it. */
export function ProtoView({ doc }: { doc: ProtoDoc }) {
  const rootRef = useRef<HTMLDivElement>(null);

  const jump = (target: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-block="${CSS.escape(target)}"]`);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    // Restart the flash when re-clicking the same target: remove → reflow → add.
    // NB: manual classList works only while the block's className prop stays static;
    // if it ever becomes conditional, React re-renders would wipe the flash class.
    el.classList.remove("hs-proto-flash");
    void el.offsetWidth;
    el.classList.add("hs-proto-flash");
  };

  return (
    <div ref={rootRef} className="px-3.5 py-2 font-mono text-xs leading-6">
      {doc.blocks.map((b) => (
        <div key={b.fullName} data-block={b.fullName} className="mb-3 last:mb-0">
          {b.lines.map((line, i) => (
            <div key={i} className="whitespace-pre">
              {line.map((t, j) =>
                t.kind === "typeRef" ? (
                  <button
                    key={j}
                    type="button"
                    title={t.tooltip}
                    onClick={() => jump(t.target)}
                    className={cn(TOKEN_CLASS[t.kind], "hover:underline")}
                  >
                    {t.text}
                  </button>
                ) : (
                  <span
                    key={j}
                    title={t.kind === "name" ? t.tooltip : undefined}
                    className={TOKEN_CLASS[t.kind]}
                  >
                    {t.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
