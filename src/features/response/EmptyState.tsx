export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3.5 p-10 text-center relative z-10">
      <div className="h-10 w-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground bg-card">
        {icon}
      </div>
      <div className="text-foreground/85 text-sm font-medium">{title}</div>
      {desc && <div className="text-xs text-muted-foreground max-w-[340px] leading-relaxed">{desc}</div>}
    </div>
  );
}
