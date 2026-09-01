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
      board: { columns: 8, rows: 16, player: { column: 4, row: 8 }, movingShieldsAndHazards: [], anchoredShields: [] },
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

  it("buffers at most one command during the 10 millisecond movement", () => {
    const engine = createRunEngine();
    engine.act("right");
    engine.act("down");
    engine.act("left");
    expect(engine.getState().board.player).toEqual({ column: 5, row: 8 });
    engine.advance(10);
    expect(engine.getState().board.player).toEqual({ column: 5, row: 9 });
    expect(engine.getState().moving).toBe(true);
    engine.advance(10);
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

  it("allows a Hazard with no reaction time to spawn at the Player entry", () => {
    const engine = createRunEngine({ random: seededSequence(0.99, 0.99, 7 / 16) });
    for (let step = 0; step < 3; step += 1) {
      engine.act("left");
      engine.advance(120);
    }

    engine.advance(1_140);

    expect(engine.getState()).toMatchObject({
      status: "ended",
      score: 0,
      board: {
        player: { column: 1, row: 8 },
        movingShieldsAndHazards: [expect.objectContaining({ kind: "hazard", direction: "right", lane: 8 })],
      },
      impacts: [expect.objectContaining({ kind: "hazard-player" })],
    });
  });

  it("skips a Shield spawn at a Player-occupied entry", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 7 / 16) });
    for (let step = 0; step < 3; step += 1) {
      engine.act("left");
      engine.advance(120);
    }

    engine.advance(1_140);

    expect(engine.getState()).toMatchObject({
      status: "running",
      board: {
        player: { column: 1, row: 8 },
        movingShieldsAndHazards: [],
      },
    });
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

  it("raises Hazard probability by one percentage point every twenty seconds", () => {
    let randomCall = 0;
    const engine = createRunEngine({
      random: () => [0.495, 0.99, 0.99][randomCall++ % 3] ?? 0,
    });
    const hazardPressure = () => (
      engine.getState().score
      + engine.getState().board.movingShieldsAndHazards.filter(({ kind }) => kind === "hazard").length
    );

    engine.advance(19_999);
    expect(hazardPressure()).toBe(0);

    engine.advance(2_001);
    expect(hazardPressure()).toBeGreaterThan(0);
  });

  it("caps Hazard probability at ninety percent", () => {
    let randomCall = 0;
    const engine = createRunEngine({
      random: () => [0.105, 0.99, 0.99][randomCall++ % 3] ?? 0,
    });
    const hazardPressure = () => (
      engine.getState().score
      + engine.getState().board.movingShieldsAndHazards.filter(({ kind }) => kind === "hazard").length
    );

    engine.advance(799_999);
    expect(hazardPressure()).toBe(0);

    engine.advance(1_001);
    expect(hazardPressure()).toBeGreaterThan(0);
  });

  it("allows a Hazard to spawn when its entry is occupied by another Hazard", () => {
    const engine = createRunEngine({ random: () => 0.99 });
    engine.advance(225_000);
    const latestId = Math.max(...engine.getState().board.movingShieldsAndHazards.map(({ id }) => id));

    engine.advance(500);

    const nextLatestId = Math.max(...engine.getState().board.movingShieldsAndHazards.map(({ id }) => id));
    expect(nextLatestId).toBe(latestId + 1);
  });

  it("skips a Shield when its entry is occupied by another Shield", () => {
    let randomCall = 0;
    const engine = createRunEngine({
      random: () => [0, 0.99, 0.99][randomCall++ % 3] ?? 0,
    });
    engine.advance(225_000);
    const latestId = Math.max(...engine.getState().board.movingShieldsAndHazards.map(({ id }) => id));

    engine.advance(500);

    const nextLatestId = Math.max(...engine.getState().board.movingShieldsAndHazards.map(({ id }) => id));
    expect(nextLatestId).toBe(latestId);
  });

  it("scores immediately when a Hazard spawns at a Shield-occupied entry", () => {
    let kindRandom = 0;
    let randomCall = 0;
    const engine = createRunEngine({
      random: () => {
        const draw = randomCall++ % 3;
        if (draw === 0) return kindRandom;
        return 0.99;
      },
    });
    engine.advance(225_000);
    kindRandom = 0.99;

    engine.advance(500);

    expect(engine.getState()).toMatchObject({ score: 1, status: "running" });
  });

  it("scores immediately when a Shield spawns at a Hazard-occupied entry", () => {
    let kindRandom = 0.99;
    let randomCall = 0;
    const engine = createRunEngine({
      random: () => {
        const draw = randomCall++ % 3;
        if (draw === 0) return kindRandom;
        return 0.99;
      },
    });
    engine.advance(225_000);
    kindRandom = 0;

    engine.advance(500);

    expect(engine.getState()).toMatchObject({ score: 1, status: "running" });
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

  it("resolves Hazard–Shield before Hazard–Player at the same collision time", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.25, 3 / 8,
      0.99, 0.99, 7 / 16,
      0, 0.99, 15 / 16,
    ) });
    engine.act("right");
    engine.advance(120);
    engine.advance(4_880);

    expect(engine.getState()).toMatchObject({
      score: 1,
      status: "running",
      board: { player: { column: 5, row: 8 } },
      impacts: [expect.objectContaining({ kind: "hazard-shield" })],
    });
  });

  it("resolves Hazard–Player before Shield–Player at the same collision time", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0.99, 0.5, 7 / 16,
    ) });
    engine.act("right"); engine.advance(120);
    engine.act("right"); engine.advance(120);
    engine.advance(3_760);

    expect(engine.getState()).toMatchObject({
      score: 0,
      status: "ended",
      board: {
        player: { column: 6, row: 8 },
        anchoredShields: [],
      },
      impacts: [expect.objectContaining({ kind: "hazard-player" })],
    });
  });

  it("resolves Shield–Player before Shield–Shield at the same collision time", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.25, 2 / 8,
      0, 0.5, 7 / 16,
      0, 0.99, 15 / 16,
    ) });

    engine.advance(6_500);

    expect(engine.getState().board.anchoredShields.map(({ id }) => id)).toEqual([1, 3, 2]);
    expect(engine.getState().impacts).toEqual([
      expect.objectContaining({ kind: "shield-player" }),
    ]);
  });

  it("uses earliest collision time within the same contact priority", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.25, 0,
      0, 0.25, 1 / 8,
      0.99, 0, 0,
      0.99, 0, 1 / 8,
    ) });
    engine.advance(6_000);

    engine.advance(2_500);

    expect(engine.getState().score).toBe(2);
    expect(engine.getState().impacts).toEqual([
      expect.objectContaining({ kind: "hazard-shield", x: 1.5 }),
    ]);
  });

  it("scores each separate Hazard–Shield pair and uses stable creation order when time ties", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.25, 0,
      0, 0.25, 1 / 8,
      0.99, 0, 1 / 8,
      0.99, 0, 0,
    ) });
    engine.advance(6_000);

    engine.advance(1_750);

    expect(engine.getState().score).toBe(2);
    expect(engine.getState().impacts.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "hazard-shield", x: 0.5 }),
      expect.objectContaining({ kind: "hazard-shield", x: 1.5 }),
    ]);
  });

  it("does not collide tiles passing in adjacent horizontal Lanes", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 0,
      0.99, 0.5, 1 / 16,
      0, 0.99, 0.99,
    ) });

    engine.advance(4_751);

    expect(engine.getState().score).toBe(0);
    expect(engine.getState().board.movingShieldsAndHazards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "shield", direction: "right", lane: 1 }),
      expect.objectContaining({ id: 2, kind: "hazard", direction: "left", lane: 2 }),
    ]));
  });

  it("does not collide tiles passing in adjacent vertical Lanes", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.25, 0,
      0.99, 0, 1 / 8,
      0, 0.25, 0.99,
      0, 0.25, 0.99,
    ) });

    engine.advance(6_751);

    expect(engine.getState().score).toBe(0);
    expect(engine.getState().board.movingShieldsAndHazards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "shield", direction: "down", lane: 1 }),
      expect.objectContaining({ id: 2, kind: "hazard", direction: "up", lane: 2 }),
    ]));
  });

  it("Anchors a Moving Shield immediately before a stationary Player", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 7 / 16) });

    engine.advance(3_000);

    expect(engine.getState().board).toMatchObject({
      player: { column: 4, row: 8 },
      anchoredShields: [{ id: 1, kind: "anchored-shield", column: 3, row: 8 }],
    });
    expect(engine.getState().board.movingShieldsAndHazards.some(({ id }) => id === 1)).toBe(false);
    expect(engine.getState().impacts).toEqual([
      expect.objectContaining({ kind: "shield-player", x: 3, y: 7.5 }),
    ]);
  });

  it.each([
    ["left", 0.5, 7 / 16, 3_500, { column: 5, row: 8 }],
    ["down", 0.25, 3 / 8, 5_000, { column: 4, row: 7 }],
    ["up", 0, 3 / 8, 5_500, { column: 4, row: 9 }],
  ] as const)("Anchors a %s Moving Shield before a stationary Player", (_direction, directionRandom, laneRandom, elapsed, anchoredPosition) => {
    const engine = createRunEngine({ random: seededSequence(0, directionRandom, laneRandom) });

    engine.advance(elapsed);

    expect(engine.getState().board.anchoredShields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "anchored-shield", ...anchoredPosition }),
    ]));
    expect(engine.getState().board.movingShieldsAndHazards.some(({ id }) => id === 1)).toBe(false);
  });

  it("pushes back and Anchors a head-on Moving Shield while completing the Player move", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 7 / 16) });
    engine.advance(2_999);

    engine.act("left");

    expect(engine.getState().board).toMatchObject({
      player: { column: 3, row: 8 },
      anchoredShields: [{ id: 1, kind: "anchored-shield", column: 2, row: 8 }],
    });
    expect(engine.getState().board.movingShieldsAndHazards.some(({ id }) => id === 1)).toBe(false);
  });

  it.each([
    ["left", 0.5, 7 / 16, 3_499, "right", { column: 5, row: 8 }, { column: 6, row: 8 }],
    ["down", 0.25, 3 / 8, 4_999, "up", { column: 4, row: 7 }, { column: 4, row: 6 }],
    ["up", 0, 3 / 8, 5_499, "down", { column: 4, row: 9 }, { column: 4, row: 10 }],
  ] as const)("pushes back and Anchors a head-on %s Moving Shield", (_shieldDirection, directionRandom, laneRandom, elapsed, action, player, anchoredShield) => {
    const engine = createRunEngine({ random: seededSequence(0, directionRandom, laneRandom) });
    engine.advance(elapsed);

    engine.act(action);

    expect(engine.getState().board.player).toEqual(player);
    expect(engine.getState().board.anchoredShields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "anchored-shield", ...anchoredShield }),
    ]));
  });

  it("redirects a perpendicular Moving Shield into the next parallel Lane", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 6 / 16) });
    engine.advance(3_500);

    engine.act("up");

    expect(engine.getState().board.player).toEqual({ column: 4, row: 7 });
    expect(engine.getState().board.movingShieldsAndHazards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "shield", direction: "right", lane: 6, column: 3, row: 6 }),
    ]));
    expect(engine.getState().board.anchoredShields).toEqual([]);
  });

  it.each([
    ["left", 0.5, 8 / 16, 4_000, "down", { column: 4, row: 9 }, { lane: 10, column: 3, row: 10 }],
    ["down", 0.25, 4 / 8, 5_500, "right", { column: 5, row: 8 }, { lane: 6, column: 6, row: 7 }],
    ["up", 0, 2 / 8, 6_000, "left", { column: 3, row: 8 }, { lane: 2, column: 2, row: 7 }],
  ] as const)("redirects a perpendicular %s Moving Shield", (_shieldDirection, directionRandom, laneRandom, elapsed, action, player, redirectedShield) => {
    const engine = createRunEngine({ random: seededSequence(
      0, directionRandom, laneRandom,
      0, 0.99, 0.99,
      0, 0.99, 0.99,
      0, 0.99, 0.99,
    ) });
    engine.advance(elapsed);

    engine.act(action);

    expect(engine.getState().board.player).toEqual(player);
    expect(engine.getState().board.movingShieldsAndHazards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "shield", ...redirectedShield }),
    ]));
  });

  it("allows a legal perpendicular displacement into the outermost Lane", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 1 / 16) });
    for (let step = 0; step < 5; step += 1) {
      engine.act("up");
      engine.advance(120);
    }
    engine.advance(2_900);

    engine.act("up");

    expect(engine.getState().board.player).toEqual({ column: 4, row: 2 });
    expect(engine.getState().board.movingShieldsAndHazards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, kind: "shield", direction: "right", lane: 1, row: 1 }),
    ]));
  });

  it("advances a Moving Shield one cell-equivalent on rear contact", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 7 / 16) });
    engine.act("up");
    engine.advance(4_050);
    engine.act("down");
    engine.advance(120);

    engine.act("right");

    expect(engine.getState().board.player).toEqual({ column: 5, row: 8 });
    const shield = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 1);
    expect(shield).toMatchObject({ kind: "shield", direction: "right", lane: 8, row: 8 });
    expect(shield?.column).toBeCloseTo(5.34);
  });

  it.each([
    ["left", 0.5, 7 / 16, "up", 4_650, "down", "left", "column", -1, { column: 3, row: 8 }],
    ["down", 0.25, 3 / 8, "left", 6_100, "right", "down", "row", 1, { column: 4, row: 9 }],
    ["up", 0, 3 / 8, "left", 6_600, "right", "up", "row", -1, { column: 4, row: 7 }],
  ] as const)("advances a %s Moving Shield one cell-equivalent on rear contact", (shieldDirection, directionRandom, laneRandom, sidestep, elapsed, reenter, rearAction, axis, delta, player) => {
    const engine = createRunEngine({ random: seededSequence(
      0, directionRandom, laneRandom,
      0, 0.99, 0.99,
      0, 0.99, 0.99,
      0, 0.99, 0.99,
    ) });
    engine.act(sidestep);
    engine.advance(elapsed);
    engine.act(reenter);
    engine.advance(120);
    const before = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 1);
    const positionBefore = axis === "column" ? before?.column : before?.row;

    engine.act(rearAction);

    const after = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 1);
    const positionAfter = axis === "column" ? after?.column : after?.row;
    expect(engine.getState().board.player).toEqual(player);
    expect(after).toMatchObject({ id: 1, kind: "shield", direction: shieldDirection, lane: before?.lane });
    expect(positionAfter).toBeCloseTo((positionBefore ?? 0) + delta);
  });

  it("resolves a redirected Shield collision with a Hazard immediately", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 6 / 16,
      0.99, 0.5, 5 / 16,
      0, 0.99, 0.99,
    ) });
    engine.act("right"); engine.advance(120);
    engine.act("right"); engine.advance(120);
    engine.advance(4_260);

    engine.act("up");

    expect(engine.getState()).toMatchObject({
      score: 1,
      board: {
        player: { column: 6, row: 7 },
        movingShieldsAndHazards: expect.not.arrayContaining([
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 2 }),
        ]),
      },
      impacts: expect.arrayContaining([expect.objectContaining({ kind: "hazard-shield" })]),
    });
  });

  it("Anchors a Moving Shield before an Anchored Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.99, 7 / 16,
    ) });

    engine.advance(4_000);

    expect(engine.getState().board.anchoredShields).toEqual([
      { id: 1, kind: "anchored-shield", column: 3, row: 8 },
      { id: 2, kind: "anchored-shield", column: 2, row: 8 },
    ]);
    expect(engine.getState().board.movingShieldsAndHazards.some(({ id }) => id === 2)).toBe(false);
  });

  it("Anchors a vertical Moving Shield before an Anchored Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.25, 3 / 8,
      0, 0.25, 3 / 8,
      0, 0.25, 3 / 8,
    ) });

    engine.advance(6_000);

    expect(engine.getState().board.anchoredShields).toEqual(expect.arrayContaining([
      { id: 1, kind: "anchored-shield", column: 4, row: 7 },
      { id: 2, kind: "anchored-shield", column: 4, row: 6 },
    ]));
  });

  it("pushes a contiguous Anchored Shield chain one cell", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.99, 7 / 16,
    ) });
    engine.advance(4_000);

    engine.act("left");

    expect(engine.getState().board).toMatchObject({
      player: { column: 3, row: 8 },
      anchoredShields: [
        { id: 1, kind: "anchored-shield", column: 2, row: 8 },
        { id: 2, kind: "anchored-shield", column: 1, row: 8 },
      ],
    });
  });

  it("transmits a Push through an Anchored Shield into a head-on Moving Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.99, 7 / 16,
    ) });
    engine.advance(3_999);

    engine.act("left");

    expect(engine.getState().board).toMatchObject({
      player: { column: 3, row: 8 },
      movingShieldsAndHazards: [],
      anchoredShields: [
        { id: 1, kind: "anchored-shield", column: 2, row: 8 },
        { id: 2, kind: "anchored-shield", column: 1, row: 8 },
      ],
    });
  });

  it("transmits a rear Push through an Anchored Shield into a Moving Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.5, 7 / 16,
      0, 0.99, 6 / 16,
      0, 0.99, 15 / 16,
      0, 0.99, 15 / 16,
    ) });
    engine.advance(3_500);
    engine.act("up"); engine.advance(120);
    engine.act("up"); engine.advance(120);
    engine.act("right"); engine.advance(120);
    engine.act("right"); engine.advance(120);
    engine.advance(2_021);
    engine.act("down"); engine.advance(120);
    engine.act("left"); engine.advance(120);
    engine.act("left"); engine.advance(120);
    engine.act("down"); engine.advance(120);
    const before = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 2);
    expect(engine.getState().board).toMatchObject({
      player: { column: 4, row: 8 },
      anchoredShields: [
        { id: 1, kind: "anchored-shield", column: 5, row: 8 },
      ],
    });
    expect(before).toMatchObject({ id: 2, kind: "shield", direction: "right", lane: 8 });

    engine.act("right");

    const displaced = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 2);
    expect(engine.getState().board).toMatchObject({
      player: { column: 5, row: 8 },
      anchoredShields: [
        { id: 1, kind: "anchored-shield", column: 6, row: 8 },
      ],
    });
    expect(displaced).toMatchObject({ id: 2, kind: "shield", direction: "right", lane: 8 });
    expect(displaced?.column).toBeCloseTo((before?.column ?? 0) + 1);
  });

  it("transmits a perpendicular Push into a Moving Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.25, 1 / 8,
      0, 0.99, 15 / 16,
      0, 0.99, 15 / 16,
    ) });
    engine.advance(6_999);

    engine.act("left");

    expect(engine.getState().board).toMatchObject({
      player: { column: 3, row: 8 },
      anchoredShields: [
        { id: 1, kind: "anchored-shield", column: 2, row: 8 },
      ],
      movingShieldsAndHazards: expect.arrayContaining([
        expect.objectContaining({ id: 2, kind: "shield", direction: "down", lane: 1, column: 1 }),
      ]),
    });
  });

  it("destroys a Hazard hit by a pushed Anchored Shield and completes the Player move", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0.99, 0.99, 7 / 16,
    ) });
    engine.advance(3_999);

    engine.act("left");

    expect(engine.getState()).toMatchObject({
      score: 1,
      moving: true,
      board: {
        player: { column: 3, row: 8 },
        anchoredShields: [],
        movingShieldsAndHazards: [],
      },
      impacts: [expect.objectContaining({ kind: "hazard-shield" })],
    });
  });

  it("rejects a Push when an indirectly displaced Moving Shield would leave the Board", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.99, 7 / 16,
      0, 0.99, 7 / 16,
    ) });
    engine.advance(4_999);
    const before = engine.getState().board;
    expect(before.anchoredShields).toEqual([
      { id: 1, kind: "anchored-shield", column: 3, row: 8 },
      { id: 2, kind: "anchored-shield", column: 2, row: 8 },
    ]);
    expect(before.movingShieldsAndHazards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 3, kind: "shield", direction: "right" }),
    ]));

    engine.act("left");

    expect(engine.getState().board).toEqual(before);
    expect(engine.getState().moving).toBe(false);
  });

  it("rejects a Push when an Anchored Shield chain would leave the Board", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.99, 7 / 16,
    ) });
    engine.advance(4_000);
    engine.act("left");
    engine.advance(120);
    const before = engine.getState().board;

    engine.act("left");

    expect(engine.getState().board).toEqual(before);
    expect(engine.getState().moving).toBe(false);
  });

  it("Anchors an opposing Moving Shield on the preceding side of an Anchored Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.5, 7 / 16,
      0, 0.99, 0.99,
    ) });
    engine.advance(3_000);
    engine.act("up");

    engine.advance(2_500);

    expect(engine.getState().board.anchoredShields).toEqual(expect.arrayContaining([
      { id: 1, kind: "anchored-shield", column: 3, row: 8 },
      { id: 2, kind: "anchored-shield", column: 4, row: 8 },
    ]));
  });

  it("destroys an Anchored Shield and Hazard on contact and awards one point", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0.99, 0.99, 7 / 16,
    ) });

    engine.advance(4_000);

    expect(engine.getState().score).toBe(1);
    expect(engine.getState().board.anchoredShields).toEqual([]);
    expect(engine.getState().board.movingShieldsAndHazards.some(({ id }) => id === 2)).toBe(false);
    expect(engine.getState().impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "hazard-shield" }),
    ]));
  });

  it("blocks the complete Player move when direct Shield displacement would leave the Board", () => {
    const engine = createRunEngine({ random: seededSequence(0, 0.99, 0) });
    for (let step = 0; step < 6; step += 1) {
      engine.act("up");
      engine.advance(120);
    }
    engine.advance(2_780);
    const shieldBefore = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 1);

    engine.act("up");

    expect(engine.getState().board.player).toEqual({ column: 4, row: 2 });
    expect(engine.getState().moving).toBe(false);
    expect(engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 1)).toEqual(shieldBefore);
  });

  it("blocks the complete Player move when direct Shield displacement would overlap an Anchored Shield", () => {
    const engine = createRunEngine({ random: seededSequence(
      0, 0.99, 7 / 16,
      0, 0.99, 6 / 16,
      0, 0.99, 0.99,
    ) });
    engine.advance(3_000);
    engine.act("up"); engine.advance(120);
    engine.act("up"); engine.advance(120);
    engine.advance(1_510);
    const shieldBefore = engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 2);

    engine.act("down");

    expect(engine.getState().board.player).toEqual({ column: 4, row: 6 });
    expect(engine.getState().moving).toBe(false);
    expect(engine.getState().board.movingShieldsAndHazards.find(({ id }) => id === 2)).toEqual(shieldBefore);
    expect(engine.getState().board.anchoredShields).toEqual([
      { id: 1, kind: "anchored-shield", column: 3, row: 8 },
    ]);
  });
});
