import { Toaster as Sonner } from "sonner";
import { usePrefs } from "@/lib/use-prefs";

/** App toaster: Sonner following the app theme, neutral colors, short duration.
 *  Mount once at the app root. */
export function Toaster() {
  const [prefs] = usePrefs();
  return <Sonner theme={prefs.theme} duration={1500} position={"bottom-center"} />;
}
