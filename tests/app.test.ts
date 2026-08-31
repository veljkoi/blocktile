import { fireEvent, getByRole, queryByRole } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "../src/app";

function seededSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe("Blocktile app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  it("starts a fresh Run with a compact header and no directional controls", () => {
    const root = document.createElement("main");
    mountApp(root);
    expect(queryByRole(root, "grid", { name: "Board" })).toBeNull();

    fireEvent.click(getByRole(root, "button", { name: "Play" }));

    const board = getByRole(root, "grid", { name: "Board" });
    expect(board.querySelectorAll("[data-cell]")).toHaveLength(128);
    expect(board.querySelector("[data-player]")?.getAttribute("aria-label")).toBe("Player at column 4, row 8");
    expect(root.querySelector(".run-header")?.textContent).toBe("BLOCKTILESCORE 0BEST 0");
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
    expect([...overlapping].map((tile) => [
      tile.getAttribute("width"),
      tile.getAttribute("height"),
    ])).toEqual([...overlapping].map(() => ["1", "1"]));
    unmount();
  });

  it("distinguishes Anchored Shields and renders the compression-to-anchor impact", () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { nextFrame = callback; return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(Math, "random").mockImplementation(seededSequence(0, 0.99, 7 / 16));
    const root = document.createElement("main");
    const unmount = mountApp(root);
    fireEvent.click(getByRole(root, "button", { name: "Play" }));

    nextFrame?.(3_000);

    const anchoredShield = root.querySelector("[data-anchored-shield]");
    expect(anchoredShield?.getAttribute("data-kind")).toBe("anchored-shield");
    expect(anchoredShield?.getAttribute("aria-label")).toBe("Anchored Shield at column 3, row 8");
    expect(anchoredShield?.getAttribute("x")).toBe("2");
    expect(anchoredShield?.getAttribute("y")).toBe("7");
    expect(root.querySelector("[data-impact-kind=\"shield-player\"]")).not.toBeNull();
    unmount();
  });

  it("keeps the final Board visible, persists Best, and starts a fresh Run on Play again", () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { nextFrame = callback; return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(Math, "random").mockImplementation(seededSequence(
      0, 0.99, 7 / 16,
      0.99, 0.99, 7 / 16,
      0.99, 0.5, 7 / 16,
    ));
    const root = document.createElement("main");
    const unmount = mountApp(root);
    fireEvent.click(getByRole(root, "button", { name: "Play" }));

    nextFrame?.(1_500);
    nextFrame?.(3_000);
    nextFrame?.(4_000);
    expect(root.querySelector(".score strong")?.textContent).toBe("1");
    expect(root.querySelector("[data-impact-kind=\"hazard-shield\"]")).not.toBeNull();
    nextFrame?.(4_500);
    nextFrame?.(6_500);

    const board = getByRole(root, "grid", { name: "Board" });
    const frozenPlayerPosition = root.querySelector("[data-player]")?.getAttribute("x");
    expect(getByRole(root, "dialog", { name: "Run over" })).not.toBeNull();
    expect(root.querySelector(".board-shell")?.classList.contains("run-ended")).toBe(true);
    expect(root.querySelector("[data-player]")?.classList.contains("player-frozen")).toBe(true);
    expect(root.querySelector("[data-impact-kind=\"hazard-player\"]")).not.toBeNull();
    expect(root.contains(board)).toBe(true);
    expect(localStorage.getItem("blocktile.best-score")).toBe("1");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(root.querySelector("[data-player]")?.getAttribute("x")).toBe(frozenPlayerPosition);

    fireEvent.click(getByRole(root, "button", { name: "Play again" }));

    expect(queryByRole(root, "dialog", { name: "Run over" })).toBeNull();
    expect(root.querySelector(".score strong")?.textContent).toBe("0");
    expect(root.querySelector(".best strong")?.textContent).toBe("1");
    expect(root.querySelectorAll("[data-moving-shield-or-hazard]")).toHaveLength(0);

    unmount();
    const returningRoot = document.createElement("main");
    const unmountReturningApp = mountApp(returningRoot);
    fireEvent.click(getByRole(returningRoot, "button", { name: "Play" }));
    expect(returningRoot.querySelector(".best strong")?.textContent).toBe("1");
    unmountReturningApp();
  });
});
