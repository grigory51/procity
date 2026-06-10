/** Simulation speed multipliers available to the player. */
export type SimSpeed = 1 | 2 | 4

export interface SimTimeState {
  isPaused: boolean
  speed: SimSpeed
  gameDay: number
  /** In-game hour, 0–23. */
  gameHour: number
}

type ScaledTickFn = (scaledDelta: number) => void
type HourFn = (state: SimTimeState) => void
type StateFn = (state: SimTimeState) => void

/**
 * SimulationEngine drives the in-game time loop and decouples game systems
 * from the render frame rate.
 *
 * Time contract: 1 real second at 1× speed = 1 in-game hour.
 * Economy and citizen tick callbacks receive the scaled delta in seconds.
 *
 * Speed modes: 1× | 2× | 4×, plus pause.
 * Hotkeys and UI buttons both call pause() / resume() / setSpeed().
 */
export class SimulationEngine {
  private _isPaused = false
  private _speed: SimSpeed = 1
  private _gameDay = 1
  private _gameHour = 6  // start at 06:00
  private _hourAccum = 0 // fractional hours accumulated since last whole-hour tick

  private _tickSubs: ScaledTickFn[] = []
  private _hourSubs: HourFn[]       = []
  private _stateSubs: StateFn[]     = []

  // ── Getters ────────────────────────────────────────────────────────────────

  get isPaused(): boolean  { return this._isPaused }
  get speed(): SimSpeed    { return this._speed }
  get gameDay(): number    { return this._gameDay }
  get gameHour(): number   { return this._gameHour }

  get state(): SimTimeState {
    return {
      isPaused: this._isPaused,
      speed:    this._speed,
      gameDay:  this._gameDay,
      gameHour: this._gameHour,
    }
  }

  // ── Speed / pause control ──────────────────────────────────────────────────

  pause(): void {
    if (this._isPaused) return
    this._isPaused = true
    this._emitState()
  }

  resume(): void {
    if (!this._isPaused) return
    this._isPaused = false
    this._emitState()
  }

  togglePause(): void {
    this._isPaused ? this.resume() : this.pause()
  }

  /** Set playback speed and automatically resume if paused. */
  setSpeed(speed: SimSpeed): void {
    this._speed = speed
    if (this._isPaused) {
      this._isPaused = false
    }
    this._emitState()
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /** Fires each non-paused frame with the scaled delta (seconds). */
  onTick(fn: ScaledTickFn): void { this._tickSubs.push(fn) }

  /** Fires once per in-game hour that elapses. */
  onHour(fn: HourFn): void { this._hourSubs.push(fn) }

  /** Fires whenever pause state or speed changes. */
  onStateChange(fn: StateFn): void { this._stateSubs.push(fn) }

  // ── Main tick ─────────────────────────────────────────────────────────────

  /**
   * Call once per render frame with real elapsed seconds (caller should cap
   * to avoid large jumps when the tab was backgrounded, e.g. min(dt, 0.1)).
   */
  tick(realDelta: number): void {
    if (this._isPaused || realDelta <= 0) return

    const scaledDelta = realDelta * this._speed

    // Advance in-game clock: 1 scaled-second = 1 in-game hour
    this._hourAccum += scaledDelta
    while (this._hourAccum >= 1.0) {
      this._hourAccum -= 1.0
      this._gameHour++
      if (this._gameHour >= 24) {
        this._gameHour = 0
        this._gameDay++
      }
      const s = this.state
      for (const fn of this._hourSubs) fn(s)
    }

    // Dispatch scaled delta to all registered tick subscribers (economy, citizens, …)
    for (const fn of this._tickSubs) fn(scaledDelta)
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _emitState(): void {
    const s = this.state
    for (const fn of this._stateSubs) fn(s)
  }
}
