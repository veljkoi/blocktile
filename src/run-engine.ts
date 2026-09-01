export type Direction = "up" | "down" | "left" | "right";
export type BoardPosition = Readonly<{ column: number; row: number }>;
export type MovingShield = Readonly<{
  id: number; kind: "shield"; direction: Direction; lane: number; column: number; row: number;
}>;
export type Hazard = Readonly<{
  id: number; kind: "hazard"; direction: Direction; lane: number; column: number; row: number;
}>;
export type AnchoredShield = Readonly<{
  id: number; kind: "anchored-shield"; column: number; row: number;
}>;
export type MovingShieldOrHazard = MovingShield | Hazard;
export type Impact = Readonly<{
  id: number; kind: "hazard-shield" | "hazard-player" | "shield-player"; x: number; y: number; remainingMilliseconds: number;
}>;

export type RunState = Readonly<{
  board: Readonly<{
    columns: 8;
    rows: 16;
    player: BoardPosition;
    movingShieldsAndHazards: readonly MovingShieldOrHazard[];
    anchoredShields: readonly AnchoredShield[];
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

const MOVEMENT_MILLISECONDS = 10;
const TILE_SPEED = 2 / 1_000;
const INITIAL_SPAWN_INTERVAL = 1_500;
const MINIMUM_SPAWN_INTERVAL = 500;
const SPAWN_INTERVAL_STEP = 50;
const CADENCE_STEP_MILLISECONDS = 10_000;
const MINIMUM_HAZARD_REACTION_MILLISECONDS = 750;
const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];
const DIRECTION_DELTAS: Record<Direction, readonly [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: "down", down: "up", left: "right", right: "left",
};

type Contact =
  | Readonly<{ time: number; kind: "hazard-shield"; hazard: Hazard; shield: MovingShield }>
  | Readonly<{ time: number; kind: "hazard-anchored"; hazard: Hazard; anchoredShield: AnchoredShield }>
  | Readonly<{ time: number; kind: "hazard-player"; hazard: Hazard }>
  | Readonly<{ time: number; kind: "shield-player"; shield: MovingShield }>
  | Readonly<{ time: number; kind: "shield-shield"; shield: MovingShield; anchoredShield: AnchoredShield }>;

const CONTACT_PRIORITY: Record<Contact["kind"], number> = {
  "hazard-shield": 0,
  "hazard-anchored": 0,
  "hazard-player": 1,
  "shield-player": 2,
  "shield-shield": 3,
};

export function createRunEngine(options: RunEngineOptions = {}): RunEngine {
  const random = options.random ?? Math.random;
  let state: RunState = {
    board: { columns: 8, rows: 16, player: { column: 4, row: 8 }, movingShieldsAndHazards: [], anchoredShields: [] },
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
    const [columnDelta, rowDelta] = DIRECTION_DELTAS[direction];
    const { column, row } = state.board.player;
    const nextColumn = Math.min(state.board.columns, Math.max(1, column + columnDelta));
    const nextRow = Math.min(state.board.rows, Math.max(1, row + rowDelta));
    if (nextColumn === column && nextRow === row) return;

    const firstPushedShield = state.board.anchoredShields.find((shield) => (
      shield.column === nextColumn && shield.row === nextRow
    ));
    if (firstPushedShield) {
      let movingShieldsAndHazards = [...state.board.movingShieldsAndHazards];
      let anchoredShields = [...state.board.anchoredShields];
      let score = state.score;
      let impacts = state.impacts;
      let candidateNextImpactId = nextImpactId;
      const displacingMovingShields = new Set<number>();

      const overlapsCell = (tile: MovingShieldOrHazard, cellColumn: number, cellRow: number): boolean => {
        const position = tilePosition(tile);
        const x = cellColumn - 1;
        const y = cellRow - 1;
        return position.x < x + 1 && position.x + 1 > x
          && position.y < y + 1 && position.y + 1 > y;
      };

      function pushAnchoredChain(startColumn: number, startRow: number): boolean {
        const chain: AnchoredShield[] = [];
        let destinationColumn = startColumn;
        let destinationRow = startRow;
        while (true) {
          const shield = anchoredShields.find((candidate) => (
            candidate.column === destinationColumn && candidate.row === destinationRow
          ));
          if (!shield) break;
          chain.push(shield);
          destinationColumn += columnDelta;
          destinationRow += rowDelta;
        }
        if (chain.length === 0) return true;
        if (destinationColumn < 1 || destinationColumn > state.board.columns
          || destinationRow < 1 || destinationRow > state.board.rows) return false;

        const destinationOccupants = movingShieldsAndHazards
          .filter((tile) => overlapsCell(tile, destinationColumn, destinationRow))
          .sort((first, second) => first.id - second.id);
        const contactedHazard = destinationOccupants.find((tile): tile is Hazard => tile.kind === "hazard");
        const contactedMovingShields = destinationOccupants
          .filter((tile): tile is MovingShield => tile.kind === "shield");
        const destroyedShield = contactedHazard ? chain.at(-1) : undefined;

        if (contactedHazard && destroyedShield) {
          const hazardPosition = tilePosition(contactedHazard);
          const destination = { x: destinationColumn - 1, y: destinationRow - 1 };
          movingShieldsAndHazards = movingShieldsAndHazards.filter(({ id }) => id !== contactedHazard.id);
          anchoredShields = anchoredShields.filter(({ id }) => id !== destroyedShield.id);
          score += 1;
          impacts = [...impacts, {
            id: candidateNextImpactId++, kind: "hazard-shield",
            x: (hazardPosition.x + destination.x + 1) / 2,
            y: (hazardPosition.y + destination.y + 1) / 2,
            remainingMilliseconds: 220,
          }];
        } else {
          for (const movingShield of contactedMovingShields) {
            if (!displaceMovingShield(movingShield, destinationColumn, destinationRow)) return false;
          }
        }

        const shiftedIds = new Set(chain
          .filter(({ id }) => id !== destroyedShield?.id)
          .map(({ id }) => id));
        anchoredShields = anchoredShields.map((shield) => (
          shiftedIds.has(shield.id)
            ? { ...shield, column: shield.column + columnDelta, row: shield.row + rowDelta }
            : shield
        ));
        return true;
      }

      function displaceMovingShield(
        movingShield: MovingShield,
        contactColumn: number,
        contactRow: number,
      ): boolean {
        if (displacingMovingShields.has(movingShield.id)) return false;
        displacingMovingShields.add(movingShield.id);
        const horizontal = movingShield.direction === "left" || movingShield.direction === "right";

        if (movingShield.direction === OPPOSITE_DIRECTIONS[direction]) {
          const anchoredColumn = contactColumn + columnDelta;
          const anchoredRow = contactRow + rowDelta;
          if (anchoredColumn < 1 || anchoredColumn > state.board.columns
            || anchoredRow < 1 || anchoredRow > state.board.rows) return false;
          if (!pushAnchoredChain(anchoredColumn, anchoredRow)) return false;
          const movingOccupants = movingShieldsAndHazards
            .filter((tile): tile is MovingShield => (
              tile.kind === "shield"
              && tile.id !== movingShield.id
              && overlapsCell(tile, anchoredColumn, anchoredRow)
            ))
            .sort((first, second) => first.id - second.id);
          for (const occupant of movingOccupants) {
            if (!displaceMovingShield(occupant, anchoredColumn, anchoredRow)) return false;
          }
          movingShieldsAndHazards = movingShieldsAndHazards.filter(({ id }) => id !== movingShield.id);
          anchoredShields = [...anchoredShields, {
            id: movingShield.id,
            kind: "anchored-shield",
            column: anchoredColumn,
            row: anchoredRow,
          }];
          displacingMovingShields.delete(movingShield.id);
          return true;
        }

        const displacedShield: MovingShield = movingShield.direction === direction
          ? {
              ...movingShield,
              column: movingShield.column + (horizontal ? columnDelta : 0),
              row: movingShield.row + (horizontal ? 0 : rowDelta),
            }
          : {
              ...movingShield,
              lane: movingShield.lane + (horizontal ? rowDelta : columnDelta),
              column: movingShield.column + (horizontal ? 0 : columnDelta),
              row: movingShield.row + (horizontal ? rowDelta : 0),
            };
        const laneLimit = horizontal ? state.board.rows : state.board.columns;
        const displacedPosition = tilePosition(displacedShield);
        if (displacedShield.lane < 1 || displacedShield.lane > laneLimit
          || displacedPosition.x < 0 || displacedPosition.x > state.board.columns - 1
          || displacedPosition.y < 0 || displacedPosition.y > state.board.rows - 1) return false;

        while (true) {
          const blockingShield = anchoredShields.find((anchoredShield) => {
            const x = anchoredShield.column - 1;
            const y = anchoredShield.row - 1;
            return displacedPosition.x < x + 1 && displacedPosition.x + 1 > x
              && displacedPosition.y < y + 1 && displacedPosition.y + 1 > y;
          });
          if (!blockingShield) break;
          if (!pushAnchoredChain(blockingShield.column, blockingShield.row)) return false;
        }
        movingShieldsAndHazards = movingShieldsAndHazards.map((tile) => (
          tile.id === displacedShield.id ? displacedShield : tile
        ));
        displacingMovingShields.delete(movingShield.id);
        return true;
      }

      if (!pushAnchoredChain(nextColumn, nextRow)) return;
      state = {
        ...state,
        score,
        impacts,
        board: {
          ...state.board,
          player: { column: nextColumn, row: nextRow },
          movingShieldsAndHazards,
          anchoredShields,
        },
        moving: true,
      };
      nextImpactId = candidateNextImpactId;
      resolveImmediateHazardShieldContacts();
      movementRemaining = MOVEMENT_MILLISECONDS;
      return;
    }
    const target = { x: nextColumn - 1, y: nextRow - 1 };
    const contactedShield = state.board.movingShieldsAndHazards.find((tile): tile is MovingShield => {
      if (tile.kind !== "shield") return false;
      const position = tilePosition(tile);
      return position.x < target.x + 1 && position.x + 1 > target.x
        && position.y < target.y + 1 && position.y + 1 > target.y;
    });
    if (contactedShield && contactedShield.direction === OPPOSITE_DIRECTIONS[direction]) {
      const anchoredShield: AnchoredShield = {
        id: contactedShield.id,
        kind: "anchored-shield",
        column: nextColumn + columnDelta,
        row: nextRow + rowDelta,
      };
      if (anchoredShield.column < 1 || anchoredShield.column > state.board.columns
        || anchoredShield.row < 1 || anchoredShield.row > state.board.rows
        || state.board.anchoredShields.some(({ column, row }) => (
          column === anchoredShield.column && row === anchoredShield.row
        ))) return;
      const shieldPosition = tilePosition(contactedShield);
      state = {
        ...state,
        board: {
          ...state.board,
          player: { column: nextColumn, row: nextRow },
          movingShieldsAndHazards: state.board.movingShieldsAndHazards.filter(({ id }) => id !== contactedShield.id),
          anchoredShields: [...state.board.anchoredShields, anchoredShield],
        },
        impacts: [...state.impacts, {
          id: nextImpactId++, kind: "shield-player",
          x: (shieldPosition.x + target.x + 1) / 2,
          y: (shieldPosition.y + target.y + 1) / 2,
          remainingMilliseconds: 220,
        }],
        moving: true,
      };
      resolveImmediateHazardShieldContacts();
      movementRemaining = MOVEMENT_MILLISECONDS;
      return;
    }
    if (contactedShield && contactedShield.direction !== direction) {
      const horizontal = contactedShield.direction === "left" || contactedShield.direction === "right";
      const redirectedShield: MovingShield = {
        ...contactedShield,
        lane: contactedShield.lane + (horizontal ? rowDelta : columnDelta),
        column: contactedShield.column + (horizontal ? 0 : columnDelta),
        row: contactedShield.row + (horizontal ? rowDelta : 0),
      };
      const laneLimit = horizontal ? state.board.rows : state.board.columns;
      if (redirectedShield.lane < 1 || redirectedShield.lane > laneLimit
        || overlapsAnchoredShield(redirectedShield)) return;
      state = {
        ...state,
        board: {
          ...state.board,
          player: { column: nextColumn, row: nextRow },
          movingShieldsAndHazards: state.board.movingShieldsAndHazards.map((tile) => (
            tile.id === redirectedShield.id ? redirectedShield : tile
          )),
        },
        moving: true,
      };
      resolveImmediateHazardShieldContacts();
      movementRemaining = MOVEMENT_MILLISECONDS;
      return;
    }
    if (contactedShield) {
      const horizontal = contactedShield.direction === "left" || contactedShield.direction === "right";
      const advancedShield: MovingShield = {
        ...contactedShield,
        column: contactedShield.column + (horizontal ? columnDelta : 0),
        row: contactedShield.row + (horizontal ? 0 : rowDelta),
      };
      if ((horizontal && (advancedShield.column < 0 || advancedShield.column > state.board.columns - 1))
        || (!horizontal && (advancedShield.row < 0 || advancedShield.row > state.board.rows - 1))
        || overlapsAnchoredShield(advancedShield)) return;
      state = {
        ...state,
        board: {
          ...state.board,
          player: { column: nextColumn, row: nextRow },
          movingShieldsAndHazards: state.board.movingShieldsAndHazards.map((tile) => (
            tile.id === advancedShield.id ? advancedShield : tile
          )),
        },
        moving: true,
      };
      resolveImmediateHazardShieldContacts();
      movementRemaining = MOVEMENT_MILLISECONDS;
      return;
    }
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
    const movingEntryOccupied = state.board.movingShieldsAndHazards.some((tile) => {
      if (direction === "right") return tile.row === lane && tile.column < 1 && tile.column + 1 > 0;
      if (direction === "left") return tile.row === lane && tile.column < 8 && tile.column + 1 > 7;
      if (direction === "down") return tile.column === lane && tile.row < 1 && tile.row + 1 > 0;
      return tile.column === lane && tile.row < 16 && tile.row + 1 > 15;
    });
    const anchoredEntryOccupied = state.board.anchoredShields.some((shield) => {
      if (direction === "right") return shield.row === lane && shield.column === 1;
      if (direction === "left") return shield.row === lane && shield.column === state.board.columns;
      if (direction === "down") return shield.column === lane && shield.row === 1;
      return shield.column === lane && shield.row === state.board.rows;
    });
    return movingEntryOccupied || anchoredEntryOccupied;
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

  function overlapsAnchoredShield(tile: MovingShield): boolean {
    const position = tilePosition(tile);
    return state.board.anchoredShields.some((anchoredShield) => {
      const x = anchoredShield.column - 1;
      const y = anchoredShield.row - 1;
      return position.x < x + 1 && position.x + 1 > x
        && position.y < y + 1 && position.y + 1 > y;
    });
  }

  function tileVelocity(tile: MovingShieldOrHazard): Readonly<{ x: number; y: number }> {
    if (tile.direction === "right") return { x: TILE_SPEED, y: 0 };
    if (tile.direction === "left") return { x: -TILE_SPEED, y: 0 };
    if (tile.direction === "down") return { x: 0, y: TILE_SPEED };
    return { x: 0, y: -TILE_SPEED };
  }

  function axisContactTime(position: number, velocity: number): readonly [number, number] | null {
    if (velocity === 0) return Math.abs(position) < 1 ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] : null;
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

  function nextContact(maximumMilliseconds: number): Contact | null {
    const tiles = state.board.movingShieldsAndHazards;
    const hazards = tiles.filter((tile): tile is Hazard => tile.kind === "hazard");
    const movingShields = tiles.filter((tile): tile is MovingShield => tile.kind === "shield");
    const candidates: Contact[] = [];
    for (const hazard of hazards) {
      for (const movingShield of movingShields) {
        const time = contactTime(tilePosition(hazard), tileVelocity(hazard), tilePosition(movingShield), tileVelocity(movingShield), maximumMilliseconds);
        if (time !== null) candidates.push({ time, kind: "hazard-shield", hazard, shield: movingShield });
      }
      for (const anchoredShield of state.board.anchoredShields) {
        const anchoredPosition = { x: anchoredShield.column - 1, y: anchoredShield.row - 1 };
        const time = contactTime(tilePosition(hazard), tileVelocity(hazard), anchoredPosition, { x: 0, y: 0 }, maximumMilliseconds);
        if (time !== null) candidates.push({ time, kind: "hazard-anchored", hazard, anchoredShield });
      }
      const player = { x: state.board.player.column - 1, y: state.board.player.row - 1 };
      const time = contactTime(tilePosition(hazard), tileVelocity(hazard), player, { x: 0, y: 0 }, maximumMilliseconds);
      if (time !== null) candidates.push({ time, kind: "hazard-player", hazard });
    }
    if (!state.moving) {
      const player = { x: state.board.player.column - 1, y: state.board.player.row - 1 };
      for (const shield of movingShields) {
        const shieldPosition = tilePosition(shield);
        const approaching = shield.direction === "right" ? player.x >= shieldPosition.x
          : shield.direction === "left" ? player.x <= shieldPosition.x
            : shield.direction === "down" ? player.y >= shieldPosition.y
              : player.y <= shieldPosition.y;
        if (!approaching) continue;
        const time = contactTime(tilePosition(shield), tileVelocity(shield), player, { x: 0, y: 0 }, maximumMilliseconds);
        if (time !== null) candidates.push({ time, kind: "shield-player", shield });
      }
    }
    for (const shield of movingShields) {
      for (const anchoredShield of state.board.anchoredShields) {
        const anchoredPosition = { x: anchoredShield.column - 1, y: anchoredShield.row - 1 };
        const time = contactTime(tilePosition(shield), tileVelocity(shield), anchoredPosition, { x: 0, y: 0 }, maximumMilliseconds);
        if (time !== null) candidates.push({ time, kind: "shield-shield", shield, anchoredShield });
      }
    }
    const creationOrder = (contact: Contact): readonly [number, number] => {
      let firstId: number;
      let secondId: number;
      if (contact.kind === "hazard-shield") {
        firstId = contact.hazard.id; secondId = contact.shield.id;
      } else if (contact.kind === "hazard-anchored") {
        firstId = contact.hazard.id; secondId = contact.anchoredShield.id;
      } else if (contact.kind === "hazard-player") {
        firstId = contact.hazard.id; secondId = firstId;
      } else if (contact.kind === "shield-shield") {
        firstId = contact.shield.id; secondId = contact.anchoredShield.id;
      } else {
        firstId = contact.shield.id; secondId = firstId;
      }
      return [Math.min(firstId, secondId), Math.max(firstId, secondId)];
    };
    candidates.sort((first, second) => {
      const firstOrder = creationOrder(first);
      const secondOrder = creationOrder(second);
      return first.time - second.time
        || CONTACT_PRIORITY[first.kind] - CONTACT_PRIORITY[second.kind]
        || firstOrder[0] - secondOrder[0]
        || firstOrder[1] - secondOrder[1];
    });
    return candidates[0] ?? null;
  }

  function resolveContact(contact: NonNullable<ReturnType<typeof nextContact>>): void {
    if (contact.kind === "hazard-anchored") {
      const hazard = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.hazard.id);
      const anchoredShield = state.board.anchoredShields.find(({ id }) => id === contact.anchoredShield.id);
      if (!hazard || hazard.kind !== "hazard" || !anchoredShield) return;
      const hazardPosition = tilePosition(hazard);
      const anchoredPosition = { x: anchoredShield.column - 1, y: anchoredShield.row - 1 };
      state = {
        ...state,
        score: state.score + 1,
        impacts: [...state.impacts, {
          id: nextImpactId++, kind: "hazard-shield",
          x: (hazardPosition.x + anchoredPosition.x + 1) / 2,
          y: (hazardPosition.y + anchoredPosition.y + 1) / 2,
          remainingMilliseconds: 220,
        }],
        board: {
          ...state.board,
          movingShieldsAndHazards: state.board.movingShieldsAndHazards.filter(({ id }) => id !== hazard.id),
          anchoredShields: state.board.anchoredShields.filter(({ id }) => id !== anchoredShield.id),
        },
      };
      return;
    }
    if (contact.kind === "shield-player") {
      const shield = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.shield.id);
      if (!shield || shield.kind !== "shield") return;
      const [columnDelta, rowDelta] = DIRECTION_DELTAS[shield.direction];
      const anchoredShield: AnchoredShield = {
        id: shield.id,
        kind: "anchored-shield",
        column: state.board.player.column - columnDelta,
        row: state.board.player.row - rowDelta,
      };
      const shieldPosition = tilePosition(shield);
      const player = { x: state.board.player.column - 1, y: state.board.player.row - 1 };
      state = {
        ...state,
        impacts: [...state.impacts, {
          id: nextImpactId++, kind: contact.kind,
          x: (shieldPosition.x + player.x + 1) / 2,
          y: (shieldPosition.y + player.y + 1) / 2,
          remainingMilliseconds: 220,
        }],
        board: {
          ...state.board,
          movingShieldsAndHazards: state.board.movingShieldsAndHazards.filter(({ id }) => id !== shield.id),
          anchoredShields: [...state.board.anchoredShields, anchoredShield],
        },
      };
      return;
    }
    if (contact.kind === "shield-shield") {
      const shield = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.shield.id);
      if (!shield || shield.kind !== "shield") return;
      const [columnDelta, rowDelta] = DIRECTION_DELTAS[shield.direction];
      let column = contact.anchoredShield.column - columnDelta;
      let row = contact.anchoredShield.row - rowDelta;
      while (state.board.anchoredShields.some((anchored) => anchored.column === column && anchored.row === row)) {
        column -= columnDelta;
        row -= rowDelta;
      }
      if (column < 1 || column > state.board.columns || row < 1 || row > state.board.rows) {
        state = {
          ...state,
          board: {
            ...state.board,
            movingShieldsAndHazards: state.board.movingShieldsAndHazards.filter(({ id }) => id !== shield.id),
          },
        };
        return;
      }
      const anchoredShield: AnchoredShield = { id: shield.id, kind: "anchored-shield", column, row };
      state = {
        ...state,
        board: {
          ...state.board,
          movingShieldsAndHazards: state.board.movingShieldsAndHazards.filter(({ id }) => id !== shield.id),
          anchoredShields: [...state.board.anchoredShields, anchoredShield],
        },
      };
      return;
    }
    const currentHazard = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.hazard.id) ?? contact.hazard;
    const hazardPosition = tilePosition(currentHazard);
    if (contact.kind === "hazard-shield") {
      const currentMovingShield = state.board.movingShieldsAndHazards.find(({ id }) => id === contact.shield.id) ?? contact.shield;
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

  function resolveImmediateHazardShieldContacts(): void {
    while (true) {
      const contact = nextContact(0);
      if (contact?.kind !== "hazard-shield" && contact?.kind !== "hazard-anchored") return;
      resolveContact(contact);
    }
  }

  function moveMovingShieldOrHazards(elapsedMilliseconds: number): void {
    let remaining = elapsedMilliseconds;
    while (remaining > 0 && state.status === "running") {
      const contact = nextContact(remaining);
      const movement = contact?.time ?? remaining;
      advanceMovingTilesAndImpacts(movement);
      remaining -= movement;
      if (contact) {
        resolveContact(contact);
        while (state.status === "running") {
          const simultaneousContact = nextContact(0);
          if (!simultaneousContact) break;
          resolveContact(simultaneousContact);
        }
      }
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
