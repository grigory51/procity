import { describe, it, expect } from 'vitest'
import { GridMap, CellType } from './GridMap'

describe('GridMap', () => {
  it('defaults all cells to EMPTY', () => {
    const g = new GridMap()
    expect(g.get(0, 0)).toBe(CellType.EMPTY)
    expect(g.get(100, 100)).toBe(CellType.EMPTY)
  })

  it('sets and gets ROAD', () => {
    const g = new GridMap()
    g.set(5, 7, CellType.ROAD)
    expect(g.get(5, 7)).toBe(CellType.ROAD)
  })

  it('sets and gets zone types', () => {
    const g = new GridMap()
    g.set(10, 20, CellType.ZONE_RESIDENTIAL)
    g.set(11, 21, CellType.ZONE_COMMERCIAL)
    g.set(12, 22, CellType.ZONE_INDUSTRIAL)
    expect(g.get(10, 20)).toBe(CellType.ZONE_RESIDENTIAL)
    expect(g.get(11, 21)).toBe(CellType.ZONE_COMMERCIAL)
    expect(g.get(12, 22)).toBe(CellType.ZONE_INDUSTRIAL)
  })

  it('returns EMPTY for out-of-bounds coords', () => {
    const g = new GridMap()
    expect(g.get(-1, 0)).toBe(CellType.EMPTY)
    expect(g.get(0, -1)).toBe(CellType.EMPTY)
    expect(g.get(200, 0)).toBe(CellType.EMPTY)
    expect(g.get(0, 200)).toBe(CellType.EMPTY)
  })

  it('set returns false for out-of-bounds', () => {
    const g = new GridMap()
    expect(g.set(-1, 0, CellType.ROAD)).toBe(false)
    expect(g.set(0, 200, CellType.ROAD)).toBe(false)
  })

  it('increments version on each set', () => {
    const g = new GridMap()
    const v0 = g.version
    g.set(0, 0, CellType.ROAD)
    expect(g.version).toBe(v0 + 1)
    g.set(1, 0, CellType.ZONE_RESIDENTIAL)
    expect(g.version).toBe(v0 + 2)
  })

  it('worldToCell / cellToWorld round-trips', () => {
    const g = new GridMap()
    const cx = 105
    const cz = 92
    const { x, z } = g.cellToWorld(cx, cz)
    const back = g.worldToCell(x, z)
    expect(back.x).toBe(cx)
    expect(back.z).toBe(cz)
  })

  it('maps origin world coords to grid centre cell', () => {
    const g = new GridMap()
    // world (0,0) should map to the centre cell (100, 100) of a 200×200 grid
    const { x, z } = g.worldToCell(0, 0)
    expect(x).toBe(100)
    expect(z).toBe(100)
  })
})
