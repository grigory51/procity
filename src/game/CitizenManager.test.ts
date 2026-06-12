import { describe, it, expect, vi } from 'vitest'

// Babylon.js mock — mirrors only what CitizenManager actually calls.
// vi.mock is hoisted so this runs before CitizenManager is imported.
vi.mock('@babylonjs/core', () => {
  function makeInstance(name: string) {
    return {
      name,
      position: { x: 0, y: 0, z: 0 },
      isPickable: true,
      dispose: vi.fn(),
    }
  }
  function makeMesh(name: string) {
    return {
      name,
      isPickable: true,
      material: null,
      setEnabled: vi.fn(),
      createInstance: vi.fn((iname: string) => makeInstance(iname)),
      dispose: vi.fn(),
    }
  }
  return {
    Scene: vi.fn(function () { return {} }),
    StandardMaterial: vi.fn(function () {
      return { diffuseColor: null, emissiveColor: null, specularColor: null, dispose: vi.fn() }
    }),
    Color3: vi.fn(function (r: number, g: number, b: number) { return { r, g, b } }),
    Vector3: vi.fn(function (x: number, y: number, z: number) { return { x, y, z } }),
    MeshBuilder: {
      CreateSphere: vi.fn((name: string) => makeMesh(name)),
    },
  }
})

import { Scene as MockScene } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { GridMap, CellType } from '../simulation/GridMap'
import { RoadGraph } from '../simulation/RoadGraph'
import { CitizenManager } from './CitizenManager'

// State values mirror the internal enum (CommutingToWork=0, AtWork=1, CommutingHome=2, AtHome=3)
const S_COMMUTING_TO_WORK = 0
const S_AT_WORK           = 1
const S_COMMUTING_HOME    = 2
const S_AT_HOME           = 3

function makeManager() {
  const gridMap   = new GridMap()
  const roadGraph = new RoadGraph(gridMap)
  const scene     = new (MockScene as unknown as new () => Scene)()
  const manager   = new CitizenManager(scene, gridMap, roadGraph)
  return { manager, gridMap, roadGraph }
}

// Minimal connected city:
//   Road:        x=3..7, z=5  (five cells)
//   Residential: (3,4) — adjacent to road at (3,5)
//   Commercial:  (7,6) — adjacent to road at (7,5)
// A* path home→work: (3,5)→(4,5)→(5,5)→(6,5)→(7,5), length 5
// Travel time at speed 4: (5-1)/4 = 1.0 s
function buildTestCity(gridMap: GridMap): void {
  for (let x = 3; x <= 7; x++) gridMap.set(x, 5, CellType.ROAD)
  gridMap.set(3, 4, CellType.ZONE_RESIDENTIAL)
  gridMap.set(7, 6, CellType.ZONE_COMMERCIAL)
}

// ── findNearestRoad ─────────────────────────────────────────────────────────

describe('CitizenManager.findNearestRoad', () => {
  it('returns null when no road exists within search radius', () => {
    const { manager } = makeManager()
    const result = (manager as any).findNearestRoad(100, 100)
    expect(result).toBeNull()
  })

  it('finds a directly adjacent road cell', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(10, 10, CellType.ROAD)
    const result = (manager as any).findNearestRoad(10, 9)
    expect(result).toEqual({ x: 10, z: 10 })
  })

  it('finds a road cell 2 cells away', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(10, 10, CellType.ROAD)
    const result = (manager as any).findNearestRoad(10, 8)
    expect(result).toEqual({ x: 10, z: 10 })
  })

  it('returns null when road is beyond search radius', () => {
    const { manager, gridMap } = makeManager()
    // Place road 20 cells away — outside ROAD_SEARCH_RADIUS (8)
    gridMap.set(50, 70, CellType.ROAD)
    const result = (manager as any).findNearestRoad(50, 50)
    expect(result).toBeNull()
  })

  it('finds an adjacent collector road cell', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(10, 10, CellType.ROAD_COLLECTOR)
    const result = (manager as any).findNearestRoad(10, 9)
    expect(result).toEqual({ x: 10, z: 10 })
  })

  it('finds an adjacent arterial road cell', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(10, 10, CellType.ROAD_ARTERIAL)
    const result = (manager as any).findNearestRoad(10, 9)
    expect(result).toEqual({ x: 10, z: 10 })
  })
})

// ── Citizen spawning ─────────────────────────────────────────────────────────

describe('CitizenManager spawning', () => {
  it('spawns no citizens when only residential zones exist', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(5, 5, CellType.ROAD)
    gridMap.set(5, 4, CellType.ZONE_RESIDENTIAL)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('spawns no citizens when only commercial zones exist', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(5, 5, CellType.ROAD)
    gridMap.set(5, 6, CellType.ZONE_COMMERCIAL)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('spawns no citizens when residential and commercial exist but have no road connection', () => {
    const { manager, gridMap } = makeManager()
    // Two isolated road stubs — A* returns null between them
    gridMap.set(5, 5, CellType.ROAD)
    gridMap.set(5, 4, CellType.ZONE_RESIDENTIAL)
    gridMap.set(50, 50, CellType.ROAD)
    gridMap.set(50, 51, CellType.ZONE_COMMERCIAL)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('spawns a citizen when residential + commercial + road connection all exist', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    expect(manager.count).toBe(1)
  })

  it('rebuilds citizens when grid version changes', () => {
    const { manager, gridMap } = makeManager()
    manager.update(0)
    expect(manager.count).toBe(0)

    buildTestCity(gridMap)
    manager.update(0)  // version changed → rebuildCitizens fires
    expect(manager.count).toBe(1)
  })

  it('removes citizens when their zone is demolished (grid version bump)', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    expect(manager.count).toBe(1)

    // Demolish residential zone
    gridMap.set(3, 4, CellType.EMPTY)
    manager.update(0)
    expect(manager.count).toBe(0)
  })
})

// ── Daily cycle (state-machine) ──────────────────────────────────────────────

describe('CitizenManager daily cycle', () => {
  function spawnAndGet(gridMap: GridMap, manager: CitizenManager) {
    buildTestCity(gridMap)
    manager.update(0)  // spawn
    return (manager as any).citizens[0]
  }

  it('citizen starts in CommutingToWork state', () => {
    const { manager, gridMap } = makeManager()
    const c = spawnAndGet(gridMap, manager)
    expect(c.state).toBe(S_COMMUTING_TO_WORK)
  })

  it('citizen arrives at AtWork after path traversal', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)

    // Path length=5, speed=4 → travel time = (5-1)/4 = 1.0 s; 1.5 s is enough
    manager.update(1.5)
    const c = (manager as any).citizens[0]
    expect(c.state).toBe(S_AT_WORK)
  })

  it('citizen transitions to CommutingHome after work dwell expires', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    manager.update(1.5)     // → AtWork, dwellTimer=5.0
    manager.update(5.1)     // → CommutingHome (dwell 5.0 s exceeded)
    const c = (manager as any).citizens[0]
    expect(c.state).toBe(S_COMMUTING_HOME)
  })

  it('citizen arrives at AtHome after return path traversal', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    manager.update(1.5)     // → AtWork
    manager.update(5.1)     // → CommutingHome
    manager.update(1.5)     // → AtHome
    const c = (manager as any).citizens[0]
    expect(c.state).toBe(S_AT_HOME)
  })

  it('citizen restarts workday after home dwell expires', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    manager.update(1.5)     // → AtWork
    manager.update(5.1)     // → CommutingHome
    manager.update(1.5)     // → AtHome, dwellTimer=3.0
    manager.update(3.1)     // → CommutingToWork again
    const c = (manager as any).citizens[0]
    expect(c.state).toBe(S_COMMUTING_TO_WORK)
    expect(c.pathProgress).toBe(0)
  })

  it('citizen marker position moves during commute', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    const c = (manager as any).citizens[0]
    const startX = c.marker.position.x

    manager.update(0.2)  // advance partway along path
    expect(c.marker.position.x).not.toBe(startX)
  })
})

// ── Sidewalk offset ──────────────────────────────────────────────────────────

describe('CitizenManager sidewalk offset', () => {
  it('first citizen gets positive sideOffset', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    const c = (manager as any).citizens[0]
    expect(c.sideOffset).toBe(0.40)
  })

  it('second citizen gets negative sideOffset (alternating)', () => {
    const { manager, gridMap } = makeManager()
    // Two residential zones sharing the same road so both can spawn
    for (let x = 3; x <= 7; x++) gridMap.set(x, 5, CellType.ROAD)
    gridMap.set(3, 4, CellType.ZONE_RESIDENTIAL)
    gridMap.set(4, 4, CellType.ZONE_RESIDENTIAL)
    gridMap.set(7, 6, CellType.ZONE_COMMERCIAL)
    manager.update(0)
    const citizens = (manager as any).citizens
    expect(citizens.length).toBeGreaterThanOrEqual(2)
    expect(citizens[0].sideOffset).toBe(0.40)
    expect(citizens[1].sideOffset).toBe(-0.40)
  })

  it('moving citizen z-position is offset from road center for horizontal path', () => {
    // Road is horizontal (z=5, x=3..7), so perpendicular is in the z-direction.
    // sideOffset=0.3, pz=1 → citizen z = roadCenter.z + 0.3
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    const c = (manager as any).citizens[0]
    const roadCenterZ = gridMap.cellToWorld(3, 5).z
    expect(Math.abs(c.marker.position.z - roadCenterZ)).toBeCloseTo(Math.abs(c.sideOffset), 5)
  })

  it('dwell position retains sidewalk offset (not road center)', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    manager.update(1.5)  // → AtWork
    const c = (manager as any).citizens[0]
    expect(c.state).toBe(S_AT_WORK)
    // Last path node is (7,5); perpendicular is still in z-direction.
    const roadCenterZ = gridMap.cellToWorld(7, 5).z
    expect(Math.abs(c.marker.position.z - roadCenterZ)).toBeCloseTo(Math.abs(c.sideOffset), 5)
  })

  it('citizen y position is 0.11 while commuting', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    manager.update(0.2)  // partial commute
    const c = (manager as any).citizens[0]
    expect(c.marker.position.y).toBe(0.11)
  })
})

// ── dispose ──────────────────────────────────────────────────────────────────

describe('CitizenManager.dispose', () => {
  it('disposes all citizen markers on dispose()', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    const citizens = (manager as any).citizens as any[]
    const markerDispose = citizens[0].marker.dispose

    manager.dispose()
    expect(markerDispose).toHaveBeenCalled()
    expect(manager.count).toBe(0)
  })
})
