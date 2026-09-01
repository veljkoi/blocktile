import type { Direction } from "./run-engine";

const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  arrowup: "up", w: "up",
  arrowdown: "down", s: "down",
  arrowleft: "left", a: "left",
  arrowright: "right", d: "right",
};

export function directionFromKey(key: string): Direction | null {
  return KEY_DIRECTIONS[key.toLowerCase()] ?? null;
}

export function directionFromSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): Direction | null {
  const horizontal = endX - startX;
  const vertical = endY - startY;
  if (Math.max(Math.abs(horizontal), Math.abs(vertical)) < 6) return null;
  if (Math.abs(horizontal) >= Math.abs(vertical)) return horizontal < 0 ? "left" : "right";
  return vertical < 0 ? "up" : "down";
}
