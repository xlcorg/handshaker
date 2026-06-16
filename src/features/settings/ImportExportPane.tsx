import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { exportBundle } from "@/features/catalog/transfer";
import { useImportFlow } from "@/features/catalog/useImportFlow";
import { ImportSummaryDialog } from "@/features/catalog/ImportSummaryDialog";

export function ImportExportPane() {
  const importFlow = useImportFlow();
  return (
    <SettingsGroup title="Import / Export">
      <SettingsRow
        title="Export"
        hint="Save all collections and environments to a JSON file."
        control={
          <Button
            variant="outline"
            size="xs"
            onClick={() => void exportBundle(null, "handshaker-export.json")}
          >
            <Download />
            Export
          </Button>
        }
      />
      <SettingsRow
        title="Import"
        hint="Merge collections and environments from a file — nothing is deleted."
        control={
          <Button variant="outline" size="xs" onClick={() => void importFlow.start()}>
            <Upload />
            Import
          </Button>
        }
      />
      <ImportSummaryDialog
        open={importFlow.pending !== null}
        summary={importFlow.pending?.summary ?? null}
        onConfirm={() => void importFlow.confirm()}
        onCancel={importFlow.cancel}
      />
    </SettingsGroup>
  );
}
