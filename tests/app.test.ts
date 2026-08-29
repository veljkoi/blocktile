import { fireEvent, getByRole, queryByRole } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/app";

function seededSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe("Blocktile app", () => {
  afterEach(() => vi.restoreAllMocks());
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
  it("continuously renders visually identifiable Moving Shields and Hazards", () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { nextFrame = callback; return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(Math, "random").mockImplementation(seededSequence(
      0, 0.99, 0,
      0, 0.5, 0,
      0, 0, 0,
    ));
    const root = document.createElement("main");
    const unmount = mountApp(root);
    fireEvent.click(getByRole(root, "button", { name: "Play" }));

    nextFrame?.(1_500);

    const tile = root.querySelector("[data-moving-shield-or-hazard]");
    expect(tile?.getAttribute("data-kind")).toBe("shield");
    expect(tile?.getAttribute("data-direction")).toBe("right");
    expect(tile?.getAttribute("aria-label")).toBe("Moving Shield traveling right in Lane 1");
    expect(tile?.getAttribute("opacity")).toBe("0.78");
    expect(tile?.getAttribute("stroke-width")).toBe(".08");

    nextFrame?.(3_000);
    nextFrame?.(4_500);
    const overlapping = root.querySelectorAll("[data-moving-shield-or-hazard]");
    expect(overlapping[0]?.getAttribute("width")).not.toBe(overlapping[1]?.getAttribute("width"));
    unmount();
  });
});
