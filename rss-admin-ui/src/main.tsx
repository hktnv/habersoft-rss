import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./shared/ErrorBoundary";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("rss-admin-ui root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
