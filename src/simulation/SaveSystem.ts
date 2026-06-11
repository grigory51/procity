import type { SimSpeed } from './SimulationEngine'

const SAVE_KEY = 'city-save-v1'
const DEBOUNCE_MS = 2_000

export interface SaveState {
  version: 1
  cells: string    // base64-encoded Uint8Array
  balance: number
  simSpeed: SimSpeed
  simPaused: boolean
}

export class SaveSystem {
  private _lastVersion: number
  private _timer: ReturnType<typeof setTimeout> | null = null
  private readonly _saveFn: () => void

  constructor(initialVersion: number, saveFn: () => void) {
    this._lastVersion = initialVersion
    this._saveFn = saveFn
  }

  /** Schedules a debounced save 2 s after the last call. */
  scheduleSave(): void {
    if (this._timer !== null) clearTimeout(this._timer)
    this._timer = setTimeout(() => {
      this._timer = null
      this._saveFn()
    }, DEBOUNCE_MS)
  }

  /** Call from the render loop. Schedules a save when GridMap.version changes. */
  checkVersion(current: number): void {
    if (current === this._lastVersion) return
    this._lastVersion = current
    this.scheduleSave()
  }

  /** Flushes a pending debounced save immediately. Safe to call when no save is pending. */
  flush(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
      this._saveFn()
    }
  }

  dispose(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }

  // ── Static helpers ──────────────────────────────────────────────────────

  static encodeCells(cells: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < cells.length; i++) binary += String.fromCharCode(cells[i])
    return btoa(binary)
  }

  static decodeCells(b64: string): Uint8Array {
    const binary = atob(b64)
    const arr = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
    return arr
  }

  static load(): SaveState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw) as SaveState
      if (data.version !== 1) return null
      return data
    } catch {
      return null
    }
  }

  static write(state: SaveState): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    } catch {
      // Quota exceeded or private browsing — ignore silently
    }
  }

  static clear(): void {
    localStorage.removeItem(SAVE_KEY)
  }
}
