import { describe, expect, it } from "vitest";
import { directionFromKey, directionFromSwipe } from "../src/input";

describe("input interpretation", () => {
  it.each([
    ["ArrowUp", "up"], ["w", "up"], ["W", "up"],
    ["ArrowDown", "down"], ["s", "down"],
    ["ArrowLeft", "left"], ["a", "left"],
    ["ArrowRight", "right"], ["d", "right"],
  ] as const)("maps %s to %s", (key, direction) => {
    expect(directionFromKey(key)).toBe(direction);
  });

  it("requires 24 CSS pixels and resolves a swipe by dominant axis", () => {
    expect(directionFromSwipe(0, 0, 23, 0)).toBeNull();
    expect(directionFromSwipe(0, 0, 24, 10)).toBe("right");
    expect(directionFromSwipe(0, 0, -25, 24)).toBe("left");
    expect(directionFromSwipe(0, 0, 24, -25)).toBe("up");
    expect(directionFromSwipe(0, 0, 2, 24)).toBe("down");
  });
});
