import { Input } from "@/components/ui/input";

interface EnvVarFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function EnvVarField({
  label,
  value,
  onChange,
  placeholder = "ENV_VAR_NAME",
}: EnvVarFieldProps) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[11.5px] text-muted-foreground/80">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground/45 pointer-events-none select-none">{"{}"}</span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-7 font-mono text-[12px] tracking-tight"
        />
      </div>
    </label>
  );
}
