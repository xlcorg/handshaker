import { cn } from "@/lib/cn";

interface COBlockProps {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  danger?: boolean;
}

export function COBlock({ icon, title, desc, action, children, danger }: COBlockProps) {
  return (
    <section>
      <div className="flex items-start gap-3 mb-3.5">
        <span
          className={cn(
            "mt-0.5 flex-none",
            danger ? "text-destructive/80" : "text-muted-foreground/70",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-[13px] font-semibold tracking-tight",
              danger ? "text-destructive" : "text-foreground",
            )}
          >
            {title}
          </h3>
          {desc && (
            <p className="text-[12.5px] text-muted-foreground/70 leading-relaxed mt-0.5 text-pretty">
              {desc}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="pl-[27px]">{children}</div>
    </section>
  );
}
