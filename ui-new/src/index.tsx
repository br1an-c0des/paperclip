import { render } from "solid-js/web";
import "@fontsource/fragment-mono/latin-400.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { initTheme } from "./lib/theme";
import { queryClient } from "./lib/query";
import { startPersistedQueryCache } from "./lib/offline/persisted-cache";
import { App } from "./App";

initTheme();
// The reads saved from the last visit, restored before anything renders (U51; vite.config.ts stamps the build).
startPersistedQueryCache(queryClient, { buildId: import.meta.env.VITE_UI_NEW_BUILD_ID ?? null });

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

render(() => <App />, root);
