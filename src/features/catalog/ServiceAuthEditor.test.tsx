import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceAuthEditor } from "./ServiceAuthEditor";

describe("ServiceAuthEditor", () => {
  it("switching kind to env_var emits an env_var config with empty fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ServiceAuthEditor value={{ kind: "none" }} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("auth-kind"), "env_var");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("editing the env var name emits an updated config", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ServiceAuthEditor
        value={{ kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer " }}
        onChange={onChange}
      />,
    );
    await user.type(screen.getByLabelText("auth-env-var"), "T");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ",
    });
  });
});
