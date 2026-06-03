import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catalogStore } from "./store";

export function AddServiceForm({ onAdded }: { onAdded?: () => void }) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [tls, setTls] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const addr = address.trim();
    if (!addr) return;
    catalogStore.addService({ address: addr, label: label.trim() || undefined, tls, thirdParty });
    setAddress("");
    setLabel("");
    setTls(false);
    setThirdParty(false);
    onAdded?.();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-3">
      <Input
        placeholder="host:port"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        className="h-8 font-mono text-xs"
        aria-label="service-address"
      />
      <Input
        placeholder="имя (необязательно)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-8 text-xs"
        aria-label="service-label"
      />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <label className="flex select-none items-center gap-1.5">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} /> TLS
        </label>
        <label className="flex select-none items-center gap-1.5">
          <input
            type="checkbox"
            checked={thirdParty}
            onChange={(e) => setThirdParty(e.target.checked)}
          />{" "}
          сторонний
        </label>
        <div className="flex-1" />
        <Button type="submit" size="sm" disabled={!address.trim()}>
          Добавить
        </Button>
      </div>
    </form>
  );
}
