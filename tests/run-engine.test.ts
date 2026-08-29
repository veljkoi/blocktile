import { describe, expect, it } from "vitest";

import { createRunEngine } from "../src/run-engine";

describe("run engine", () => {
  it("starts a fresh Run with the Player in column 4 and row 8", () => {
    const engine = createRunEngine();

    expect(engine.getState()).toEqual({
      board: { columns: 8, rows: 16, player: { column: 4, row: 8 } },
      score: 0,
      status: "running",
      moving: false,
    });
  });

  it.each([
    ["up", { column: 4, row: 7 }],
    ["down", { column: 4, row: 9 }],
    ["left", { column: 3, row: 8 }],
    ["right", { column: 5, row: 8 }],
  ] as const)("moves the Player one cell %s", (direction, player) => {
    const engine = createRunEngine();

    engine.act(direction);

    expect(engine.getState().board.player).toEqual(player);
    expect(engine.getState().moving).toBe(true);
  });

  it("never moves the Player beyond the Board", () => {
    const engine = createRunEngine();
    for (let step = 0; step < 20; step += 1) {
      engine.act("left"); engine.advance(120);
      engine.act("up"); engine.advance(120);
    }
    expect(engine.getState().board.player).toEqual({ column: 1, row: 1 });
    for (let step = 0; step < 20; step += 1) {
      engine.act("right"); engine.advance(120);
      engine.act("down"); engine.advance(120);
    }
    expect(engine.getState().board.player).toEqual({ column: 8, row: 16 });
  });

  it("buffers at most one command during the 120 millisecond movement", () => {
    const engine = createRunEngine();
    engine.act("right");
    engine.act("down");
    engine.act("left");
    expect(engine.getState().board.player).toEqual({ column: 5, row: 8 });
    engine.advance(120);
    expect(engine.getState().board.player).toEqual({ column: 5, row: 9 });
    expect(engine.getState().moving).toBe(true);
    engine.advance(120);
    expect(engine.getState().moving).toBe(false);
  });
});
