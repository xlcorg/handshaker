import { Toaster as Sonner } from "sonner";

/** App toaster: dark theme, neutral colors, short duration.
 *  Mount once at the app root. */
export function Toaster() {
  return <Sonner theme="dark" duration={1500} position={"bottom-center"} />;
}
