/**
 * Integration tests validating full simulation stack: SimulationEngine driving
 * EconomyManager + CitizenManager over a realistic city layout.
 *
 * Also includes a 60fps/50-citizen performance benchmark.
 */
import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'

// ── Babylon.js stub — same mock shape as CitizenManager.test.ts ──────────────
vi.mock('@babylonjs/core', () => {
  function makeInstance(name: string) {
    return { name, position: { x: 0, y: 0, z: 0 }, isPickable: true, dispose: vi.fn() }
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
    Scene:            vi.fn(function () { return {} }),
    StandardMaterial: vi.fn(function () {
      return { diffuseColor: null, emissiveColor: null, specularColor: null, dispose: vi.fn() }
    }),
    Color3:      vi.fn(function (r: number, g: number, b: number) { return { r, g, b } }),
    Vector3:     vi.fn(function (x: number, y: number, z: number) { return { x, y, z } }),
    MeshBuilder: { CreateSphere: vi.fn((name: string) => makeMesh(name)) },
  }
})

import { Scene as MockScene } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

import { GridMap, CellType } from './GridMap'
import { RoadGraph } from './RoadGraph'
import { EconomyManager, TAX_CYCLE_SECONDS } from './EconomyManager'
import { SimulationEngine } from './SimulationEngine'
import { CitizenManager } from '../game/CitizenManager'

// ── City layout helpers ───────────────────────────────────────────────────────

/**
 * Build a city with `n` paired residential + commercial zones connected by a
 * U-shaped road so that each pair's home-road and work-road are different cells
 * (ensuring A* paths of length ≥ 2, which CitizenManager requires).
 *
 *  Left column:  residential at (84, 50+i), nearest road → (85, 50+i)
 *  Right column: commercial  at (116, 50+i), nearest road → (115, 50+i)
 *  Road shape:
 *    - left column:  x=85, z=49..50+n-1
 *    - right column: x=115, z=49..50+n-1
 *    - bottom row:   x=85..115, z=49  (connects the two columns)
 */
function buildScalableCity(gridMap: GridMap, n: number): void {
  const connectorZ = 49
  const leftX      = 85
  const rightX     = 115
  const baseZ      = 50

  for (let z = connectorZ; z < baseZ + n; z++) {
    gridMap.set(leftX,  z, CellType.ROAD)
    gridMap.set(rightX, z, CellType.ROAD)
  }
  for (let x = leftX; x <= rightX; x++) {
    gridMap.set(x, connectorZ, CellType.ROAD)
  }
  for (let i = 0; i < n; i++) {
    gridMap.set(leftX  - 1, baseZ + i, CellType.ZONE_RESIDENTIAL)  // x=84
    gridMap.set(rightX + 1, baseZ + i, CellType.ZONE_COMMERCIAL)   // x=116
  }
}

function makeScene(): Scene {
  return new (MockScene as unknown as new () => Scene)()
}

// ── End-to-end gameplay session ───────────────────────────────────────────────

describe('Integration: full game loop (SimEngine → Economy + Citizens)', () => {
  it('economy fires tax cycles when driven by SimulationEngine ticks', () => {
    const gridMap  = new GridMap()
    const economy  = new EconomyManager(gridMap)
    const sim      = new SimulationEngine()

    sim.onTick(dt => economy.tick(dt))

    const cycles: number[] = []
    economy.onTaxCycle(r => cycles.push(r.balance))

    // 63 real-seconds of frames at 1× speed → guaranteed ≥ 2 tax cycles (cycle = 30 s).
    // Using 63 s (not exactly 60) avoids floating-point accumulation drift at the boundary.
    const FRAME_DT = 1 / 60
    const FRAMES   = 63 * 60
    for (let f = 0; f < FRAMES; f++) sim.tick(FRAME_DT)

    expect(cycles.length).toBeGreaterThanOrEqual(2)
    // Starting balance 10 000, no zones → no income, no road costs → balance unchanged
    expect(cycles[0]).toBe(10_000)
  })

  it('citizens spawn when a connected city is built before ticking', () => {
    const gridMap   = new GridMap()
    const roadGraph = new RoadGraph(gridMap)
    const economy   = new EconomyManager(gridMap)
    const sim       = new SimulationEngine()
    const citizens  = new CitizenManager(makeScene(), gridMap, roadGraph)

    sim.onTick(dt => {
      economy.tick(dt)
      citizens.update(dt)
    })

    buildScalableCity(gridMap, 5)

    // One tick triggers rebuildCitizens
    sim.tick(1 / 60)

    expect(citizens.count).toBe(5)
    expect(economy.balance).toBe(10_000) // no tax cycle yet (only ~0.017 s elapsed)
  })

  it('economy changes balance after tax cycle with active zones', () => {
    const gridMap  = new GridMap()
    const roadGraph = new RoadGraph(gridMap)
    const economy  = new EconomyManager(gridMap)
    const sim      = new SimulationEngine()
    const citizens = new CitizenManager(makeScene(), gridMap, roadGraph)

    sim.onTick(dt => {
      economy.tick(dt)
      citizens.update(dt)
    })

    buildScalableCity(gridMap, 10)

    // Run past one full tax cycle
    const FRAME_DT = 1 / 60
    const FRAMES   = Math.ceil(TAX_CYCLE_SECONDS * 60) + 120  // extra 2 s safety margin
    for (let f = 0; f < FRAMES; f++) sim.tick(FRAME_DT)

    expect(citizens.count).toBe(10)
    // U-road has 31 (connector) + 2×(10+1) (columns) = 53 road cells.
    // Road expenses = 53×2 = 106. Income from 10 res + 10 com >> 106, so balance rises.
    expect(economy.balance).toBeGreaterThan(10_000)
  })

  it('pause stops both economy and citizen advancement', () => {
    const gridMap   = new GridMap()
    const roadGraph = new RoadGraph(gridMap)
    const economy   = new EconomyManager(gridMap)
    const sim       = new SimulationEngine()
    const citizens  = new CitizenManager(makeScene(), gridMap, roadGraph)

    sim.onTick(dt => {
      economy.tick(dt)
      citizens.update(dt)
    })

    buildScalableCity(gridMap, 3)
    for (let f = 0; f < 10; f++) sim.tick(1 / 60) // let citizens spawn

    const positionsBefore = (citizens as any).citizens.map((c: any) => ({
      x: c.marker.position.x, z: c.marker.position.z,
    }))
    const balanceBefore = economy.balance

    sim.pause()
    for (let f = 0; f < 120; f++) sim.tick(1 / 60)

    const positionsAfter = (citizens as any).citizens.map((c: any) => ({
      x: c.marker.position.x, z: c.marker.position.z,
    }))

    expect(positionsAfter).toEqual(positionsBefore)
    expect(economy.balance).toBe(balanceBefore)
  })

  it('speed × 4 fires 4× as many tax cycles over the same real time', () => {
    const gridMap1  = new GridMap()
    const economy1  = new EconomyManager(gridMap1)
    const sim1      = new SimulationEngine()
    sim1.onTick(dt => economy1.tick(dt))

    const gridMap4  = new GridMap()
    const economy4  = new EconomyManager(gridMap4)
    const sim4      = new SimulationEngine()
    sim4.setSpeed(4)
    sim4.onTick(dt => economy4.tick(dt))

    const cycles1: number[] = []
    const cycles4: number[] = []
    economy1.onTaxCycle(() => cycles1.push(1))
    economy4.onTaxCycle(() => cycles4.push(1))

    // 63 real seconds → 1× fires 2 cycles; 4× fires 8 cycles
    const FRAME_DT = 1 / 60
    const FRAMES   = 63 * 60
    for (let f = 0; f < FRAMES; f++) {
      sim1.tick(FRAME_DT)
      sim4.tick(FRAME_DT)
    }

    expect(cycles1.length).toBeGreaterThanOrEqual(2)
    expect(cycles4.length).toBeGreaterThanOrEqual(8)
    expect(cycles4.length).toBeGreaterThan(cycles1.length)
  })

  it('no crash during a simulated 10-minute gameplay session (600 real-time seconds at 1×)', () => {
    const gridMap   = new GridMap()
    const roadGraph = new RoadGraph(gridMap)
    const economy   = new EconomyManager(gridMap)
    const sim       = new SimulationEngine()
    const citizens  = new CitizenManager(makeScene(), gridMap, roadGraph)

    sim.onTick(dt => {
      economy.tick(dt)
      citizens.update(dt)
    })

    buildScalableCity(gridMap, 20)

    let bankruptcyFired = false
    economy.onBankruptcy(() => { bankruptcyFired = true })

    // 10-minute session simulated at 60fps
    const FRAME_DT = 1 / 60
    const FRAMES   = 600 * 60

    expect(() => {
      for (let f = 0; f < FRAMES; f++) sim.tick(FRAME_DT)
    }).not.toThrow()

    expect(citizens.count).toBe(20)
    // With 20 paired zones the city should be comfortably profitable
    expect(economy.balance).toBeGreaterThan(10_000)
    expect(bankruptcyFired).toBe(false)
  })
})

// ── Performance: 50 citizens at 60fps ────────────────────────────────────────

describe('Performance: 50 citizens at 60fps', () => {
  it('simulates 3600 frames (60s) with 50 citizens in under 500ms', () => {
    const gridMap   = new GridMap()
    const roadGraph = new RoadGraph(gridMap)
    const economy   = new EconomyManager(gridMap)
    const sim       = new SimulationEngine()
    const citizens  = new CitizenManager(makeScene(), gridMap, roadGraph)

    sim.onTick(dt => {
      economy.tick(dt)
      citizens.update(dt)
    })

    buildScalableCity(gridMap, 50)

    // Warm-up tick: triggers rebuildCitizens and spawns 50 citizens
    sim.tick(1 / 60)
    expect(citizens.count).toBe(50)

    const FRAME_DT = 1 / 60
    const FRAMES   = 3_600  // 60 s × 60 fps

    const start = performance.now()
    for (let f = 0; f < FRAMES; f++) sim.tick(FRAME_DT)
    const elapsed = performance.now() - start

    // 500ms wall-clock for 3600 frames is a very generous budget.
    // Pure JS simulation math should complete in well under 100ms.
    expect(elapsed).toBeLessThan(500)
    expect(citizens.count).toBe(50)
  })

  it('average per-frame simulation time under 0.5ms with 50 citizens active', () => {
    const gridMap   = new GridMap()
    const roadGraph = new RoadGraph(gridMap)
    const economy   = new EconomyManager(gridMap)
    const sim       = new SimulationEngine()
    const citizens  = new CitizenManager(makeScene(), gridMap, roadGraph)

    sim.onTick(dt => {
      economy.tick(dt)
      citizens.update(dt)
    })

    buildScalableCity(gridMap, 50)
    sim.tick(1 / 60) // spawn

    const FRAME_DT  = 1 / 60
    const SAMPLES   = 600  // 10 s of frames
    const times: number[] = []

    for (let f = 0; f < SAMPLES; f++) {
      const t0 = performance.now()
      sim.tick(FRAME_DT)
      times.push(performance.now() - t0)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)

    // avg <0.5ms per frame, no single spike >10ms (rebuildCitizens triggered by grid changes)
    expect(avg).toBeLessThan(0.5)
    expect(max).toBeLessThan(10)
  })
})
