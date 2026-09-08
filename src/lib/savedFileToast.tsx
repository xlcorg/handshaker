import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { messages } from "./messages";

const m = messages.response.save;

/** Shared by full-response and encoded/decoded value saves. */
export function savedFileToast(path: string): void {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = path.slice(separator + 1);
  const directory = path.slice(0, separator + 1);
  const run = async (action: () => Promise<void>, failure: string) => {
    try {
      await action();
    } catch {
      toast.error(failure);
    }
  };

  toast.success(m.saved, {
    duration: 8000,
    action: {
      label: m.showInFolder,
      onClick: () => void run(() => revealItemInDir(path), m.revealFailed),
    },
    description: (
      <>
        <button
          type="button"
          className="text-left underline-offset-4 hover:underline"
          title={m.openFile}
          aria-label={m.openNamedFile(name)}
          onClick={() => void run(() => openPath(path), m.openFailed)}
        >
          {name}
        </button>
        <div>{directory}</div>
      </>
    ),
  });
}
