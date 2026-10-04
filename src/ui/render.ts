import type { LevelDef, Snapshot } from "../engine/types";
import { DOOR_CLOSE_TIME, DOOR_OPEN_TIME } from "../engine/simulation";
import { PersonAnimator, type PersonDraw } from "./animator";

const COLORS = {
  bg: "#0e1320",
  floorLine: "#26304a",
  floorLabel: "#5a6a8f",
  shaft: "#151c2e",
  shaftEdge: "#26304a",
  carBody: "#2e3d5f",
  carDoor: "#0e1320",
  carOutline: "#4da3ff",
  passenger: "#e8ecf4",
  lampOff: "#33415f",
  lampUp: "#5dd39e",
  lampDown: "#ffb84d",
  callLit: "#ffb84d",
  callUnlit: "#33415f",
  queue: "#4da3ff",
  text: "#8fa1c7",
};

/** Fraction 0..1 of how open the doors are, derived from the door state machine. */
function doorOpenFraction(state: string, stateT: number): number {
  switch (state) {
    case "doors-opening":
      return 1 - Math.max(0, stateT) / DOOR_OPEN_TIME;
    case "doors-open":
      return 1;
    case "doors-closing":
      return Math.max(0, stateT) / DOOR_CLOSE_TIME;
    default:
      return 0;
  }
}

function loadColor(load: number): string {
  if (load < 0.5) return "#5dd39e";
  if (load < 0.85) return "#ffb84d";
  return "#ff5d5d";
}

/**
 * A little person silhouette: round head over a rounded-shoulder body.
 * (cx, yBottom) is where their feet stand; total height is `height`.
 */
function drawPerson(
  ctx: CanvasRenderingContext2D,
  cx: number,
  yBottom: number,
  height: number,
  color: string
): void {
  const headR = height * 0.24;
  const headCY = yBottom - height + headR;
  const shoulderY = headCY + headR * 0.95;
  const bodyW = height * 0.46;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2, yBottom);
  ctx.quadraticCurveTo(cx - bodyW * 0.6, shoulderY, cx, shoulderY);
  ctx.quadraticCurveTo(cx + bodyW * 0.6, shoulderY, cx + bodyW / 2, yBottom);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws the building cross-section: floors, shafts, elevator cars with
 * animated doors, hall call lights, destination queues — and all passengers,
 * whose positions come from the PersonAnimator so they glide/fade between
 * states instead of teleporting.
 */
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot | null,
  level: LevelDef,
  width: number,
  height: number,
  animator: PersonAnimator,
  dt: number
): void {
  const F = level.floorCount;
  const E = level.elevatorCount;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  if (
    !snap ||
    snap.floors.length !== F ||
    snap.elevators.length !== E
  ) {
    // No snapshot, or one from a different level shape (e.g. a stale
    // snapshot surviving a level switch) — render the empty building.
    if (snap) animator.clear();
    snap = null;
  }

  const padTop = 28;
  const padBottom = 30;
  // Shrink chrome on narrow canvases so the shafts keep their share.
  const padLeft = Math.max(28, Math.min(44, width * 0.085));
  const padRight = 16;
  const queueGap = Math.min(34, width * 0.08); // hall buttons + first figure
  const waitingAreaW = Math.min(150, width * 0.22);
  const shaftAreaW = width - padLeft - padRight - waitingAreaW;
  const shaftW = Math.min(84, shaftAreaW / E);
  const floorH = (height - padTop - padBottom) / F;
  const carH = floorH - 8;
  const carW = shaftW - 14;

  /** Canvas y of the top edge of a (fractional) floor position. */
  const yOf = (floor: number) =>
    padTop + (F - 1 - floor) * floorH + (floorH - carH) / 2;

  // Target slots for every visible passenger, filled in below.
  const people = new Map<number, PersonDraw>();

  // --- floors -------------------------------------------------------------
  for (let f = 0; f < F; f++) {
    const yTop = padTop + (F - 1 - f) * floorH;
    const yMid = yTop + floorH / 2;

    ctx.strokeStyle = COLORS.floorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft - 6, yTop + floorH);
    ctx.lineTo(width - padRight, yTop + floorH);
    ctx.stroke();

    ctx.fillStyle = COLORS.floorLabel;
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`F${f}`, 8, yMid);

    // Hall call lights: up (except on the top floor), down (except ground).
    // They sit between the shafts and the waiting queue — where the
    // buttons would be in the building.
    if (snap) {
      const fs = snap.floors[f];
      const hallX = padLeft + shaftW * E + queueGap * 0.33;
      if (f < F - 1)
        drawTriangle(ctx, hallX, yMid - 8, "up", fs.upButtonLit);
      if (f > 0)
        drawTriangle(ctx, hallX, yMid + 8, "down", fs.downButtonLit);
    }

    // Waiting passengers: queue of slots right of the hall-call lights.
    if (snap && snap.floors[f].waiting > 0) {
      const ids = snap.floors[f].waitingIds;
      const figH = Math.min(14, floorH * 0.42);
      const spacing = figH * 0.85 + 2;
      const maxFigs = Math.max(3, Math.floor((waitingAreaW - queueGap - 24) / spacing));
      const shown = Math.min(ids.length, maxFigs);
      const x0 = padLeft + shaftW * E + queueGap;
      for (let i = 0; i < shown; i++) {
        people.set(ids[i], {
          x: x0 + i * spacing + spacing / 2,
          y: yMid + figH / 2,
          figH,
          color: COLORS.passenger,
        });
      }
      const n = snap.floors[f].waiting;
      if (n > shown) {
        ctx.fillStyle = COLORS.text;
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText(`+${n - shown}`, x0 + shown * spacing + 4, yMid);
      }
    }
  }

  // Ground line
  ctx.strokeStyle = COLORS.shaftEdge;
  ctx.beginPath();
  ctx.moveTo(padLeft - 6, padTop + F * floorH);
  ctx.lineTo(width - padRight, padTop + F * floorH);
  ctx.stroke();

  // --- shafts & elevators ---------------------------------------------------
  for (let i = 0; i < E; i++) {
    const x0 = padLeft + i * shaftW + 7;

    // shaft
    ctx.fillStyle = COLORS.shaft;
    ctx.fillRect(x0 - 4, padTop, carW + 8, F * floorH);
    ctx.strokeStyle = COLORS.shaftEdge;
    ctx.strokeRect(x0 - 4, padTop, carW + 8, F * floorH);

    // shaft label
    ctx.fillStyle = COLORS.floorLabel;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`E${i + 1}`, x0 + carW / 2, height - 12);

    const elev = snap?.elevators[i];
    if (!elev) continue;

    // destination queue markers
    ctx.fillStyle = COLORS.queue;
    ctx.font = "9px ui-monospace, monospace";
    elev.queue.forEach((floor, qi) => {
      const y = yOf(floor) + carH / 2;
      ctx.globalAlpha = qi === 0 ? 1 : 0.45;
      ctx.beginPath();
      ctx.arc(x0 - 9, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // car
    const carX = x0;
    const carY = yOf(elev.y);
    const load = elev.capacity > 0 ? elev.passengers / elev.capacity : 0;

    ctx.fillStyle = COLORS.carBody;
    ctx.fillRect(carX, carY, carW, carH);
    ctx.strokeStyle = COLORS.carOutline;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(carX, carY, carW, carH);

    // doors (a central gap that opens)
    const open = doorOpenFraction(elev.state, elev.stateT);
    if (open > 0.01) {
      const gap = (carW * 0.72 * open) / 2;
      const cx = carX + carW / 2;
      ctx.fillStyle = COLORS.carDoor;
      ctx.fillRect(cx - gap, carY + 1.5, gap * 2, carH - 3);
    }

    // direction lamps
    drawLamp(ctx, carX + 5, carY + 5, elev.goingUpIndicator, COLORS.lampUp);
    drawLamp(
      ctx,
      carX + carW - 5,
      carY + 5,
      elev.goingDownIndicator,
      COLORS.lampDown
    );

    // Button panel: the distinct floors riders have pressed, shown like a
    // real elevator's lit panel at the top of the car.
    if (elev.pressedFloors.length > 0) {
      const text = elev.pressedFloors.join(" ");
      let size = 9;
      ctx.font = `bold ${size}px ui-monospace, monospace`;
      const maxW = carW - 10;
      while (ctx.measureText(text).width > maxW && size > 7) {
        size -= 0.5;
        ctx.font = `bold ${size}px ui-monospace, monospace`;
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(8, 11, 20, 0.9)";
      ctx.strokeText(text, carX + carW / 2, carY + size + 4);
      ctx.fillStyle = COLORS.callLit;
      ctx.fillText(text, carX + carW / 2, carY + size + 4);
    }

    // Riders: compute target slots. Tall (portrait) cars get staggered rows
    // that read as standing front and back; wide-short (landscape) cars line
    // everyone up across the floor instead. Destinations live on the button
    // panel above, not on each figure.
    const riderCount = elev.riders.length;
    if (riderCount > 0) {
      const color = loadColor(load);
      const feetYBase = carY + carH - 2;
      // While the car travels, riders are glued to their slot (zero lag);
      // only door-open moments get the glide/lerp treatment.
      const snap = elev.state === "moving";
      if (carH > carW) {
        const perRow = 3;
        const rowCount = Math.ceil(riderCount / perRow);
        const baseFigH = Math.min(14, carH * 0.3);
        const rowGap = baseFigH + 2; // feet-to-feet distance between rows
        for (let r = rowCount - 1; r >= 0; r--) {
          const row = elev.riders.slice(r * perRow, r * perRow + perRow);
          const isFront = r === 0;
          const figH = isFront ? baseFigH : baseFigH * 0.85;
          const feetY = feetYBase - r * rowGap;
          const spacing = Math.min(22, (carW - 8) / row.length);
          let px = carX + carW / 2 - (spacing * (row.length - 1)) / 2;
          for (const rider of row) {
            people.set(rider.id, { x: px, y: feetY, figH, color, snap });
            px += spacing;
          }
        }
      } else {
        const figH = Math.min(14, carH * 0.38);
        const spacing = (carW - 6) / riderCount;
        let px = carX + carW / 2 - (spacing * (riderCount - 1)) / 2;
        for (const rider of elev.riders) {
          people.set(rider.id, { x: px, y: feetYBase, figH, color, snap });
          px += spacing;
        }
      }
    }
  }

  // --- passengers (animated) ----------------------------------------------
  if (snap) {
    for (const p of animator.update(people, dt)) {
      ctx.globalAlpha = p.opacity;
      drawPerson(ctx, p.x, p.y, p.draw.figH, p.draw.color);
      ctx.globalAlpha = 1;
    }
  }
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: "up" | "down",
  lit: boolean
): void {
  ctx.fillStyle = lit ? COLORS.callLit : COLORS.callUnlit;
  ctx.beginPath();
  const s = 5;
  if (dir === "up") {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.lineTo(x + s, y + s);
  } else {
    ctx.moveTo(x, y + s);
    ctx.lineTo(x - s, y - s);
    ctx.lineTo(x + s, y - s);
  }
  ctx.closePath();
  ctx.fill();
}

function drawLamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  on: boolean,
  color: string
): void {
  ctx.fillStyle = on ? color : COLORS.lampOff;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
}
