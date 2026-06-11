import { describe, it, expect, vi } from 'vitest'

// Minimal Babylon.js stub — only what ZoneManager + BuildingSystem actually call.
// vi.mock is hoisted before imports so this runs before ZoneManager is imported.
vi.mock('@babylonjs/core', () => {
  function makeMesh(name: string) {
    return {
      name,
      isVisible: true,
      isPickable: true,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scaling: { x: 1, y: 1, z: 1 },
      material: null,
      setEnabled: vi.fn(),
      bakeCurrentTransformIntoVertices: vi.fn(),
      createInstance: vi.fn((iname: string) => ({
        name: iname,
        position: { x: 0, y: 0, z: 0 },
        scaling: { x: 1, y: 1, z: 1 },
        dispose: vi.fn(),
      })),
      dispose: vi.fn(),
    }
  }

  return {
    Scene: vi.fn(function () {
      return { onPointerObservable: { add: vi.fn(() => ({})), remove: vi.fn() }, pick: vi.fn(() => ({ hit: false, pickedPoint: null })), pointerX: 0, pointerY: 0 }
    }),
    ArcRotateCamera: vi.fn(function () {
      return { detachControl: vi.fn(), attachControl: vi.fn() }
    }),
    MeshBuilder: {
      CreateBox: vi.fn((name: string) => makeMesh(name)),
      CreateGround: vi.fn((name: string) => makeMesh(name)),
      CreateCylinder: vi.fn((name: string) => makeMesh(name)),
    },
    Mesh: {
      MergeMeshes: vi.fn((_meshes: unknown[], _dispose: boolean, _combine: boolean) => makeMesh('merged')),
    },
    // Must use function (not arrow) so they can be called with `new`
    StandardMaterial: vi.fn(function () {
      return { diffuseColor: null, specularColor: null, diffuseTexture: null, alpha: 1, backFaceCulling: true, disableLighting: false, dispose: vi.fn() }
    }),
    PBRMaterial: vi.fn(function () {
      return { albedoColor: null, metallic: 0, roughness: 0, dispose: vi.fn() }
    }),
    DynamicTexture: vi.fn(function () {
      return {
        getContext: vi.fn(() => ({
          fillStyle: '',
          fillRect: vi.fn(),
        })),
        update: vi.fn(),
        dispose: vi.fn(),
      }
    }),
    Color3: vi.fn(function (r: number, g: number, b: number) { return { r, g, b } }),
    Vector3: vi.fn(function (x: number, y: number, z: number) { return { x, y, z } }),
    PointerEventTypes: { POINTERDOWN: 1, POINTERMOVE: 2, POINTERUP: 4 },
  }
})

// These imports resolve to the mocked versions above
import {
  Scene as MockScene,
  ArcRotateCamera as MockCamera,
  MeshBuilder,
} from '@babylonjs/core'
import type { Scene, ArcRotateCamera, Mesh } from '@babylonjs/core'
import { GridMap, CellType } from '../simulation/GridMap'
import { ZoneManager } from './ZoneManager'

function createZoneManager() {
  const scene = new (MockScene as unknown as new () => Scene)()
  const camera = new (MockCamera as unknown as new () => ArcRotateCamera)()
  const ground = (MeshBuilder as any).CreateGround('ground') as Mesh
  const gridMap = new GridMap()
  const zm = new ZoneManager(scene, camera, gridMap, ground)
  return { zm, gridMap, scene, camera }
}

/** Adds a local road cell immediately to the right of (cx, cz) so zoneAt can succeed. */
function addRoadRight(gridMap: GridMap, cx: number, cz: number): void {
  gridMap.set(cx + 1, cz, CellType.ROAD)
}

describe('ZoneManager', () => {
  describe('zone painting', () => {
    it('records ZONE_RESIDENTIAL in GridMap after zoning', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 10, 20)
      ;(zm as any).zoneAt(10, 20, 'residential')
      expect(gridMap.get(10, 20)).toBe(CellType.ZONE_RESIDENTIAL)
    })

    it('records ZONE_COMMERCIAL in GridMap', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 5, 5)
      ;(zm as any).zoneAt(5, 5, 'commercial')
      expect(gridMap.get(5, 5)).toBe(CellType.ZONE_COMMERCIAL)
    })

    it('records ZONE_INDUSTRIAL in GridMap', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 3, 3)
      ;(zm as any).zoneAt(3, 3, 'industrial')
      expect(gridMap.get(3, 3)).toBe(CellType.ZONE_INDUSTRIAL)
    })

    it('increments zonedCellCount for each unique cell', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(0, 1, CellType.ROAD)  // road below (0,0)
      gridMap.set(2, 0, CellType.ROAD)  // road right of (1,0)
      ;(zm as any).zoneAt(0, 0, 'residential')
      ;(zm as any).zoneAt(1, 0, 'residential')
      expect(zm.zonedCellCount).toBe(2)
    })

    it('does not overwrite a ROAD cell', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(10, 10, CellType.ROAD)
      ;(zm as any).zoneAt(10, 10, 'residential')
      expect(gridMap.get(10, 10)).toBe(CellType.ROAD)
      expect(zm.zonedCellCount).toBe(0)
    })

    it('re-zoning a cell to a different type replaces the zone', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 5, 5)
      ;(zm as any).zoneAt(5, 5, 'residential')
      ;(zm as any).zoneAt(5, 5, 'commercial')
      expect(gridMap.get(5, 5)).toBe(CellType.ZONE_COMMERCIAL)
      expect(zm.zonedCellCount).toBe(1)  // still one cell, not two
    })

    it('painting the same zone type twice is a no-op (no extra GridMap write)', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 5, 5)
      ;(zm as any).zoneAt(5, 5, 'residential')
      const versionAfterFirst = gridMap.version
      ;(zm as any).zoneAt(5, 5, 'residential')
      expect(gridMap.version).toBe(versionAfterFirst)
    })
  })

  describe('road adjacency enforcement', () => {
    it('rejects zoning when no road neighbor exists', () => {
      const { zm, gridMap } = createZoneManager()
      ;(zm as any).zoneAt(10, 10, 'residential')
      expect(gridMap.get(10, 10)).toBe(CellType.EMPTY)
      expect(zm.zonedCellCount).toBe(0)
    })

    it('accepts zoning when adjacent to ROAD (local)', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(10, 11, CellType.ROAD)
      ;(zm as any).zoneAt(10, 10, 'residential')
      expect(gridMap.get(10, 10)).toBe(CellType.ZONE_RESIDENTIAL)
    })

    it('accepts zoning when adjacent to ROAD_COLLECTOR', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(10, 11, CellType.ROAD_COLLECTOR)
      ;(zm as any).zoneAt(10, 10, 'commercial')
      expect(gridMap.get(10, 10)).toBe(CellType.ZONE_COMMERCIAL)
    })

    it('accepts zoning when adjacent to ROAD_ARTERIAL', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(10, 11, CellType.ROAD_ARTERIAL)
      ;(zm as any).zoneAt(10, 10, 'industrial')
      expect(gridMap.get(10, 10)).toBe(CellType.ZONE_INDUSTRIAL)
    })

    it('only checks 4-directional neighbors (diagonal road is not access)', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(11, 11, CellType.ROAD)  // diagonal only
      ;(zm as any).zoneAt(10, 10, 'residential')
      expect(gridMap.get(10, 10)).toBe(CellType.EMPTY)
    })

    it('fires the noRoadAccess callback when placement is rejected', () => {
      const { zm } = createZoneManager()
      const cb = vi.fn()
      zm.onNoRoadAccess(cb)
      // First attempt fires callback
      ;(zm as any)._lastNoRoadNotifyMs = 0
      ;(zm as any).zoneAt(10, 10, 'residential')
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('hasRoadAccess returns false for isolated cell', () => {
      const { zm } = createZoneManager()
      expect((zm as any).hasRoadAccess(10, 10)).toBe(false)
    })

    it('hasRoadAccess returns true when left neighbor is ROAD', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(9, 10, CellType.ROAD)
      expect((zm as any).hasRoadAccess(10, 10)).toBe(true)
    })

    it('hasRoadAccess returns true when right neighbor is ROAD_ARTERIAL', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(11, 10, CellType.ROAD_ARTERIAL)
      expect((zm as any).hasRoadAccess(10, 10)).toBe(true)
    })
  })

  describe('demolish', () => {
    it('clears a zoned cell back to EMPTY', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 10, 10)
      ;(zm as any).zoneAt(10, 10, 'residential')
      ;(zm as any).demolishAt(10, 10)
      expect(gridMap.get(10, 10)).toBe(CellType.EMPTY)
    })

    it('decrements zonedCellCount after demolish', () => {
      const { zm, gridMap } = createZoneManager()
      addRoadRight(gridMap, 10, 10)
      ;(zm as any).zoneAt(10, 10, 'residential')
      expect(zm.zonedCellCount).toBe(1)
      ;(zm as any).demolishAt(10, 10)
      expect(zm.zonedCellCount).toBe(0)
    })

    it('demolish on EMPTY cell is a no-op', () => {
      const { zm, gridMap } = createZoneManager()
      const v = gridMap.version
      ;(zm as any).demolishAt(10, 10)
      expect(gridMap.version).toBe(v)
    })

    it('demolish on ROAD cell is a no-op', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(5, 5, CellType.ROAD)
      const vBefore = gridMap.version
      ;(zm as any).demolishAt(5, 5)
      expect(gridMap.get(5, 5)).toBe(CellType.ROAD)
      expect(gridMap.version).toBe(vBefore)
    })

    it('demolish on ROAD_ARTERIAL cell is a no-op', () => {
      const { zm, gridMap } = createZoneManager()
      gridMap.set(5, 5, CellType.ROAD_ARTERIAL)
      const vBefore = gridMap.version
      ;(zm as any).demolishAt(5, 5)
      expect(gridMap.get(5, 5)).toBe(CellType.ROAD_ARTERIAL)
      expect(gridMap.version).toBe(vBefore)
    })
  })

  describe('tool lifecycle', () => {
    it('setTool activates pointer observation', () => {
      const { zm, scene } = createZoneManager()
      const obs = (scene as any).onPointerObservable
      zm.setTool('residential')
      expect(obs.add).toHaveBeenCalled()
    })

    it('setTool(null) deactivates and re-attaches camera control', () => {
      const { zm, camera } = createZoneManager()
      zm.setTool('residential')
      zm.setTool(null)
      expect((camera as any).attachControl).toHaveBeenCalled()
    })
  })
})
