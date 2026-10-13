import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HttpTemplateIpc } from "@/ipc/bindings";
import { HttpRequestTabs } from "./HttpRequestTabs";

const template: HttpTemplateIpc = {
  method: "GET",
  url_template: "http://127.0.0.1/echo",
  query: [],
  headers: [],
  body: { kind: "none" },
  auth: { kind: "none" },
};

describe("HttpRequestTabs auth", () => {
  it("says auth is configured on the collection Authorization tab", async () => {
    const user = userEvent.setup();
    render(
      <HttpRequestTabs
        template={template}
        effectiveAuth={{
          kind: "env_var",
          env_var: "HS_BEARER",
          header_name: "authorization",
          prefix: "Bearer ",
          environments: [],
        }}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Auth" }));
    expect(
      screen.getByText(
        "Auth is inherited from the collection (configured on the Authorization tab).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("variable: HS_BEARER")).toBeInTheDocument();
  });
});
