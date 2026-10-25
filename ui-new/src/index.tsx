import { render } from "solid-js/web";
import "@fontsource/fragment-mono/latin-400.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { initTheme } from "./lib/theme";
import { App } from "./App";

initTheme();

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

render(() => <App />, root);
