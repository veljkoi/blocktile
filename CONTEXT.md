# Blocktile

Blocktile is an arcade survival game played on a fixed cell-based board. The player redirects shields while avoiding hazards and scores by causing hazards and shields to collide.

## Language

**Board**:
The 8-column by 16-row play area whose cells constrain tile positions.
_Avoid_: Grid, arena

**Lane**:
A single row or column along which a Moving Shield or Hazard travels from one Board edge to the opposite edge.

**Player**:
The user-directed tile whose destruction ends the game.
_Avoid_: Control tile, core

**Shield**:
A tile that travels across the Board and can become anchored when it meets the Player.
_Avoid_: Defence tile, guard

**Moving Shield**:
A Shield currently traveling along a row or column.

**Anchored Shield**:
A Shield fixed in a Board cell that the Player may push.
_Avoid_: Frozen defence tile

**Push**:
A one-cell displacement initiated by the Player. It can propagate through Anchored Shields and displace or redirect a Moving Shield at the end of the chain.

**Hazard**:
A tile that ends the game upon hitting the Player and scores a point when it collides with a Shield.
_Avoid_: Attack tile, striker

**Run**:
One continuous period of play, beginning with a fresh Board and ending when a Hazard hits the Player.
_Avoid_: Game, round
