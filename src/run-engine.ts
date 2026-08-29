export type Direction = "up" | "down" | "left" | "right";

export type BoardPosition = Readonly<{ column: number; row: number }>;

export type RunState = Readonly<{
  board: Readonly<{
    columns: 8;
    rows: 16;
    player: BoardPosition;
  }>;
  score: number;
  status: "running" | "ended";
  moving: boolean;
}>;

export type RunEngine = Readonly<{
  getState(): RunState;
  act(direction: Direction): void;
  advance(elapsedMilliseconds: number): void;
}>;

const MOVEMENT_MILLISECONDS = 120;

export function createRunEngine(): RunEngine {
  let state: RunState = {
    board: { columns: 8, rows: 16, player: { column: 4, row: 8 } },
    score: 0,
    status: "running",
    moving: false,
  };
  let movementRemaining = 0;
  let bufferedDirection: Direction | null = null;

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

  function advance(elapsedMilliseconds: number): void {
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

  return { getState: () => state, act, advance };
}
