/**
 * Tracks individual passengers across frames so the renderer can animate
 * them instead of teleporting:
 *
 * - Boarding: a person's target slot moves from the floor queue into the
 *   car, and the lerp makes them glide across.
 * - Repositioning: when the queue shuffles forward, targets shift and the
 *   people visibly sidle into their new spots.
 * - Exiting: a person who vanishes from the snapshot (delivered) keeps a
 *   brief "ghost" that walks out of the car and fades.
 * - Spawning: new people fade in where they appear.
 */

export interface PersonDraw {
  /** Target feet position. */
  x: number;
  y: number;
  figH: number;
  color: string;
  /** Position exactly (no lerp) — riders glued to a moving car. */
  snap?: boolean;
}

export interface AnimatedPerson {
  id: number;
  x: number;
  y: number;
  opacity: number;
  draw: PersonDraw;
}

interface TrackedPerson {
  x: number;
  y: number;
  opacity: number;
  leaving: boolean;
  leaveT: number;
  draw: PersonDraw;
}

const LERP_RATE = 10; // 1/s — how snappily people track their target slot
const FADE_IN_RATE = 5; // opacity per second when appearing
const EXIT_DURATION = 0.7; // seconds to walk out and fade
const EXIT_SPEED = 45; // px/s walking toward the door side

export class PersonAnimator {
  private people = new Map<number, TrackedPerson>();

  clear(): void {
    this.people.clear();
  }

  /**
   * Reconcile tracked people with the current snapshot's targets and advance
   * the animation by dt seconds. Returns everyone to draw this frame.
   */
  update(targets: Map<number, PersonDraw>, dt: number): AnimatedPerson[] {
    // People who vanished from the snapshot just got off — start their exit.
    for (const [id, p] of this.people) {
      if (!targets.has(id) && !p.leaving) {
        p.leaving = true;
        p.leaveT = 0;
      }
    }
    // Upsert current targets; new people appear at their slot and fade in.
    for (const [id, draw] of targets) {
      const p = this.people.get(id);
      if (!p) {
        this.people.set(id, {
          x: draw.x,
          y: draw.y,
          opacity: 0,
          leaving: false,
          leaveT: 0,
          draw,
        });
      } else {
        p.draw = draw;
      }
    }

    const out: AnimatedPerson[] = [];
    const f = 1 - Math.exp(-LERP_RATE * dt);
    for (const [id, p] of this.people) {
      if (p.leaving) {
        p.leaveT += dt;
        p.x -= EXIT_SPEED * dt;
        p.opacity = Math.max(0, 1 - p.leaveT / EXIT_DURATION);
        if (p.opacity <= 0) {
          this.people.delete(id);
          continue;
        }
      } else if (p.draw.snap) {
        // Glued to a moving car: zero lag.
        p.x = p.draw.x;
        p.y = p.draw.y;
        p.opacity = Math.min(1, p.opacity + FADE_IN_RATE * dt);
      } else {
        p.x += (p.draw.x - p.x) * f;
        p.y += (p.draw.y - p.y) * f;
        p.opacity = Math.min(1, p.opacity + FADE_IN_RATE * dt);
      }
      out.push({ id, x: p.x, y: p.y, opacity: p.opacity, draw: p.draw });
    }
    return out;
  }
}
