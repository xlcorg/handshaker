export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "error";

export interface UpdateBannerProps {
  phase: UpdatePhase;
  version: string;
  progress: number;
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Presentational Postman-style "update available" banner. Renders nothing unless
 *  an update is available or installing. Logic lives in useUpdateCheck. */
export function UpdateBanner({ phase, version, progress, onUpdate, onDismiss }: UpdateBannerProps) {
  if (phase !== "available" && phase !== "downloading") return null;
  const downloading = phase === "downloading";
  return (
    <div className="m-3 flex-none flex items-center justify-between gap-3 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs">
      <div className="text-foreground">
        {downloading ? (
          <span>Downloading update {version}… {progress}%</span>
        ) : (
          <span>A new version ({version}) is available.</span>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={onUpdate}
          disabled={downloading}
          className="h-7 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
        >
          {downloading ? "Updating…" : "Update now"}
        </button>
        {!downloading && (
          <button
            type="button"
            onClick={onDismiss}
            className="h-7 rounded-md px-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Later
          </button>
        )}
      </div>
    </div>
  );
}
