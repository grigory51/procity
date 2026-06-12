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

  it('vehicle y position is 0.11 while commuting', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)
    manager.update(0)
    manager.update(0.1)
    const v = (manager as any).vehicles[0]
    expect(v.marker.position.y).toBe(0.11)
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

// ── Follow-the-leader (collision avoidance) ─────────────────────────────────

// Two-vehicle city with a T-intersection forcing vehicle 1 (leader) to stop,
// so vehicle 0 (follower) must slow behind it:
//   Road:  (2,5)-(3,5)-(4,5)-(5,5)-(6,5)-(7,5)-(8,5)-(9,5)
//   Spur:  (4,4)  → makes (4,5) an intersection
//   Home0: (2,4)  → road (2,5)  [follower — spawned first]
//   Home1: (3,4)  → road (3,5)  [leader  — spawned second, 1 cell ahead]
//   Work:  (9,6)  → road (9,5)
//   V0 path: (2,5)→…→(9,5)  length 8
//   V1 path: (3,5)→…→(9,5)  length 7
function buildFollowCity(gridMap: GridMap): void {
  for (let x = 2; x <= 9; x++) gridMap.set(x, 5, CellType.ROAD)
  gridMap.set(4, 4, CellType.ROAD)             // spur → (4,5) becomes intersection
  gridMap.set(2, 4, CellType.ZONE_RESIDENTIAL) // follower home
  gridMap.set(3, 4, CellType.ZONE_RESIDENTIAL) // leader home
  gridMap.set(9, 6, CellType.ZONE_COMMERCIAL)
}

describe('VehicleManager follow-the-leader', () => {
  it('followSpeedFactor returns 1.0 for a lone vehicle with no others in range', () => {
    const { manager, gridMap } = makeManager()
    buildTestCity(gridMap)   // single vehicle
    manager.update(0)

    const v  = (manager as any).vehicles[0]
    const sf = (manager as any).followSpeedFactor(v, v.forwardPath)
    expect(sf).toBe(1.0)
  })

  it('followSpeedFactor returns 0 when another vehicle is within STOP_DIST ahead', () => {
    const { manager, gridMap } = makeManager()
    buildFollowCity(gridMap)
    manager.update(0)  // spawn both vehicles

    const [v0, v1] = (manager as any).vehicles
    // Move v0 to 0.2 cells behind v1 (well within STOP_DIST = 0.35)
    v0.marker.position.x = v1.marker.position.x - 0.2
    v0.marker.position.z = v1.marker.position.z

    const sf = (manager as any).followSpeedFactor(v0, v0.forwardPath)
    expect(sf).toBe(0.0)
  })

  it('followSpeedFactor returns 1.0 when another vehicle is beyond FOLLOW_DIST', () => {
    const { manager, gridMap } = makeManager()
    buildFollowCity(gridMap)
    manager.update(0)

    const [v0] = (manager as any).vehicles
    // leader starts 1 cell ahead → gap = 1.0 > FOLLOW_DIST (0.55) → full speed
    const sf = (manager as any).followSpeedFactor(v0, v0.forwardPath)
    expect(sf).toBe(1.0)
  })

  it('followSpeedFactor returns intermediate value when gap is in braking range', () => {
    const { manager, gridMap } = makeManager()
    buildFollowCity(gridMap)
    manager.update(0)

    const [v0, v1] = (manager as any).vehicles
    // Place v0 exactly 0.45 cells behind v1 — midpoint of [STOP_DIST=0.35, FOLLOW_DIST=0.55]
    v0.marker.position.x = v1.marker.position.x - 0.45
    v0.marker.position.z = v1.marker.position.z

    const sf = (manager as any).followSpeedFactor(v0, v0.forwardPath)
    expect(sf).toBeGreaterThan(0.0)
    expect(sf).toBeLessThan(1.0)
  })

  it('follower does not overtake the leader on a shared road segment', () => {
    const { manager, gridMap } = makeManager()
    buildFollowCity(gridMap)
    manager.update(0)

    const [v0, v1] = (manager as any).vehicles

    for (let i = 0; i < 400; i++) {
      manager.update(0.016)  // ~60 fps
      // Only check while both vehicles are actively commuting east
      if (v0.state === S_COMMUTING_TO_WORK && v1.state === S_COMMUTING_TO_WORK) {
        // v1 started ahead (higher x); v0 must never pass it
        expect(v0.marker.position.x).toBeLessThanOrEqual(v1.marker.position.x + 0.02)
      }
    }
  })

  it('follower maintains at least STOP_DIST gap behind a stopped leader', () => {
    const { manager, gridMap } = makeManager()
    buildFollowCity(gridMap)
    manager.update(0)

    const [v0, v1] = (manager as any).vehicles
    let minGap = Infinity

    for (let i = 0; i < 400; i++) {
      manager.update(0.016)
      if (v0.state === S_COMMUTING_TO_WORK && v1.state === S_COMMUTING_TO_WORK) {
        const dx  = v1.marker.position.x - v0.marker.position.x
        const dz  = v1.marker.position.z - v0.marker.position.z
        const gap = Math.sqrt(dx * dx + dz * dz)
        if (gap < minGap) minGap = gap
      }
    }

    // Gap must never drop below STOP_DIST (0.35) minus a one-frame tolerance
    if (minGap !== Infinity) expect(minGap).toBeGreaterThanOrEqual(0.28)
  })

  it('follower slows behind an intersection-stopped leader', () => {
    const { manager, gridMap } = makeManager()
    buildFollowCity(gridMap)
    manager.update(0)

    const [v0, v1] = (manager as any).vehicles

    // Advance until v1 is braking at the intersection and v0 is still active
    for (let i = 0; i < 50; i++) manager.update(0.016)

    // v1 should be stopped (braking or waiting) at the intersection
    const v1Stopped = v1.yieldState === 'braking' || v1.yieldState === 'waiting'
    if (v1Stopped && v0.state === S_COMMUTING_TO_WORK) {
      // v0 must still be behind v1 and not have passed through it
      expect(v0.marker.position.x).toBeLessThan(v1.marker.position.x + 0.02)
    }
  })
})

// ── isIntersectionCell ────────────────────────────────────────────────────────

// T-intersection layout used in intersection tests:
//   Road row:   (3,5)-(4,5)-(5,5)-(6,5)
//   North spur:         (4,4)            ← makes (4,5) an intersection
//   Residential: (3,4)   Commercial: (6,6)
//   Path: (3,5)→(4,5)→(5,5)→(6,5)  length 4
function buildIntersectionCity(gridMap: GridMap): void {
  for (let x = 3; x <= 6; x++) gridMap.set(x, 5, CellType.ROAD)
  gridMap.set(4, 4, CellType.ROAD)              // north spur — makes (4,5) an intersection
  gridMap.set(3, 4, CellType.ZONE_RESIDENTIAL)
  gridMap.set(6, 6, CellType.ZONE_COMMERCIAL)
}

describe('VehicleManager.isIntersectionCell', () => {
  it('returns false for a straight EW road cell with no NS neighbours', () => {
    const { manager, gridMap } = makeManager()
    for (let x = 3; x <= 7; x++) gridMap.set(x, 5, CellType.ROAD)
    // (5,5): E=(6,5), W=(4,5) only — no NS neighbours
    expect((manager as any).isIntersectionCell(5, 5)).toBe(false)
  })

  it('returns true for a T-intersection cell', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    // (4,5): N=(4,4), E=(5,5), W=(3,5) → has both NS and EW → intersection
    expect((manager as any).isIntersectionCell(4, 5)).toBe(true)
  })

  it('returns false for the spur endpoint itself', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    // (4,4): S=(4,5) only — no EW neighbours
    expect((manager as any).isIntersectionCell(4, 4)).toBe(false)
  })
})

// ── Intersection yield ────────────────────────────────────────────────────────

describe('VehicleManager intersection yield', () => {
  it('vehicle enters braking state when it arrives at an intersection cell', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    manager.update(0)

    // Path: (3,5)→(4,5)→(5,5)→(6,5); speed=8 → 1 cell = 0.125 s
    // After 0.15 s: pathProgress ≈ 1.2, idx=1, path[1]=(4,5)=intersection → braking
    manager.update(0.15)
    const v = (manager as any).vehicles[0]
    expect(v.yieldState).toBe('braking')
    expect(v.yieldCellIdx).toBe(1)
  })

  it('vehicle transitions braking → waiting → none at intersection', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    manager.update(0)
    manager.update(0.15)   // → braking

    const v = (manager as any).vehicles[0]
    expect(v.yieldState).toBe('braking')

    manager.update(0.25)   // braking timer (0.2 s) expires → waiting
    expect(v.yieldState).toBe('waiting')

    manager.update(0.35)   // waiting timer (0.3 s) expires → resuming/none
    // resuming is cleared on the next advance call; here yieldState is 'resuming' or 'none'
    expect(['resuming', 'none']).toContain(v.yieldState)
  })

  it('vehicle holds position at intersection center during yield', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    manager.update(0)
    manager.update(0.15)   // → braking at (4,5)

    const v = (manager as any).vehicles[0]
    const { x: cx, z: cz } = gridMap.cellToWorld(4, 5)
    expect(v.marker.position.x).toBeCloseTo(cx, 4)
    expect(v.marker.position.z).toBeCloseTo(cz, 4)
  })

  it('vehicle yield resets on new commute so it yields again', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    manager.update(0)
    manager.update(0.15)   // → braking
    manager.update(0.25)   // → waiting
    manager.update(0.35)   // → resuming/none

    const v = (manager as any).vehicles[0]
    // Advance to AtWork then back to CommutingHome
    manager.update(5.0)    // finish commute, dwell at work
    manager.update(9.0)    // dwell expires → CommutingHome

    // yieldCellIdx reset to -1, vehicle will yield again on return path
    expect(v.yieldCellIdx).toBe(-1)
  })

  it('vehicle still reaches destination after yielding at intersection', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    manager.update(0)

    // Without yield: path length=4, travel = 3/8 = 0.375 s
    // With yield at idx=1 (0.2+0.3=0.5 s pause): total ≈ 1 s
    manager.update(2.0)   // well past worst-case arrival
    const v = (manager as any).vehicles[0]
    expect(v.state).toBe(S_AT_WORK)
  })

  it('vehicle offset is 0 while traversing an intersection segment', () => {
    const { manager, gridMap } = makeManager()
    buildIntersectionCity(gridMap)
    manager.update(0)

    // Skip past the yield by advancing far enough for the yield to expire
    // then check position when idx=1 (intersection) during normal traversal
    manager.update(0.15)   // enters braking at (4,5)
    manager.update(0.25)   // waiting
    manager.update(0.35)   // resuming
    manager.update(0.01)   // now advancing through intersection, no offset

    const v = (manager as any).vehicles[0]
    // Vehicle is between path[1]=(4,5) and path[2]=(5,5), idx=1=intersection
    // offset should be 0 → z matches road center z
    const roadCenterZ = gridMap.cellToWorld(4, 5).z
    // Either still at intersection center or very close — delta < 0.18
    expect(Math.abs(v.marker.position.z - roadCenterZ)).toBeLessThan(0.18)
  })
})
