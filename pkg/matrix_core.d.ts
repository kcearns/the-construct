/* tslint:disable */
/* eslint-disable */

export class Game {
    free(): void;
    [Symbol.dispose](): void;
    blocks_len(): number;
    blocks_ptr(): number;
    enemies_ptr(): number;
    enemy_count(): number;
    /**
     * Fire one shot along the view ray. Returns true if a shot was actually
     * fired (cooldown permitting); result details land in `shot_buf`.
     */
    fire(): boolean;
    /**
     * Mouse look. dx/dy are raw pointer-lock movement deltas in pixels.
     */
    look(dx: number, dy: number): void;
    max_enemies(): number;
    max_particles(): number;
    constructor(seed: number);
    particle_count(): number;
    particles_ptr(): number;
    rain_len(): number;
    rain_ptr(): number;
    /**
     * Restart the run. World and rain are kept; everything else resets.
     */
    reset(): void;
    shot_ptr(): number;
    state_ptr(): number;
    /**
     * Advance the simulation. `fwd`/`right` are in [-1, 1]. Returns the event
     * bitmask accumulated since the previous step (including fire() events).
     */
    step(dt: number, fwd: number, right: number, sprint: boolean): number;
    world_size(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_game_free: (a: number, b: number) => void;
    readonly game_blocks_len: (a: number) => number;
    readonly game_blocks_ptr: (a: number) => number;
    readonly game_enemies_ptr: (a: number) => number;
    readonly game_enemy_count: (a: number) => number;
    readonly game_fire: (a: number) => number;
    readonly game_look: (a: number, b: number, c: number) => void;
    readonly game_max_enemies: (a: number) => number;
    readonly game_max_particles: (a: number) => number;
    readonly game_new: (a: number) => number;
    readonly game_particle_count: (a: number) => number;
    readonly game_particles_ptr: (a: number) => number;
    readonly game_rain_len: (a: number) => number;
    readonly game_rain_ptr: (a: number) => number;
    readonly game_reset: (a: number) => void;
    readonly game_shot_ptr: (a: number) => number;
    readonly game_state_ptr: (a: number) => number;
    readonly game_step: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly game_world_size: (a: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
