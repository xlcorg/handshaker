import { useEffect, useState } from "react";
import { envList } from "@/ipc/client";
import { useActiveWorkflow } from "@/features/workflow/store";
import { useEnvRevision } from "./envRevision";

/** Variables of the active workflow environment ({} when none / on error).
 *  Re-fetches on env switch or env-revision bump (edits to the active env). */
export function useActiveEnvVars(): Record<string, string> {
  const wf = useActiveWorkflow();
  const envRevision = useEnvRevision();
  const [vars, setVars] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!wf.envName) {
      setVars({});
      return;
    }
    let cancelled = false;
    void envList()
      .then((envs) => {
        if (cancelled) return;
        const env = envs.find((e) => e.name === wf.envName);
        const rec: Record<string, string> = {};
        for (const [k, v] of Object.entries(env?.variables ?? {})) {
          if (v !== undefined) rec[k] = v;
        }
        setVars(rec);
      })
      .catch(() => {
        if (!cancelled) setVars({});
      });
    return () => {
      cancelled = true;
    };
  }, [wf.envName, envRevision]);

  return vars;
}
