import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SavedAuthEditor } from "./SavedAuthEditor";

describe("SavedAuthEditor", () => {
  it("shows the 'no auth' copy for a none config", () => {
    render(<SavedAuthEditor value={{ kind: "none" }} onChange={() => {}} />);
    expect(screen.getByText(/No authentication/i)).toBeInTheDocument();
  });

  it("selecting Bearer emits an env_var config with authorization/'Bearer '", () => {
    const onChange = vi.fn();
    render(<SavedAuthEditor value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.click(screen.getByText("Bearer"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("editing the Bearer token emits the env var name", () => {
    const onChange = vi.fn();
    render(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer " }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("BEARER_TOKEN_VAR"), { target: { value: "PROD_TOKEN" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "PROD_TOKEN", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("renders header + value for an api-key config", () => {
    render(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("x-api-key")).toBeInTheDocument();
    expect(screen.getByDisplayValue("KEY")).toBeInTheDocument();
  });

  it("shows the unsupported notice for an oauth2 config", () => {
    render(
      <SavedAuthEditor
        value={{
          kind: "oauth_2_client_credentials",
          token_url: "https://t",
          client_id: "id",
          client_secret_env_var: "SECRET",
          scopes: [],
        }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/OAuth2/i)).toBeInTheDocument();
  });
});
