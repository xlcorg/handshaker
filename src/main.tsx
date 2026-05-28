import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@/styles/globals.css";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readPrefs } from "@/lib/use-prefs";
// Side-effect import: kicks off Monaco chunk download in parallel with React
// boot, so by the time the user picks a method the editor mounts instantly
// instead of flashing a Suspense fallback.
import "@/lib/monaco";

const initial = readPrefs();
document.documentElement.classList.toggle("dark", initial.theme === "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={150} skipDelayDuration={400}>
      <App />
    </TooltipProvider>
  </StrictMode>
);
