import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@theme/base.css";
import "@theme/night-lights.css";
import "./styles.css";
import "./stage.css";
import "./phone.css";
import App from "./App";
import { scrollToHashWhenReady } from "./scrollToHash";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Shared links to a section (#highways, #leaders, …) land on it once it has rendered.
scrollToHashWhenReady();
