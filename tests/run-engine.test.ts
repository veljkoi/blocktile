import { describe, expect, it } from "vitest";

import { createRunEngine } from "../src/run-engine";

function seededSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

describe("run engine", () => {
  it("starts a fresh Run with the Player in column 4 and row 8", () => {
    const engine = createRunEngine();

    expect(engine.getState()).toEqual({
      board: { columns: 8, rows: 16, player: { column: 4, row: 8 }, movingShieldsAndHazards: [] },
      score: 0,
      status: "running",
      moving: false,
      impacts: [],
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
    const engine = createRunEngine({ random: () => 0 });
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

  it.each([
    [0, "up", { column: 1, row: 15 }],
    [0.25, "down", { column: 1, row: 0 }],
    [0.5, "left", { column: 7, row: 1 }],
    [0.99, "right", { column: 0, row: 1 }],
  ] as const)("moves Moving Shields %s at two cells per second", (directionRandom, direction, position) => {
    const engine = createRunEngine({ random: seededSequence(0, directionRandom, 0) });

    engine.advance(1_500);
    expect(engine.getState().board.movingShieldsAndHazards[0]).toMatchObject({
      id: 1, kind: "shield", direction, lane: 1,
    });

    engine.advance(500);
    expect(engine.getState().board.movingShieldsAndHazards[0]).toMatchObject(position);
  });

  it("safely spawns a Hazard from a seeded random source", () => {
    const engine = createRunEngine({ random: seededRandom(123) });

    engine.advance(1_500);

    expect(engine.getState().board.movingShieldsAndHazards).toEqual([
      { id: 1, kind: "hazard", direction: "up", lane: 4, column: 4, row: 16 },
    ]);
  });

  it("uniformly samples a Lane and skips a Hazard with less than 750 milliseconds to react", () => {
    const engine = createRunEngine({ random: seededSequence(0.99, 0.99, 7 / 16) });
    for (let step = 0; step < 3; step += 1) {
      engine.act("left");
      engine.advance(120);
    }

    engine.advance(1_140);

    expect(engine.getState().board.player).toEqual({ column: 1, row: 8 });
    expect(engine.getState().board.movingShieldsAndHazards).toEqual([]);
  });

  it("starts spawn attempts at 1.5 seconds and accelerates after ten seconds", () => {
    let randomCalls = 0;
    const engine = createRunEngine({ random: () => { randomCalls += 1; return 0; } });

    engine.advance(1_499);
    expect(randomCalls).toBe(0);
    engine.advance(1);
    expect(randomCalls).toBe(3);
    engine.advance(8_949);
    expect(randomCalls).toBe(18);
    engine.advance(1);
    expect(randomCalls).toBe(21);
  });

  it("never accelerates spawn attempts beyond one every 0.5 seconds", () => {
    let randomCalls = 0;
    const engine = createRunEngine({ random: () => { randomCalls += 1; return 0; } });
    engine.advance(225_000);
    const callsAtFloor = randomCalls;

    engine.advance(2_000);

    expect(randomCalls - callsAtFloor).toBe(12);
  });

  it("rejects a spawn when its entry is occupied", () => {
    const engine = createRunEngine({ random: () => 0.99 });
    engine.advance(225_000);
    const before = engine.getState().board.movingShieldsAndHazards;
    const latestId = Math.max(...before.map(({ id }) => id));
    expect(before.filter(({ column, row }) => row === 16 && column < 1 && column + 1 > 0)).toHaveLength(1);

    engine.advance(500);

    const nextLatestId = Math.max(...engine.getState().board.movingShieldsAndHazards.map(({ id }) => id));
    expect(nextLatestId).toBe(latestId);
  });

  it("allows same-kind Moving Shields and Hazards to overlap", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 0,
      0, 0.5, 0,
      0, 0, 0,
    ) });

    engine.advance(4_500);

    const [first, second] = engine.getState().board.movingShieldsAndHazards;
    expect(first).toMatchObject({ kind: "shield", lane: 1, column: 5 });
    expect(second).toMatchObject({ kind: "shield", lane: 1, column: 5 });
  });

  it("removes a Moving Shield or Hazard after its trailing edge exits the Board", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 0) });
    engine.advance(1_500);

    engine.advance(4_500);

    expect(engine.getState().board.movingShieldsAndHazards.some(({ id }) => id === 1)).toBe(false);
  });

  it("ends the Run on Hazard–Player contact and freezes the final Board", () => {
    const engine = createRunEngine({ random: seededSequence(0.99, 0.5, 7 / 16) });

    engine.advance(3_500);

    expect(engine.getState()).toMatchObject({
      status: "ended",
      moving: false,
      score: 0,
      board: {
        player: { column: 4, row: 8 },
        movingShieldsAndHazards: expect.arrayContaining([expect.objectContaining({ kind: "hazard", row: 8 })]),
      },
      impacts: [expect.objectContaining({ kind: "hazard-player", x: 4, y: 7.5 })],
    });
    const finalState = engine.getState();
    engine.act("left");
    engine.advance(10_000);
    expect(engine.getState()).toEqual(finalState);
  });

  it("destroys the first Hazard–Shield pair on contact and awards one point", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 0,
      0.99, 0.5, 0,
    ) });

    engine.advance(4_250);

    expect(engine.getState().score).toBe(1);
    expect(engine.getState().board.movingShieldsAndHazards).toEqual([]);
    expect(engine.getState().impacts).toEqual([
      expect.objectContaining({ kind: "hazard-shield", x: 5.5, y: 0.5 }),
    ]);
  });
});
