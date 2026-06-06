import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnvSwitcherMenu } from "./EnvSwitcherMenu";

function setup(activeEnv: string | null = null) {
  const onActiveSet = vi.fn();
  const onNewEnv = vi.fn();
  render(
    <EnvSwitcherMenu
      envs={[
        { name: "local", variables: {} },
        { name: "prod", variables: {} },
      ]}
      activeEnv={activeEnv}
      trigger={<button type="button">env-trigger</button>}
      onActiveSet={onActiveSet}
      onEditEnv={() => {}}
      onDeleteEnv={() => {}}
      onNewEnv={onNewEnv}
    />,
  );
  return { onActiveSet, onNewEnv };
}

describe("EnvSwitcherMenu", () => {
  it("selecting an env row calls onActiveSet with its name (plain items, no radio)", async () => {
    const user = userEvent.setup();
    const { onActiveSet } = setup();
    await user.click(screen.getByText("env-trigger"));
    // No radio-style items anymore.
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    await user.click(await screen.findByText("local"));
    expect(onActiveSet).toHaveBeenCalledWith("local");
  });

  it("'No environment' calls onActiveSet(null) and the header is present", async () => {
    const user = userEvent.setup();
    const { onActiveSet } = setup("local");
    await user.click(screen.getByText("env-trigger"));
    expect(await screen.findByText("Environments")).toBeInTheDocument();
    await user.click(screen.getByText("No environment"));
    expect(onActiveSet).toHaveBeenCalledWith(null);
  });
});
