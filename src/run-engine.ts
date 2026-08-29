export type Direction = "up" | "down" | "left" | "right";
export type BoardPosition = Readonly<{ column: number; row: number }>;
export type MovingShield = Readonly<{
  id: number; kind: "shield"; direction: Direction; lane: number; column: number; row: number;
}>;
export type Hazard = Readonly<{
  id: number; kind: "hazard"; direction: Direction; lane: number; column: number; row: number;
}>;
export type MovingShieldOrHazard = MovingShield | Hazard;
export type Impact = Readonly<{
  id: number; kind: "hazard-shield" | "hazard-player"; x: number; y: number; remainingMilliseconds: number;
}>;

export type RunState = Readonly<{
  board: Readonly<{
    columns: 8;
    rows: 16;
    player: BoardPosition;
    movingShieldsAndHazards: readonly MovingShieldOrHazard[];
  }>;
  score: number;
  status: "running" | "ended";
  moving: boolean;
  impacts: readonly Impact[];
}>;

export type RunEngine = Readonly<{
  getState(): RunState;
  act(direction: Direction): void;
  advance(elapsedMilliseconds: number): void;
}>;

export type RunEngineOptions = Readonly<{ random?: () => number }>;

const MOVEMENT_MILLISECONDS = 120;
const TILE_SPEED = 2 / 1_000;
const INITIAL_SPAWN_INTERVAL = 1_500;
const MINIMUM_SPAWN_INTERVAL = 500;
const SPAWN_INTERVAL_STEP = 50;
const CADENCE_STEP_MILLISECONDS = 10_000;
const MINIMUM_HAZARD_REACTION_MILLISECONDS = 750;
const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

export function createRunEngine(options: RunEngineOptions = {}): RunEngine {
  const random = options.random ?? Math.random;
  let state: RunState = {
    board: { columns: 8, rows: 16, player: { column: 4, row: 8 }, movingShieldsAndHazards: [] },
    score: 0,
    status: "running",
    moving: false,
    impacts: [],
  };
  let movementRemaining = 0;
  let bufferedDirection: Direction | null = null;
  let runElapsed = 0;
  let spawnRemaining = INITIAL_SPAWN_INTERVAL;
  let nextCadenceStep = CADENCE_STEP_MILLISECONDS;
  let nextTileId = 1;
  let nextImpactId = 1;

  function startMovement(direction: Direction): void {
    const deltas: Record<Direction, readonly [number, number]> = {
      up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    };
    const [columnDelta, rowDelta] = deltas[direction];
    const { column, row } = state.board.player;
    const nextColumn = Math.min(state.board.columns, Math.max(1, column + columnDelta));
    const nextRow = Math.min(state.board.rows, Math.max(1, row + rowDelta));
    if (nextColumn === column && nextRow === row) return;
    state = {
      ...state,
      board: { ...state.board, player: { column: nextColumn, row: nextRow } },
      moving: true,
    };
    movementRemaining = MOVEMENT_MILLISECONDS;
  }

  function act(direction: Direction): void {
    if (state.status !== "running") return;
    if (state.moving) {
      bufferedDirection ??= direction;
      return;
    }
    startMovement(direction);
  }

  function advancePlayer(elapsedMilliseconds: number): void {
    let elapsed = Math.max(0, elapsedMilliseconds);
    while (state.moving && elapsed >= movementRemaining) {
      elapsed -= movementRemaining;
      state = { ...state, moving: false };
      movementRemaining = 0;
      const nextDirection = bufferedDirection;
      bufferedDirection = null;
      if (nextDirection) startMovement(nextDirection);
    }
    if (state.moving) movementRemaining -= elapsed;
  }

  function spawnIntervalAt(elapsedMilliseconds: number): number {
    const reductions = Math.floor(elapsedMilliseconds / CADENCE_STEP_MILLISECONDS);
    return Math.max(MINIMUM_SPAWN_INTERVAL, INITIAL_SPAWN_INTERVAL - reductions * SPAWN_INTERVAL_STEP);
  }

  function spawnInterval(): number {
    return spawnIntervalAt(runElapsed);
  }

  function entryIsOccupied(direction: Direction, lane: number): boolean {
    return state.board.movingShieldsAndHazards.some((tile) => {
      if (direction === "right") return tile.row === lane && tile.column < 1 && tile.column + 1 > 0;
      if (direction === "left") return tile.row === lane && tile.column < 8 && tile.column + 1 > 7;
      if (direction === "down") return tile.column === lane && tile.row < 1 && tile.row + 1 > 0;
      return tile.column === lane && tile.row < 16 && tile.row + 1 > 15;
    });
  }

  function reactionMilliseconds(direction: Direction, lane: number): number {
    const player = state.board.player;
    if (direction === "right" && player.row === lane) return (player.column - 1) / TILE_SPEED;
    if (direction === "left" && player.row === lane) return (8 - player.column) / TILE_SPEED;
    if (direction === "down" && player.column === lane) return (player.row - 1) / TILE_SPEED;
    if (direction === "up" && player.column === lane) return (16 - player.row) / TILE_SPEED;
    return Number.POSITIVE_INFINITY;
  }

  function attemptSpawn(): void {
    const kind: MovingShieldOrHazard["kind"] = random() < 0.5 ? "shield" : "hazard";
    const directionIndex = Math.min(DIRECTIONS.length - 1, Math.floor(random() * DIRECTIONS.length));
    const direction = DIRECTIONS[directionIndex] ?? "up";
    const laneCount = direction === "left" || direction === "right" ? state.board.rows : state.board.columns;
    const lane = Math.min(laneCount, Math.floor(random() * laneCount) + 1);
    if (entryIsOccupied(direction, lane)) return;
    if (kind === "hazard" && reactionMilliseconds(direction, lane) < MINIMUM_HAZARD_REACTION_MILLISECONDS) return;
    const horizontal = direction === "left" || direction === "right";
    const tile: MovingShieldOrHazard = {
      id: nextTileId,
      kind,
      direction,
      lane,
      column: horizontal ? (direction === "right" ? -1 : 8) : lane,
      row: horizontal ? lane : (direction === "down" ? -1 : 16),
    };
    nextTileId += 1;
    state = { ...state, board: { ...state.board, movingShieldsAndHazards: [...state.board.movingShieldsAndHazards, tile] } };
  }

  function tilePosition(tile: MovingShieldOrHazard): Readonly<{ x: number; y: number }> {
    const horizontal = tile.direction === "left" || tile.direction === "right";
    return { x: horizontal ? tile.column : tile.column - 1, y: horizontal ? tile.row - 1 : tile.row };
  }

  function tileVelocity(tile: MovingShieldOrHazard): Readonly<{ x: number; y: number }> {
    if (tile.direction === "right") return { x: TILE_SPEED, y: 0 };
    if (tile.direction === "left") return { x: -TILE_SPEED, y: 0 };
    if (tile.direction === "down") return { x: 0, y: TILE_SPEED };
    return { x: 0, y: -TILE_SPEED };
  }

  function axisContactTime(position: number, velocity: number): readonly [number, number] | null {
    if (velocity === 0) return Math.abs(position) <= 1 ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] : null;
    const first = (-1 - position) / velocity;
    const second = (1 - position) / velocity;
    return [Math.min(first, second), Math.max(first, second)];
  }

  function contactTime(
    firstPosition: Readonly<{ x: number; y: number }>,
    firstVelocity: Readonly<{ x: number; y: number }>,
    secondPosition: Readonly<{ x: number; y: number }>,
    secondVelocity: Readonly<{ x: number; y: number }>,
    maximumMilliseconds: number,
  ): number | null {
    const x = axisContactTime(firstPosition.x - secondPosition.x, firstVelocity.x - secondVelocity.x);
    const y = axisContactTime(firstPosition.y - secondPosition.y, firstVelocity.y - secondVelocity.y);
    if (!x || !y) return null;
    const entry = Math.max(0, x[0], y[0]);
    const exit = Math.min(maximumMilliseconds, x[1], y[1]);
    return entry <= exit ? entry : null;
  }

  function advanceMovingTilesAndImpacts(elapsedMilliseconds: number): void {
    const distance = elapsedMilliseconds * TILE_SPEED;
    const movingShieldsAndHazards = state.board.movingShieldsAndHazards.map((tile): MovingShieldOrHazard => {
      if (tile.direction === "right") return { ...tile, column: tile.column + distance };
      if (tile.direction === "left") return { ...tile, column: tile.column - distance };
      if (tile.direction === "down") return { ...tile, row: tile.row + distance };
      return { ...tile, row: tile.row - distance };
    });
    const impacts = state.impacts
      .map((impact) => ({ ...impact, remainingMilliseconds: impact.remainingMilliseconds - elapsedMilliseconds }))
      .filter(({ remainingMilliseconds }) => remainingMilliseconds > 0);
    state = { ...state, impacts, board: { ...state.board, movingShieldsAndHazards } };
  }

  function nextContact(maximumMilliseconds: number): Readonly<{
    time: number; kind: "hazard-shield" | "hazard-player"; hazard: Hazard; shield?: MovingShield;
  }> | null {
    const tiles = state.board.movingShieldsAndHazards;
    const hazards = tiles.filter((tile): tile is Hazard => tile.kind === "hazard");
    const movingShields = tiles.filter((tile): tile is MovingShield => tile.kind === "shield");
    const candidates: Array<{ time: number; kind: "hazard-shield" | "hazard-player"; hazard: Hazard; shield?: MovingShield }> = [];
    for (const hazard of hazards) {
      for (const movingShield of movingShields) {
        const time = contactTime(tilePosition(hazard), tileVelocity(hazard), tilePosition(movingShield), tileVelocity(movingShield), maximumMilliseconds);
        if (time !== null) candidates.push({ time, kind: "hazard-shield", hazard, shield: movingShield });
      }
      const player = { x: state.board.player.column - 1, y: state.board.player.row - 1 };
      const time = contactTime(tilePosition(hazard), tileVelocity(hazard), player, { x: 0, y: 0 }, maximumMilliseconds);
      if (time !== null) candidates.push({ time, kind: "hazard-player", hazard });
    }
    const creationOrder = (contact: (typeof candidates)[number]): readonly [number, number] => {
      const otherId = contact.shield?.id ?? contact.hazard.id;
      return [Math.min(contact.hazard.id, otherId), Math.max(contact.hazard.id, otherId)];
    };
    candidates.sort((first, second) => {
      const firstOrder = creationOrder(first);
      const secondOrder = creationOrder(second);
      return first.time - second.time
        || (first.kind === second.kind ? 0 : first.kind === "hazard-shield" ? -1 : 1)
        || firstOrder[0] - secondOrder[0]
        || firstOrder[1] - secondOrder[1];
    });
    return candidates[0] ?? null;
  }

  function resolveContact(contact: NonNullable<ReturnType<typeof nextContact>>): void {
    const currentHazard = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.hazard.id) ?? contact.hazard;
    const hazardPosition = tilePosition(currentHazard);
    if (contact.kind === "hazard-shield" && contact.shield) {
      const currentMovingShield = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.shield?.id) ?? contact.shield;
      const shieldPosition = tilePosition(currentMovingShield);
      const removed = new Set([contact.hazard.id, contact.shield.id]);
      state = {
        ...state,
        score: state.score + 1,
        impacts: [...state.impacts, {
          id: nextImpactId++, kind: contact.kind,
          x: (hazardPosition.x + shieldPosition.x + 1) / 2,
          y: (hazardPosition.y + shieldPosition.y + 1) / 2,
          remainingMilliseconds: 220,
        }],
        board: { ...state.board, movingShieldsAndHazards: state.board.movingShieldsAndHazards.filter(({ id }) => !removed.has(id)) },
      };
      return;
    }
    const player = { x: state.board.player.column - 1, y: state.board.player.row - 1 };
    state = {
      ...state, status: "ended", moving: false,
      impacts: [...state.impacts, {
        id: nextImpactId++, kind: contact.kind,
        x: (hazardPosition.x + player.x + 1) / 2,
        y: (hazardPosition.y + player.y + 1) / 2,
        remainingMilliseconds: 220,
      }],
    };
    bufferedDirection = null;
    movementRemaining = 0;
  }

  function moveMovingShieldOrHazards(elapsedMilliseconds: number): void {
    let remaining = elapsedMilliseconds;
    while (remaining > 0 && state.status === "running") {
      const contact = nextContact(remaining);
      const movement = contact?.time ?? remaining;
      advanceMovingTilesAndImpacts(movement);
      remaining -= movement;
      if (contact) resolveContact(contact);
    }
    if (state.status !== "running") return;
    const movingShieldsAndHazards = state.board.movingShieldsAndHazards.filter((tile) => {
      if (tile.direction === "right") return tile.column < state.board.columns;
      if (tile.direction === "left") return tile.column > -1;
      if (tile.direction === "down") return tile.row < state.board.rows;
      return tile.row > -1;
    });
    state = { ...state, board: { ...state.board, movingShieldsAndHazards } };
  }

  function advance(elapsedMilliseconds: number): void {
    let elapsed = Math.max(0, elapsedMilliseconds);
    advancePlayer(elapsed);
    while (elapsed > 0 && state.status === "running") {
      const segment = Math.min(elapsed, spawnRemaining, nextCadenceStep - runElapsed);
      moveMovingShieldOrHazards(segment);
      if (state.status !== "running") return;
      elapsed -= segment;
      runElapsed += segment;
      spawnRemaining -= segment;
      if (runElapsed === nextCadenceStep) {
        const previousInterval = spawnIntervalAt(runElapsed - 1);
        spawnRemaining -= previousInterval - spawnInterval();
        nextCadenceStep += CADENCE_STEP_MILLISECONDS;
      }
      if (spawnRemaining <= 0) {
        attemptSpawn();
        spawnRemaining = spawnInterval();
      }
    }
  }

  return { getState: () => state, act, advance };
}
