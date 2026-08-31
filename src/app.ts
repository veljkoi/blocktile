import { createRunEngine, type Direction, type RunEngine } from "./run-engine";
import { directionFromKey, directionFromSwipe } from "./input";

const SVG_NS = "http://www.w3.org/2000/svg";
const BEST_SCORE_KEY = "blocktile.best-score";

function storedBestScore(): number {
  try {
    const score = Number.parseInt(localStorage.getItem(BEST_SCORE_KEY) ?? "0", 10);
    return Number.isFinite(score) && score >= 0 ? score : 0;
  } catch {
    return 0;
  }
}

function storeBestScore(score: number): void {
  try { localStorage.setItem(BEST_SCORE_KEY, String(score)); } catch { /* Storage can be unavailable. */ }
}

export function resetBestScore(): void {
  try { localStorage.removeItem(BEST_SCORE_KEY); } catch { /* Storage can be unavailable. */ }
}

export function mountApp(root: HTMLElement): () => void {
  let engine: RunEngine | null = null;
  let pointerStart: { x: number; y: number } | null = null;
  let previousFrame = 0;
  let animationFrame = 0;
  let bestScore = storedBestScore();

  function renderWelcome(): void {
    root.innerHTML = `<section class="welcome"><p class="eyebrow">Arcade survival</p><h1>Blocktile</h1><p>Move fast. Hold the Board.</p><button class="play" type="button">Play</button></section>`;
    root.querySelector("button")?.addEventListener("click", startRun);
  }

  function renderRun(): void {
    root.innerHTML = `<section class="run"><header class="run-header"><h1>BLOCKTILE</h1><div class="run-scores"><p class="score" aria-live="polite">SCORE <strong>0</strong></p><p class="best">BEST <strong></strong></p></div></header><div class="board-shell"><svg class="board" role="grid" aria-label="Board" viewBox="0 0 8 16" tabindex="0"></svg></div></section>`;
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
    board.addEventListener("pointerdown", onPointerDown); board.addEventListener("pointerup", onPointerUp);
    updateRun();
  }

  function updateRun(): void {
    if (!engine) return;
    const state = engine.getState();
    const score = root.querySelector(".score strong"); if (score) score.textContent = String(state.score);
    const best = root.querySelector(".best strong"); if (best) best.textContent = String(bestScore);
    if (state.score > bestScore) {
      bestScore = state.score;
      storeBestScore(bestScore);
      if (best) best.textContent = String(bestScore);
    }
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
      const column = horizontal ? movingShieldOrHazard.column : movingShieldOrHazard.column - 1;
      const row = horizontal ? movingShieldOrHazard.row - 1 : movingShieldOrHazard.row;
      tile.setAttribute("x", String(column));
      tile.setAttribute("y", String(row));
      tile.setAttribute("width", "1");
      tile.setAttribute("height", "1");
      tile.setAttribute("data-kind", movingShieldOrHazard.kind);
      tile.setAttribute("data-direction", movingShieldOrHazard.direction);
      const name = movingShieldOrHazard.kind === "shield" ? "Moving Shield" : "Hazard";
      tile.setAttribute("aria-label", name + " traveling " + movingShieldOrHazard.direction + " in Lane " + movingShieldOrHazard.lane);
    });
    player.setAttribute("aria-label", `Player at column ${state.board.player.column}, row ${state.board.player.row}`);
    player.setAttribute("x", String(state.board.player.column - 1)); player.setAttribute("y", String(state.board.player.row - 1));
    const impactIds = new Set(state.impacts.map(({ id }) => String(id)));
    board.querySelectorAll<SVGCircleElement>("[data-impact-id]").forEach((impact) => {
      if (!impactIds.has(impact.dataset.impactId ?? "")) impact.remove();
    });
    state.impacts.forEach((impact) => {
      if (board.querySelector("[data-impact-id=\"" + impact.id + "\"]")) return;
      const marker = document.createElementNS(SVG_NS, "circle");
      marker.setAttribute("data-impact-id", String(impact.id));
      marker.setAttribute("data-impact-kind", impact.kind);
      marker.setAttribute("cx", String(impact.x)); marker.setAttribute("cy", String(impact.y));
      marker.setAttribute("r", ".65"); board.append(marker);
    });
    const boardShell = root.querySelector(".board-shell");
    if (state.status === "ended" && !root.querySelector(".run-over")) {
      boardShell?.classList.add("run-ended");
      player.classList.add("player-frozen");
      boardShell?.insertAdjacentHTML("beforeend", "<section class=\"run-over\" role=\"dialog\" aria-label=\"Run over\"><div><h2>Run over</h2><p>Score " + state.score + " · Best " + bestScore + "</p><button class=\"play-again\" type=\"button\">Play again</button></div></section>");
      root.querySelector<HTMLButtonElement>(".play-again")?.addEventListener("click", startRun);
      root.querySelector<HTMLButtonElement>(".play-again")?.focus();
    }
  }
  function startRun(): void {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousFrame = 0;
    pointerStart = null;
    engine = createRunEngine();
    renderRun();
    startClock();
  }
  function move(direction: Direction): void { engine?.act(direction); updateRun(); startClock(); }
  function startClock(): void {
    if (animationFrame || engine?.getState().status !== "running" || typeof requestAnimationFrame === "undefined") return;
    if (previousFrame === 0) previousFrame = performance.now();
    animationFrame = requestAnimationFrame(tick);
  }
  function tick(now: number): void { animationFrame = 0; engine?.advance(now - previousFrame); previousFrame = now; updateRun(); startClock(); }
  function onKeyDown(event: KeyboardEvent): void { const direction = directionFromKey(event.key); if (direction && engine?.getState().status === "running") { event.preventDefault(); move(direction); } }
  function onPointerDown(event: PointerEvent): void { pointerStart = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event: PointerEvent): void {
    if (!pointerStart) return;
    const direction = directionFromSwipe(pointerStart.x, pointerStart.y, event.clientX, event.clientY);
    pointerStart = null; if (direction) move(direction);
  }

  window.addEventListener("keydown", onKeyDown); renderWelcome();
  return () => { window.removeEventListener("keydown", onKeyDown); if (animationFrame) cancelAnimationFrame(animationFrame); };
}
