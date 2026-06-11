import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SaveSystem, type SaveState } from './SaveSystem'
import { GridMap, CellType } from './GridMap'

// ── localStorage mock ──────────────────────────────────────────────────────
const store: Record<string, string> = {}
const mockStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
}

beforeEach(() => {
  vi.stubGlobal('localStorage', mockStorage)
  mockStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── encodeCells / decodeCells ──────────────────────────────────────────────
describe('SaveSystem.encodeCells / decodeCells', () => {
  it('round-trips a small buffer', () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4])
    const b64 = SaveSystem.encodeCells(buf)
    expect(typeof b64).toBe('string')
    const back = SaveSystem.decodeCells(b64)
    expect(Array.from(back)).toEqual([0, 1, 2, 3, 4])
  })

  it('round-trips a full GridMap cell buffer', () => {
    const g = new GridMap()
    g.set(50, 50, CellType.ROAD)
    g.set(51, 51, CellType.ZONE_RESIDENTIAL)
    g.set(99, 99, CellType.ZONE_COMMERCIAL)
    const cells = g.getCells()
    const b64 = SaveSystem.encodeCells(cells)
    const back = SaveSystem.decodeCells(b64)
    expect(back.length).toBe(cells.length)
    expect(back[50 * 200 + 50]).toBe(CellType.ROAD)
    expect(back[51 * 200 + 51]).toBe(CellType.ZONE_RESIDENTIAL)
    expect(back[99 * 200 + 99]).toBe(CellType.ZONE_COMMERCIAL)
  })
})

// ── write / load ───────────────────────────────────────────────────────────
describe('SaveSystem.write / load', () => {
  it('writes and reads back a valid state', () => {
    const state: SaveState = {
      version: 1,
      cells: SaveSystem.encodeCells(new Uint8Array(200 * 200)),
      balance: 12500,
      simSpeed: 2,
      simPaused: false,
    }
    SaveSystem.write(state)
    const loaded = SaveSystem.load()
    expect(loaded).not.toBeNull()
    expect(loaded!.balance).toBe(12500)
    expect(loaded!.simSpeed).toBe(2)
    expect(loaded!.simPaused).toBe(false)
  })

  it('returns null when nothing is saved', () => {
    expect(SaveSystem.load()).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    store['city-save-v1'] = '{ not valid json }'
    expect(SaveSystem.load()).toBeNull()
  })

  it('returns null for wrong version', () => {
    store['city-save-v1'] = JSON.stringify({ version: 2, cells: '', balance: 0, simSpeed: 1, simPaused: false })
    expect(SaveSystem.load()).toBeNull()
  })
})

// ── clear ─────────────────────────────────────────────────────────────────
describe('SaveSystem.clear', () => {
  it('removes the saved entry', () => {
    SaveSystem.write({ version: 1, cells: '', balance: 0, simSpeed: 1, simPaused: false })
    expect(SaveSystem.load()).not.toBeNull()
    SaveSystem.clear()
    expect(SaveSystem.load()).toBeNull()
  })
})

// ── checkVersion debounce ──────────────────────────────────────────────────
describe('SaveSystem.checkVersion', () => {
  it('does not fire save when version unchanged', () => {
    vi.useFakeTimers()
    const saveFn = vi.fn()
    const sys = new SaveSystem(0, saveFn)
    sys.checkVersion(0)
    vi.advanceTimersByTime(3_000)
    expect(saveFn).not.toHaveBeenCalled()
    sys.dispose()
    vi.useRealTimers()
  })

  it('fires save after 2 s when version changes', () => {
    vi.useFakeTimers()
    const saveFn = vi.fn()
    const sys = new SaveSystem(0, saveFn)
    sys.checkVersion(1)
    vi.advanceTimersByTime(1_999)
    expect(saveFn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(saveFn).toHaveBeenCalledOnce()
    sys.dispose()
    vi.useRealTimers()
  })

  it('resets debounce on rapid version changes', () => {
    vi.useFakeTimers()
    const saveFn = vi.fn()
    const sys = new SaveSystem(0, saveFn)
    sys.checkVersion(1)
    vi.advanceTimersByTime(1_500)
    sys.checkVersion(2)
    vi.advanceTimersByTime(1_500)
    expect(saveFn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(saveFn).toHaveBeenCalledOnce()
    sys.dispose()
    vi.useRealTimers()
  })
})

// ── GridMap.getCells / loadFrom ────────────────────────────────────────────
describe('GridMap.getCells / loadFrom', () => {
  it('getCells returns an independent copy', () => {
    const g = new GridMap()
    g.set(10, 10, CellType.ROAD)
    const snap = g.getCells()
    g.set(10, 10, CellType.EMPTY)
    expect(snap[10 * 200 + 10]).toBe(CellType.ROAD)  // snapshot is unchanged
  })

  it('loadFrom restores cell values', () => {
    const a = new GridMap()
    a.set(5, 5, CellType.ZONE_COMMERCIAL)
    const b = new GridMap()
    b.loadFrom(a.getCells())
    expect(b.get(5, 5)).toBe(CellType.ZONE_COMMERCIAL)
  })

  it('loadFrom ignores wrong-size data silently', () => {
    const g = new GridMap()
    const v = g.version
    g.loadFrom(new Uint8Array(5))  // wrong size
    expect(g.version).toBe(v)    // version unchanged — nothing loaded
  })
})
