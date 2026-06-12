import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => {
  function makeInstance(name: string) {
    return {
      name,
      position: { x: 0, y: 0, z: 0 },
      rotationQuaternion: null,
      isPickable: true,
      material: null,
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
  const Up = vi.fn(() => ({ x: 0, y: 1, z: 0 }))
  const Vec3Fn = vi.fn(function (x: number, y: number, z: number) { return { x, y, z } }) as any
  Vec3Fn.Up = Up
  return {
    Scene: vi.fn(function () { return {} }),
    StandardMaterial: vi.fn(function () {
      return { diffuseColor: null, emissiveColor: null, specularColor: null, dispose: vi.fn() }
    }),
    Color3: vi.fn(function (r: number, g: number, b: number) { return { r, g, b } }),
    Vector3: Vec3Fn,
    Quaternion: {
      RotationAxis: vi.fn((_axis: unknown, angle: number) => ({ axis: _axis, angle })),
    },
    MeshBuilder: {
      CreateBox: vi.fn((name: string) => makeMesh(name)),
    },
  }
})

import { Scene as MockScene } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { GridMap, CellType } from '../simulation/GridMap'
import { RoadGraph } from '../simulation/RoadGraph'
import { VehicleManager } from './VehicleManager'

const S_COMMUTING_TO_WORK = 0
const S_AT_WORK           = 1
const S_COMMUTING_HOME    = 2
const S_AT_HOME           = 3

function makeManager() {
  const gridMap   = new GridMap()
  const roadGraph = new RoadGraph(gridMap)
  const scene     = new (MockScene as unknown as new () => Scene)()
  const manager   = new VehicleManager(scene, gridMap, roadGraph)
  return { manager, gridMap, roadGraph }
}

// Minimal connected city:
//   Road:        x=3..7, z=5
//   Residential: (3,4)
//   Commercial:  (7,6)
// Path: (3,5)→(4,5)→(5,5)→(6,5)→(7,5), length 5
// Travel time at speed 8: (5-1)/8 = 0.5 s
function buildTestCity(gridMap: GridMap): void {
  for (let x = 3; x <= 7; x++) gridMap.set(x, 5, CellType.ROAD)
  gridMap.set(3, 4, CellType.ZONE_RESIDENTIAL)
  gridMap.set(7, 6, CellType.ZONE_COMMERCIAL)
}

// ── findNearestRoad ─────────────────────────────────────────────────────────

describe('VehicleManager.findNearestRoad', () => {
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

// ── Vehicle spawning ─────────────────────────────────────────────────────────

describe('VehicleManager spawning', () => {
  it('spawns no vehicles when only residential zones exist', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(5, 5, CellType.ROAD)
    gridMap.set(5, 4, CellType.ZONE_RESIDENTIAL)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('spawns no vehicles when only commercial zones exist', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(5, 5, CellType.ROAD)
    gridMap.set(5, 6, CellType.ZONE_COMMERCIAL)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('spawns no vehicles when no road connection between zones', () => {
    const { manager, gridMap } = makeManager()
    gridMap.set(5, 5, CellType.ROAD)
    gridMap.set(5, 4, CellType.ZONE_RESIDENTIAL)
    gridMap.set(50, 50, CellType.ROAD)
    gridMap.set(50, 51, CellType.ZONE_COMMERCIAL)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('spawns a vehicle when residential + commercial + road connection all exist', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    expect(manager.count).toBe(1)
  })

  it('rebuilds vehicles when grid version changes', () => {
    const { manager, gridMap } = makeManager()
    manager.update(0)
    expect(manager.count).toBe(0)

    buildTestCity(gridMap)
    manager.update(0)
    expect(manager.count).toBe(1)
  })

  it('removes vehicles when their zone is demolished', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    expect(manager.count).toBe(1)

    gridMap.set(3, 4, CellType.EMPTY)
    manager.update(0)
    expect(manager.count).toBe(0)
  })

  it('caps vehicles at 50', () => {
    const { manager, gridMap } = makeManager()
    // Place one commercial zone and many residential zones sharing a road
    for (let x = 0; x < 20; x++) gridMap.set(x, 5, CellType.ROAD)
    gridMap.set(19, 6, CellType.ZONE_COMMERCIAL)
    // 60 residential cells
    for (let i = 0; i < 60; i++) {
      gridMap.set(i % 18, 4, CellType.ZONE_RESIDENTIAL)
    }
    manager.update(0)
    expect(manager.count).toBeLessThanOrEqual(50)
  })
})

// ── State machine ────────────────────────────────────────────────────────────

describe('VehicleManager daily cycle', () => {
  function spawnAndGet(gridMap: GridMap, manager: VehicleManager) {
    buildTestCity(gridMap)
    manager.update(0)
    return (manager as any).vehicles[0]
  }

  it('vehicle starts in CommutingToWork state', () => {
    const { manager, gridMap } = makeManager()
    const v = spawnAndGet(gridMap, manager)
    expect(v.state).toBe(S_COMMUTING_TO_WORK)
  })

  it('vehicle arrives at AtWork after path traversal', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    // Path length=5, speed=8 → travel time = (5-1)/8 = 0.5 s; 0.7 s is enough
    manager.update(0.7)
    const v = (manager as any).vehicles[0]
    expect(v.state).toBe(S_AT_WORK)
  })

  it('vehicle transitions to CommutingHome after work dwell expires', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    manager.update(0.7)      // → AtWork, dwellTimer=8.0
    manager.update(8.1)      // → CommutingHome
    const v = (manager as any).vehicles[0]
    expect(v.state).toBe(S_COMMUTING_HOME)
  })

  it('vehicle arrives at AtHome after return trip', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    manager.update(0.7)
    manager.update(8.1)
    manager.update(0.7)
    const v = (manager as any).vehicles[0]
    expect(v.state).toBe(S_AT_HOME)
  })

  it('vehicle restarts workday after home dwell expires', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    manager.update(0.7)   // → AtWork
    manager.update(8.1)   // → CommutingHome
    manager.update(0.7)   // → AtHome, dwellTimer=5.0
    manager.update(5.1)   // → CommutingToWork again
    const v = (manager as any).vehicles[0]
    expect(v.state).toBe(S_COMMUTING_TO_WORK)
    expect(v.pathProgress).toBe(0)
  })

  it('vehicle marker position moves during commute', () => {
    const { manager, gridMap } = makeManager()
    spawnAndGet(gridMap, manager)
    const v = (manager as any).vehicles[0]
    const startX = v.marker.position.x

    manager.update(0.1)
    expect(v.marker.position.x).not.toBe(startX)
  })
})

// ── Lane offset ──────────────────────────────────────────────────────────────

describe('VehicleManager lane offset', () => {
  it('vehicle is offset from road center when commuting', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    manager.update(0.1)   // partial commute along horizontal road

    const v = (manager as any).vehicles[0]
    // Road runs horizontally (z=5); perpendicular is z-direction.
    // Right lane: z offset = -perp.z * LANE_OFFSET = -(dir.x) * 0.18 = -(1) * 0.18 = -0.18
    // road center z ≈ some value; vehicle z should differ by ~0.18
    const roadCenterZ = gridMap.cellToWorld(4, 5).z
    const diff = Math.abs(v.marker.position.z - roadCenterZ)
    expect(diff).toBeCloseTo(0.18, 1)
  })

  it('vehicle y position is 0.06 while commuting', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    manager.update(0.1)
    const v = (manager as any).vehicles[0]
    expect(v.marker.position.y).toBe(0.06)
  })
})

// ── Rotation ─────────────────────────────────────────────────────────────────

describe('VehicleManager rotation', () => {
  it('vehicle rotationQuaternion is set when commuting', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    manager.update(0.1)
    const v = (manager as any).vehicles[0]
    expect(v.marker.rotationQuaternion).not.toBeNull()
  })
})

// ── Colors ───────────────────────────────────────────────────────────────────

describe('VehicleManager colors', () => {
  it('vehicle material changes to parked when dwelling', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    const v = (manager as any).vehicles[0]
    const parkedMat = (manager as any).matParked

    manager.update(0.7)   // → AtWork
    expect(v.marker.material).toBe(parkedMat)
  })

  it('vehicle material changes back to commuting when leaving', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    const v = (manager as any).vehicles[0]
    const commutingMat = (manager as any).matCommuting

    manager.update(0.7)   // → AtWork
    manager.update(8.1)   // → CommutingHome
    expect(v.marker.material).toBe(commutingMat)
  })
})

// ── dispose ──────────────────────────────────────────────────────────────────

describe('VehicleManager.dispose', () => {
  it('disposes all vehicle markers on dispose()', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    const vehicles = (manager as any).vehicles as any[]
    const markerDispose = vehicles[0].marker.dispose

    manager.dispose()
    expect(markerDispose).toHaveBeenCalled()
    expect(manager.count).toBe(0)
  })
})
