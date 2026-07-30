import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("画面要素が見つかりません: root");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
