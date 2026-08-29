import { fireEvent, getByRole, queryByRole } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { mountApp } from "../src/app";

describe("Blocktile app", () => {
  it("starts a fresh Run and renders its Board, Player, score, and controls", () => {
    const root = document.createElement("main");
    mountApp(root);
    expect(queryByRole(root, "grid", { name: "Board" })).toBeNull();

    fireEvent.click(getByRole(root, "button", { name: "Play" }));

    const board = getByRole(root, "grid", { name: "Board" });
    expect(board.querySelectorAll("[data-cell]")).toHaveLength(128);
    expect(board.querySelector("[data-player]")?.getAttribute("aria-label")).toBe("Player at column 4, row 8");
    expect(root.textContent).toContain("Score 0");
    expect(getByRole(root, "button", { name: "Move up" })).toBeTruthy();
  });

  it("moves through labeled directional buttons", () => {
    const root = document.createElement("main");
    mountApp(root);
    fireEvent.click(getByRole(root, "button", { name: "Play" }));
    const player = root.querySelector("[data-player]");
    fireEvent.click(getByRole(root, "button", { name: "Move left" }));
    expect(root.querySelector("[data-player]")).toBe(player);
    expect(player?.getAttribute("aria-label")).toBe("Player at column 3, row 8");
  });
});
