import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc, type AppVersion } from "@/ipc/client";

export default function App() {
  const [version, setVersion] = useState<AppVersion | null>(null);

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch((e) => {
      console.error("app_version failed", e);
    });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <Zap className="size-12 text-muted-foreground" />
        <h1 className="text-2xl font-medium">Connect to a gRPC service</h1>
        <p className="text-sm text-muted-foreground">
          {version ? `Handshaker v${version.version}` : "Handshaker"}
        </p>
        <Button disabled size="lg">
          Connect to address
        </Button>
      </div>
    </main>
  );
}
