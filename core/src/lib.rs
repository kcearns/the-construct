//! Game core for THE CONSTRUCT. Owns all simulation state: world generation,
//! player movement and collision, enemy AI, hit detection, waves, particles,
//! and the digital rain. The JS side is a pure renderer that reads the flat
//! f32 buffers exposed here directly from WASM linear memory.

use wasm_bindgen::prelude::*;

pub const WORLD: f32 = 300.0;
const HALF: f32 = WORLD / 2.0;
const N_BLOCKS: usize = 140;
const N_RAIN: usize = 500;
const MAX_ENEMIES: usize = 64;
const MAX_PARTICLES: usize = 1024;
const EYE: f32 = 1.7;
const FIRE_COOLDOWN: f32 = 0.11;
const RANGE: f32 = 120.0;

// Event bits returned from `step()`.
pub const EV_WAVE: u32 = 1;
pub const EV_HIT: u32 = 2;
pub const EV_KILL: u32 = 4;
pub const EV_DEATH: u32 = 8;
pub const EV_DAMAGE: u32 = 16;

// Shot kinds written to shot_buf[0].
const SHOT_MISS: f32 = 0.0;
const SHOT_WALL: f32 = 1.0;
const SHOT_ENEMY: f32 = 2.0;

// Per-item stride of each output buffer (floats).
pub const BLOCK_STRIDE: usize = 6; // cx cy cz w h d
pub const RAIN_STRIDE: usize = 3; // x y z
pub const ENEMY_STRIDE: usize = 6; // x y z yaw hit_t hp
pub const PARTICLE_STRIDE: usize = 4; // x y z life

struct Rng(u64);
impl Rng {
    fn new(seed: u32) -> Self {
        Rng(0x9E37_79B9_7F4A_7C15 ^ (seed as u64).wrapping_mul(0xD1B5_4A32_D192_ED03) | 1)
    }
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [0, 1).
    fn f(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f()
    }
}

#[derive(Clone, Copy)]
struct Aabb {
    min: [f32; 3],
    max: [f32; 3],
}
impl Aabb {
    fn from_center_size(c: [f32; 3], s: [f32; 3]) -> Self {
        Aabb {
            min: [c[0] - s[0] / 2.0, c[1] - s[1] / 2.0, c[2] - s[2] / 2.0],
            max: [c[0] + s[0] / 2.0, c[1] + s[1] / 2.0, c[2] + s[2] / 2.0],
        }
    }
    fn intersects(&self, o: &Aabb) -> bool {
        (0..3).all(|i| self.min[i] <= o.max[i] && self.max[i] >= o.min[i])
    }
    /// Slab test. Returns entry distance along the ray if it hits with t >= 0.
    fn ray(&self, o: [f32; 3], d: [f32; 3]) -> Option<f32> {
        let mut tmin = 0.0f32;
        let mut tmax = f32::INFINITY;
        for i in 0..3 {
            if d[i].abs() < 1e-6 {
                if o[i] < self.min[i] || o[i] > self.max[i] {
                    return None;
                }
            } else {
                let inv = 1.0 / d[i];
                let (mut t0, mut t1) = ((self.min[i] - o[i]) * inv, (self.max[i] - o[i]) * inv);
                if t0 > t1 {
                    core::mem::swap(&mut t0, &mut t1);
                }
                tmin = tmin.max(t0);
                tmax = tmax.min(t1);
                if tmin > tmax {
                    return None;
                }
            }
        }
        Some(tmin)
    }
}

struct Enemy {
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
    hp: i32,
    hit_t: f32,
    speed: f32,
    phase: f32,
}

struct Particle {
    p: [f32; 3],
    v: [f32; 3],
    life: f32,
}

struct Drop {
    x: f32,
    y: f32,
    z: f32,
    v: f32,
}

#[wasm_bindgen]
pub struct Game {
    rng: Rng,
    time: f32,

    blocks: Vec<Aabb>,
    block_buf: Vec<f32>,
    rain: Vec<Drop>,
    rain_buf: Vec<f32>,
    enemies: Vec<Enemy>,
    enemy_buf: Vec<f32>,
    particles: Vec<Particle>,
    particle_buf: Vec<f32>,

    // player
    px: f32,
    pz: f32,
    yaw: f32,
    pitch: f32,
    bob: f32,
    moving: f32,
    hp: f32,
    alive: bool,
    last_fire: f32,

    // progression
    kills: u32,
    wave: u32,
    wave_kills: u32,

    events: u32,
    // [px py pz yaw pitch hp kills wave alive active bob moving]
    state_buf: [f32; 12],
    // [kind ex ey ez]
    shot_buf: [f32; 4],
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Game {
        console_error_panic_hook::set_once();
        let mut g = Game {
            rng: Rng::new(seed),
            time: 0.0,
            blocks: Vec::with_capacity(N_BLOCKS),
            block_buf: Vec::with_capacity(N_BLOCKS * BLOCK_STRIDE),
            rain: Vec::with_capacity(N_RAIN),
            rain_buf: vec![0.0; N_RAIN * RAIN_STRIDE],
            enemies: Vec::with_capacity(MAX_ENEMIES),
            enemy_buf: vec![0.0; MAX_ENEMIES * ENEMY_STRIDE],
            particles: Vec::with_capacity(MAX_PARTICLES),
            particle_buf: vec![0.0; MAX_PARTICLES * PARTICLE_STRIDE],
            px: 0.0,
            pz: 0.0,
            yaw: 0.0,
            pitch: 0.0,
            bob: 0.0,
            moving: 0.0,
            hp: 100.0,
            alive: true,
            last_fire: -1.0,
            kills: 0,
            wave: 1,
            wave_kills: 0,
            events: 0,
            state_buf: [0.0; 12],
            shot_buf: [0.0; 4],
        };
        g.gen_world();
        g.gen_rain();
        g.reset();
        g
    }

    /// Restart the run. World and rain are kept; everything else resets.
    pub fn reset(&mut self) {
        self.enemies.clear();
        self.particles.clear();
        self.px = 0.0;
        self.pz = 0.0;
        self.yaw = 0.0;
        self.pitch = 0.0;
        self.bob = 0.0;
        self.hp = 100.0;
        self.alive = true;
        self.kills = 0;
        self.wave = 1;
        self.wave_kills = 0;
        self.last_fire = -1.0;
        for _ in 0..6 {
            self.spawn_enemy();
        }
        self.events = EV_WAVE;
        self.pack();
    }

    /// Mouse look. dx/dy are raw pointer-lock movement deltas in pixels.
    pub fn look(&mut self, dx: f32, dy: f32) {
        if !self.alive {
            return;
        }
        const SENS: f32 = 0.002;
        const LIM: f32 = core::f32::consts::FRAC_PI_2 - 0.01;
        self.yaw -= dx * SENS;
        self.pitch = (self.pitch - dy * SENS).clamp(-LIM, LIM);
    }

    /// Fire one shot along the view ray. Returns true if a shot was actually
    /// fired (cooldown permitting); result details land in `shot_buf`.
    pub fn fire(&mut self) -> bool {
        if !self.alive || self.time - self.last_fire < FIRE_COOLDOWN {
            return false;
        }
        self.last_fire = self.time;
        let o = [self.px, EYE, self.pz];
        let d = self.view_dir();

        // nearest wall
        let mut t_wall = RANGE;
        for b in &self.blocks {
            if let Some(t) = b.ray(o, d) {
                if t < t_wall {
                    t_wall = t;
                }
            }
        }
        // nearest enemy in front of that wall
        let mut best: Option<(usize, f32)> = None;
        for (i, e) in self.enemies.iter().enumerate() {
            if let Some(t) = ray_cylinder(o, d, e.x, e.z, 0.5, 0.0, 2.35) {
                if t < t_wall && best.map_or(true, |(_, bt)| t < bt) {
                    best = Some((i, t));
                }
            }
        }

        match best {
            Some((i, t)) => {
                self.shot_buf = [SHOT_ENEMY, o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
                self.events |= EV_HIT;
                let e = &mut self.enemies[i];
                e.hit_t = 0.15;
                e.hp -= 1;
                if e.hp <= 0 {
                    let at = [e.x, e.y + 1.0, e.z];
                    self.enemies.swap_remove(i);
                    self.burst(at);
                    self.kills += 1;
                    self.wave_kills += 1;
                    self.events |= EV_KILL;
                    self.spawn_enemy();
                    if self.wave_kills >= 5 + self.wave * 2 {
                        self.wave += 1;
                        self.wave_kills = 0;
                        self.spawn_enemy();
                        self.spawn_enemy();
                        self.events |= EV_WAVE;
                    }
                }
            }
            None => {
                let kind = if t_wall < RANGE { SHOT_WALL } else { SHOT_MISS };
                self.shot_buf = [kind, o[0] + d[0] * t_wall, o[1] + d[1] * t_wall, o[2] + d[2] * t_wall];
            }
        }
        true
    }

    /// Advance the simulation. `fwd`/`right` are in [-1, 1]. Returns the event
    /// bitmask accumulated since the previous step (including fire() events).
    pub fn step(&mut self, dt: f32, fwd: f32, right: f32, sprint: bool) -> u32 {
        let dt = dt.min(0.05).max(0.0);
        self.time += dt;

        self.move_player(dt, fwd, right, sprint);
        self.update_rain(dt);
        self.update_enemies(dt);
        self.update_particles(dt);

        if self.hp <= 0.0 && self.alive {
            self.hp = 0.0;
            self.alive = false;
            self.events |= EV_DEATH;
        }

        self.pack();
        let ev = self.events;
        self.events = 0;
        ev
    }

    // ---- buffer access (pointers into WASM linear memory) ----
    pub fn blocks_ptr(&self) -> *const f32 { self.block_buf.as_ptr() }
    pub fn blocks_len(&self) -> usize { self.block_buf.len() }
    pub fn rain_ptr(&self) -> *const f32 { self.rain_buf.as_ptr() }
    pub fn rain_len(&self) -> usize { self.rain_buf.len() }
    pub fn enemies_ptr(&self) -> *const f32 { self.enemy_buf.as_ptr() }
    pub fn enemy_count(&self) -> usize { self.enemies.len() }
    pub fn particles_ptr(&self) -> *const f32 { self.particle_buf.as_ptr() }
    pub fn particle_count(&self) -> usize { self.particles.len() }
    pub fn state_ptr(&self) -> *const f32 { self.state_buf.as_ptr() }
    pub fn shot_ptr(&self) -> *const f32 { self.shot_buf.as_ptr() }
    pub fn max_enemies(&self) -> usize { MAX_ENEMIES }
    pub fn max_particles(&self) -> usize { MAX_PARTICLES }
    pub fn world_size(&self) -> f32 { WORLD }
}

// ---------- internals ----------
impl Game {
    fn view_dir(&self) -> [f32; 3] {
        let (sy, cy) = self.yaw.sin_cos();
        let (sp, cp) = self.pitch.sin_cos();
        [-sy * cp, sp, -cy * cp]
    }

    fn gen_world(&mut self) {
        while self.blocks.len() < N_BLOCKS {
            let w = self.rng.range(3.0, 10.0);
            let h = 4.0 + self.rng.f().powi(2) * 40.0;
            let d = self.rng.range(3.0, 10.0);
            let x = self.rng.range(-HALF, HALF);
            let z = self.rng.range(-HALF, HALF);
            if x.hypot(z) < 14.0 {
                continue;
            }
            let c = [x, h / 2.0, z];
            let s = [w, h, d];
            self.blocks.push(Aabb::from_center_size(c, s));
            self.block_buf.extend_from_slice(&[c[0], c[1], c[2], s[0], s[1], s[2]]);
        }
    }

    fn gen_rain(&mut self) {
        for _ in 0..N_RAIN {
            self.rain.push(Drop {
                x: self.rng.range(-HALF, HALF),
                y: self.rng.range(0.0, 70.0),
                z: self.rng.range(-HALF, HALF),
                v: self.rng.range(6.0, 20.0),
            });
        }
    }

    fn spawn_enemy(&mut self) {
        if self.enemies.len() >= MAX_ENEMIES {
            return;
        }
        let a = self.rng.range(0.0, core::f32::consts::TAU);
        let r = self.rng.range(28.0, 58.0);
        let speed = 3.5 + self.wave as f32 * 0.35 + self.rng.f();
        self.enemies.push(Enemy {
            x: self.px + a.cos() * r,
            y: 0.0,
            z: self.pz + a.sin() * r,
            yaw: 0.0,
            hp: 2,
            hit_t: 0.0,
            speed,
            phase: self.rng.range(0.0, 6.28),
        });
    }

    fn burst(&mut self, at: [f32; 3]) {
        for _ in 0..24 {
            if self.particles.len() >= MAX_PARTICLES {
                return;
            }
            let p = [
                at[0] + self.rng.range(-0.5, 0.5),
                at[1] + self.rng.range(0.0, 1.5),
                at[2] + self.rng.range(-0.5, 0.5),
            ];
            let v = [self.rng.range(-4.0, 4.0), self.rng.range(0.0, 8.0), self.rng.range(-4.0, 4.0)];
            self.particles.push(Particle { p, v, life: 0.9 });
        }
    }

    fn player_box(&self) -> Aabb {
        Aabb::from_center_size([self.px, 0.9, self.pz], [0.7, 1.8, 0.7])
    }

    fn move_player(&mut self, dt: f32, fwd: f32, right: f32, sprint: bool) {
        if !self.alive {
            self.moving = 0.0;
            return;
        }
        let (mut fx, mut rx) = (fwd.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0));
        let len = (fx * fx + rx * rx).sqrt();
        self.moving = if len > 0.0 { 1.0 } else { 0.0 };
        if len > 1.0 {
            fx /= len;
            rx /= len;
        }
        let speed = if sprint { 16.0 } else { 8.0 };
        let (sy, cy) = self.yaw.sin_cos();
        // camera forward (-Z rotated by yaw) and right (+X rotated by yaw)
        let dx = (-sy * fx + cy * rx) * speed * dt;
        let dz = (-cy * fx - sy * rx) * speed * dt;

        // per-axis resolve so we slide along walls
        for (axis, delta) in [(0usize, dx), (2usize, dz)] {
            if delta == 0.0 {
                continue;
            }
            let (ox, oz) = (self.px, self.pz);
            if axis == 0 {
                self.px = (self.px + delta).clamp(-HALF, HALF);
            } else {
                self.pz = (self.pz + delta).clamp(-HALF, HALF);
            }
            let pb = self.player_box();
            if self.blocks.iter().any(|b| b.intersects(&pb)) {
                self.px = ox;
                self.pz = oz;
            }
        }
        self.bob += dt * if sprint { 14.0 } else { 9.0 } * self.moving;
    }

    fn update_rain(&mut self, dt: f32) {
        for (i, d) in self.rain.iter_mut().enumerate() {
            d.y -= d.v * dt;
            if d.y < -10.0 {
                d.y = 70.0;
            }
            let o = i * RAIN_STRIDE;
            self.rain_buf[o] = d.x;
            self.rain_buf[o + 1] = d.y;
            self.rain_buf[o + 2] = d.z;
        }
    }

    fn update_enemies(&mut self, dt: f32) {
        let mut touching = false;
        let t = self.time;
        for e in &mut self.enemies {
            let (tx, tz) = (self.px - e.x, self.pz - e.z);
            let d = tx.hypot(tz);
            e.yaw = tx.atan2(tz);
            if d > 1.6 {
                e.x += tx / d * e.speed * dt;
                e.z += tz / d * e.speed * dt;
            } else {
                touching = true;
            }
            e.y = (t * 5.0 + e.phase).sin() * 0.06;
            e.hit_t = (e.hit_t - dt).max(0.0);
        }
        if touching && self.alive {
            self.hp -= 22.0 * dt;
            self.events |= EV_DAMAGE;
        }
    }

    fn update_particles(&mut self, dt: f32) {
        self.particles.retain_mut(|p| {
            p.v[1] -= 18.0 * dt;
            for i in 0..3 {
                p.p[i] += p.v[i] * dt;
            }
            if p.p[1] < 0.0 {
                p.p[1] = 0.0;
                p.v[1] *= -0.4;
                p.v[0] *= 0.7;
                p.v[2] *= 0.7;
            }
            p.life -= dt;
            p.life > 0.0
        });
    }

    fn pack(&mut self) {
        for (i, e) in self.enemies.iter().enumerate() {
            let o = i * ENEMY_STRIDE;
            self.enemy_buf[o..o + ENEMY_STRIDE]
                .copy_from_slice(&[e.x, e.y, e.z, e.yaw, e.hit_t, e.hp as f32]);
        }
        for (i, p) in self.particles.iter().enumerate() {
            let o = i * PARTICLE_STRIDE;
            self.particle_buf[o..o + PARTICLE_STRIDE].copy_from_slice(&[p.p[0], p.p[1], p.p[2], p.life]);
        }
        let py = EYE + self.bob.sin() * 0.035 * self.moving;
        self.state_buf = [
            self.px, py, self.pz, self.yaw, self.pitch,
            self.hp, self.kills as f32, self.wave as f32,
            if self.alive { 1.0 } else { 0.0 },
            self.enemies.len() as f32, self.bob, self.moving,
        ];
    }
}

/// Ray vs. vertical cylinder centred at (cx, cz) with radius r, spanning y in [y0, y1].
fn ray_cylinder(o: [f32; 3], d: [f32; 3], cx: f32, cz: f32, r: f32, y0: f32, y1: f32) -> Option<f32> {
    let (ox, oz) = (o[0] - cx, o[2] - cz);
    let a = d[0] * d[0] + d[2] * d[2];
    if a < 1e-8 {
        return None;
    }
    let b = 2.0 * (ox * d[0] + oz * d[2]);
    let c = ox * ox + oz * oz - r * r;
    let disc = b * b - 4.0 * a * c;
    if disc < 0.0 {
        return None;
    }
    let t = (-b - disc.sqrt()) / (2.0 * a);
    if t <= 0.0 {
        return None;
    }
    let y = o[1] + d[1] * t;
    (y >= y0 && y <= y1).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_is_deterministic_and_clear_at_spawn() {
        let a = Game::new(7);
        let b = Game::new(7);
        assert_eq!(a.block_buf, b.block_buf);
        assert_eq!(a.blocks.len(), N_BLOCKS);
        let spawn = a.player_box();
        assert!(!a.blocks.iter().any(|bl| bl.intersects(&spawn)));
    }

    #[test]
    fn enemies_close_in_and_deal_damage() {
        let mut g = Game::new(1);
        let hp0 = g.hp;
        for _ in 0..60 * 60 {
            g.step(1.0 / 60.0, 0.0, 0.0, false);
        }
        assert!(g.hp < hp0, "enemies should reach and damage a stationary player");
    }

    #[test]
    fn shooting_an_enemy_in_front_kills_it_in_two() {
        let mut g = Game::new(3);
        g.enemies.clear();
        // yaw 0 looks down -Z; put an agent 10 units ahead.
        g.enemies.push(Enemy { x: 0.0, y: 0.0, z: -10.0, yaw: 0.0, hp: 2, hit_t: 0.0, speed: 0.0, phase: 0.0 });
        assert!(g.fire());
        assert_eq!(g.shot_buf[0], SHOT_ENEMY);
        assert!(!g.fire(), "cooldown should block an immediate second shot");
        for _ in 0..4 {
            g.step(0.05, 0.0, 0.0, false); // dt is clamped to 50 ms per step
        }
        assert!(g.fire());
        let ev = g.step(0.016, 0.0, 0.0, false);
        assert!(ev & EV_KILL != 0);
        assert_eq!(g.kills, 1);
        assert!(!g.particles.is_empty());
    }

    #[test]
    fn walls_block_movement() {
        let mut g = Game::new(5);
        g.blocks.clear();
        g.blocks.push(Aabb::from_center_size([0.0, 5.0, -3.0], [4.0, 10.0, 2.0]));
        for _ in 0..120 {
            g.step(1.0 / 60.0, 1.0, 0.0, true);
        }
        assert!(g.pz > -2.0 - 0.36, "player should stop at the wall, got z={}", g.pz);
    }
}
