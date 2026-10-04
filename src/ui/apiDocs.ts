/**
 * Single source of truth for the player-facing API.
 *
 * - The API Reference panel (ApiReference.tsx) renders API_DOCS.
 * - Monaco's JavaScript language service gets API_DTS (generated below) for
 *   autocomplete and hover docs.
 *
 * Signatures are written as TypeScript method signatures so they can be used
 * verbatim in the generated .d.ts — and they read fine as documentation.
 */

export interface ApiMethodDoc {
  /** TS method/property signature, e.g. "goToFloor(floor: number): void". */
  signature: string;
  description: string;
}

export interface ApiEventDoc {
  name: string;
  /** TS function type for the handler, e.g. "(floorNum: number) => void". */
  handler: string;
  description: string;
}

export interface ApiGroupDoc {
  /** Interface name used in the generated .d.ts ("" = docs-only group). */
  name: string;
  title: string;
  description: string;
  methods: ApiMethodDoc[];
  events?: ApiEventDoc[];
}

export const API_DOCS: ApiGroupDoc[] = [
  {
    name: "ElevatorProgram",
    title: "Your program",
    description: "Your code is an object with init() and (optionally) update().",
    methods: [
      {
        signature: "init(elevators: Elevator[], floors: Floor[]): void",
        description:
          "Called once when the simulation starts. Register your event handlers here.",
      },
      {
        signature: "update?(dt: number, elevators: Elevator[], floors: Floor[]): void",
        description:
          "Called every tick (~60x per simulated second). Optional — for advanced logic, e.g. reacting to loadFactor().",
      },
    ],
  },
  {
    name: "Elevator",
    title: "Elevator",
    description:
      "An elevator car you can control. Cars start with dark lanterns: declare its service direction (or it answers nobody).",
    methods: [
      {
        signature: "goToFloor(floor: number, jumpQueue?: boolean): void",
        description:
          "Queue a floor to visit. jumpQueue=true makes it the immediate destination.",
      },
      {
        signature: "stop(): void",
        description: "Clear the destination queue. If moving, stops at the next floor.",
      },
      {
        signature: "currentFloor(): number",
        description: "Current position in floor units (fractional while moving).",
      },
      {
        signature: "getPressedFloors(): number[]",
        description: "Floors that passengers inside this car have pressed.",
      },
      {
        signature: "loadFactor(): number",
        description: "Occupancy from 0 (empty) to 1 (full).",
      },
      {
        signature: 'destinationDirection(): "up" | "down" | "stopped"',
        description: "Direction of the immediate destination.",
      },
      {
        signature: "destinationQueue: number[]",
        description:
          "The live queue of floors to visit. Edit directly, then call checkDestinationQueue().",
      },
      {
        signature: "checkDestinationQueue(): void",
        description: "Re-validate destinationQueue after editing it directly.",
      },
      {
        signature: "maxPassengerCount(): number",
        description: "Maximum number of passengers this car can carry.",
      },
      {
        signature: "goingUpIndicator(on?: boolean): boolean",
        description:
          "Declare this car as serving up traffic: its stops clear up-hall lights and up-waiters board. Call with no argument to read the current state.",
      },
      {
        signature: "goingDownIndicator(on?: boolean): boolean",
        description:
          "Declare this car as serving down traffic: its stops clear down-hall lights and down-waiters board. Call with no argument to read the current state.",
      },
      {
        signature: "on(event: string, handler: (...args: any[]) => void): void",
        description: "Subscribe to one of the events below.",
      },
    ],
    events: [
      {
        name: "idle",
        handler: "() => void",
        description: "The car has nothing to do.",
      },
      {
        name: "floor_button_pressed",
        handler: "(floorNum: number) => void",
        description: "A passenger inside pressed a floor button.",
      },
      {
        name: "passing_floor",
        handler: '(floorNum: number, direction: "up" | "down") => void',
        description: "The car is passing a floor without stopping.",
      },
      {
        name: "stopped_at_floor",
        handler: "(floorNum: number) => void",
        description: "The car arrived and opened its doors.",
      },
    ],
  },
  {
    name: "Floor",
    title: "Floor",
    description: "A floor of the building.",
    methods: [
      {
        signature: "floorNum(): number",
        description: "The floor number (0 = ground).",
      },
      {
        signature: "upButtonLit(): boolean",
        description:
          "Whether the up call button is currently lit. Stays lit until an elevator boards a passenger going up.",
      },
      {
        signature: "downButtonLit(): boolean",
        description:
          "Whether the down call button is currently lit. Stays lit until an elevator boards a passenger going down.",
      },
      {
        signature: "on(event: string, handler: (...args: any[]) => void): void",
        description: "Subscribe to one of the events below.",
      },
    ],
    events: [
      {
        name: "up_button_pressed",
        handler: "() => void",
        description: "Someone on this floor wants to go up.",
      },
      {
        name: "down_button_pressed",
        handler: "() => void",
        description: "Someone on this floor wants to go down.",
      },
    ],
  },
];

/** Generate the .d.ts fed to Monaco from the same data (never edit by hand). */
function generateDts(): string {
  const interfaces = API_DOCS.map((group) => {
    const lines: string[] = [];
    // Specific event overloads first, so they win over the generic on() below.
    for (const e of group.events ?? []) {
      lines.push(`  /** ${e.description} */\n  on(event: "${e.name}", handler: ${e.handler}): void;`);
    }
    for (const m of group.methods) {
      lines.push(`  /** ${m.description} */\n  ${m.signature};`);
    }
    return `/** ${group.description} */\ninterface ${group.name} {\n${lines.join("\n")}\n}`;
  });
  return interfaces.join("\n\n") + "\n";
}

export const API_DTS = generateDts();
