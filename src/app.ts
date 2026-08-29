import { createRunEngine, type Direction, type RunEngine } from "./run-engine";
import { directionFromKey, directionFromSwipe } from "./input";

const SVG_NS = "http://www.w3.org/2000/svg";

export function mountApp(root: HTMLElement): () => void {
  let engine: RunEngine | null = null;
  let pointerStart: { x: number; y: number } | null = null;
  let previousFrame = 0;
  let animationFrame = 0;

  function renderWelcome(): void {
    root.innerHTML = `<section class="welcome"><p class="eyebrow">Arcade survival</p><h1>Blocktile</h1><p>Move fast. Hold the Board.</p><button class="play" type="button">Play</button></section>`;
    root.querySelector("button")?.addEventListener("click", startRun);
  }

  function renderRun(): void {
    root.innerHTML = `<section class="run"><header><div><p class="eyebrow">Current Run</p><h1>Blocktile</h1></div><p class="score" aria-live="polite">Score <strong>0</strong></p></header><div class="board-shell"><svg class="board" role="grid" aria-label="Board" viewBox="0 0 8 16" tabindex="0"></svg></div><div class="controls" aria-label="Directional controls"><button type="button" data-direction="up" aria-label="Move up">↑</button><button type="button" data-direction="left" aria-label="Move left">←</button><button type="button" data-direction="down" aria-label="Move down">↓</button><button type="button" data-direction="right" aria-label="Move right">→</button></div><p class="hint">Swipe · Arrow keys · WASD</p></section>`;
    const board = root.querySelector<SVGSVGElement>(".board");
    if (!board) return;
    for (let row = 1; row <= 16; row += 1) {
      for (let column = 1; column <= 8; column += 1) {
        const cell = document.createElementNS(SVG_NS, "rect");
        cell.setAttribute("data-cell", ""); cell.setAttribute("x", String(column - 1)); cell.setAttribute("y", String(row - 1));
        cell.setAttribute("width", "1"); cell.setAttribute("height", "1"); board.append(cell);
      }
    }
    const player = document.createElementNS(SVG_NS, "rect");
    player.setAttribute("data-player", ""); player.setAttribute("width", "1"); player.setAttribute("height", "1"); player.setAttribute("rx", ".18"); board.append(player);
    root.querySelectorAll<HTMLButtonElement>("[data-direction]").forEach((button) => button.addEventListener("click", () => move(button.dataset.direction as Direction)));
    board.addEventListener("pointerdown", onPointerDown); board.addEventListener("pointerup", onPointerUp);
    updateRun();
  }

  function updateRun(): void {
    if (!engine) return;
    const state = engine.getState();
    const score = root.querySelector(".score strong"); if (score) score.textContent = String(state.score);
    const board = root.querySelector<SVGSVGElement>(".board");
    const player = root.querySelector("[data-player]");
    if (!board || !player) return;
    const tileIds = new Set(state.board.movingShieldsAndHazards.map(({ id }) => String(id)));
    board.querySelectorAll<SVGRectElement>("[data-moving-shield-or-hazard]").forEach((tile) => {
      if (!tileIds.has(tile.dataset.tileId ?? "")) tile.remove();
    });
    state.board.movingShieldsAndHazards.forEach((movingShieldOrHazard) => {
      let tile = board.querySelector<SVGRectElement>("[data-tile-id=\"" + movingShieldOrHazard.id + "\"]");
      if (!tile) {
        tile = document.createElementNS(SVG_NS, "rect");
        tile.setAttribute("data-moving-shield-or-hazard", "");
        tile.setAttribute("data-tile-id", String(movingShieldOrHazard.id));
        tile.setAttribute("rx", ".12");
        tile.setAttribute("opacity", "0.78"); tile.setAttribute("stroke-width", ".08");
        board.insertBefore(tile, player);
      }
      const horizontal = movingShieldOrHazard.direction === "left" || movingShieldOrHazard.direction === "right";
      const inset = 0.3 * (1 - Math.exp(-(movingShieldOrHazard.id - 1) / 10));
      const column = horizontal ? movingShieldOrHazard.column : movingShieldOrHazard.column - 1;
      const row = horizontal ? movingShieldOrHazard.row - 1 : movingShieldOrHazard.row;
      tile.setAttribute("x", String(column + inset));
      tile.setAttribute("y", String(row + inset));
      tile.setAttribute("width", String(1 - inset * 2));
      tile.setAttribute("height", String(1 - inset * 2));
      tile.setAttribute("data-kind", movingShieldOrHazard.kind);
      tile.setAttribute("data-direction", movingShieldOrHazard.direction);
      const name = movingShieldOrHazard.kind === "shield" ? "Moving Shield" : "Hazard";
      tile.setAttribute("aria-label", name + " traveling " + movingShieldOrHazard.direction + " in Lane " + movingShieldOrHazard.lane);
    });
    player.setAttribute("aria-label", `Player at column ${state.board.player.column}, row ${state.board.player.row}`);
    player.setAttribute("x", String(state.board.player.column - 1)); player.setAttribute("y", String(state.board.player.row - 1));
  }
  function startRun(): void { engine = createRunEngine(); renderRun(); startClock(); }
  function move(direction: Direction): void { engine?.act(direction); updateRun(); startClock(); }
  function startClock(): void {
    if (animationFrame || engine?.getState().status !== "running" || typeof requestAnimationFrame === "undefined") return;
    if (previousFrame === 0) previousFrame = performance.now();
    animationFrame = requestAnimationFrame(tick);
  }
  function tick(now: number): void { animationFrame = 0; engine?.advance(now - previousFrame); previousFrame = now; updateRun(); startClock(); }
  function onKeyDown(event: KeyboardEvent): void { const direction = directionFromKey(event.key); if (direction && engine) { event.preventDefault(); move(direction); } }
  function onPointerDown(event: PointerEvent): void { pointerStart = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event: PointerEvent): void {
    if (!pointerStart) return;
    const direction = directionFromSwipe(pointerStart.x, pointerStart.y, event.clientX, event.clientY);
    pointerStart = null; if (direction) move(direction);
  }

  window.addEventListener("keydown", onKeyDown); renderWelcome();
  return () => { window.removeEventListener("keydown", onKeyDown); if (animationFrame) cancelAnimationFrame(animationFrame); };
}
