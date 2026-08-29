import { fireEvent, getByRole, queryByRole } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { mountApp } from "../src/app";

describe("Blocktile app", () => {
  it("starts a fresh Run with a compact header and no directional controls", () => {
    const root = document.createElement("main");
    mountApp(root);
    expect(queryByRole(root, "grid", { name: "Board" })).toBeNull();

    fireEvent.click(getByRole(root, "button", { name: "Play" }));

    const board = getByRole(root, "grid", { name: "Board" });
    expect(board.querySelectorAll("[data-cell]")).toHaveLength(128);
    expect(board.querySelector("[data-player]")?.getAttribute("aria-label")).toBe("Player at column 4, row 8");
    expect(root.querySelector(".run-header")?.textContent).toBe("BLOCKTILESCORE 0");
    expect(queryByRole(root, "button")).toBeNull();
    expect(root.querySelector(".hint")).toBeNull();
  });

  it("retains keyboard movement", () => {
    const root = document.createElement("main");
    mountApp(root);
    fireEvent.click(getByRole(root, "button", { name: "Play" }));
    const player = root.querySelector("[data-player]");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(root.querySelector("[data-player]")).toBe(player);
    expect(player?.getAttribute("aria-label")).toBe("Player at column 3, row 8");
  });

  it("retains swipe movement", () => {
    const root = document.createElement("main");
    mountApp(root);
    fireEvent.click(getByRole(root, "button", { name: "Play" }));
    const board = getByRole(root, "grid", { name: "Board" });
    fireEvent.pointerDown(board, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(board, { clientX: 50, clientY: 80 });
    expect(root.querySelector("[data-player]")?.getAttribute("aria-label")).toBe("Player at column 4, row 9");
  });
});
