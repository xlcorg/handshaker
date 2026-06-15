import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Command, CommandInput, CommandList, CommandItem } from "./command";

describe("ui/command", () => {
  it("keeps non-matching items visible when shouldFilter is false", () => {
    render(
      <Command shouldFilter={false}>
        <CommandInput value="zzz" onValueChange={() => {}} />
        <CommandList>
          <CommandItem value="r0">Alpha</CommandItem>
          <CommandItem value="r1">Beta</CommandItem>
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders an input prefix slot before the text input", () => {
    render(
      <Command shouldFilter={false}>
        <CommandInput value="" onValueChange={() => {}} prefix={<span>chip</span>} />
        <CommandList />
      </Command>,
    );
    expect(screen.getByText("chip")).toBeInTheDocument();
  });
});
