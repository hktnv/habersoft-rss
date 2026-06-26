import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";

afterEach(() => {
  delete window.__RSS_ADMIN_UI_CONFIG__;
});

describe("admin UI foundation shell", () => {
  it("renders the foundation shell and non-deployed status", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Admin UI Foundation" })).toBeInTheDocument();
    expect(screen.getByText("FOUNDATION_ONLY")).toBeInTheDocument();
    expect(screen.getByText("NOT_DEPLOYED")).toBeInTheDocument();
    expect(screen.getByText("OUT_OF_SCOPE")).toBeInTheDocument();
  });

  it("renders runtime API configuration state", () => {
    window.__RSS_ADMIN_UI_CONFIG__ = {
      apiBaseUrl: "http://localhost:3200/",
      environmentName: "local"
    };

    render(<App />);

    expect(screen.getByText("http://localhost:3200")).toBeInTheDocument();
  });
});
