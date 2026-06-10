import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => {
  function makeMesh(name: string) {
    return {
      name,
      isPickable: true,
      position: { x: 0, y: 0, z: 0 },
      material: null,
      setEnabled: vi.fn(),
      createInstance: vi.fn((iname: string) => ({
        name: iname,
        position: { x: 0, y: 0, z: 0 },
        dispose: vi.fn(),
      })),
      dispose: vi.fn(),
    }
  }

  const Color3 = vi.fn(function (r: number, g: number, b: number) { return { r, g, b } }) as any
  Color3.Black = vi.fn(() => ({ r: 0, g: 0, b: 0 }))

  return {
    Scene: vi.fn(function () {
      return {
        onPointerObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        pick: vi.fn(() => ({ hit: false, pickedPoint: null })),
        pointerX: 0,
        pointerY: 0,
      }
    }),
    ArcRotateCamera: vi.fn(function () {
      return { detachControl: vi.fn(), attachControl: vi.fn() }
    }),
    MeshBuilder: {
      CreateBox: vi.fn((name: string) => makeMesh(name)),
    },
    StandardMaterial: vi.fn(function () {
      return { diffuseColor: null, specularColor: null, dispose: vi.fn() }
    }),
    Color3,
    PointerEventTypes: { POINTERDOWN: 1, POINTERMOVE: 2, POINTERUP: 4 },
  }
})

import { Scene as MockScene, ArcRotateCamera as MockCamera, MeshBuilder } from '@babylonjs/core'
import type { Scene, ArcRotateCamera, Mesh } from '@babylonjs/core'
import { GridMap, CellType } from '../simulation/GridMap'
import { RoadGrid } from './RoadGrid'

function createRoadGrid() {
  const scene = new (MockScene as unknown as new () => Scene)()
  const camera = new (MockCamera as unknown as new () => ArcRotateCamera)()
  const ground = (MeshBuilder as any).CreateBox('ground') as Mesh
  const gridMap = new GridMap()
  const rg = new RoadGrid(scene, camera, gridMap, ground)
  return { rg, gridMap }
}

describe('RoadGrid', () => {
  describe('placeRoadAtPointer guard', () => {
    it('places ROAD on an EMPTY cell', () => {
      const { rg, gridMap } = createRoadGrid()
      ;(rg as any).placeRoadAt(100, 100)
      expect(gridMap.get(100, 100)).toBe(CellType.ROAD)
      expect(rg.roadCount).toBe(1)
    })

    it('is a no-op when cell is already ROAD', () => {
      const { rg, gridMap } = createRoadGrid()
      ;(rg as any).placeRoadAt(100, 100)
      const versionAfterFirst = gridMap.version
      ;(rg as any).placeRoadAt(100, 100)
      expect(gridMap.version).toBe(versionAfterFirst)
    })

    it('does NOT overwrite a ZONE_RESIDENTIAL cell — BUG-01 regression', () => {
      const { rg, gridMap } = createRoadGrid()
      gridMap.set(100, 100, CellType.ZONE_RESIDENTIAL)
      const versionBefore = gridMap.version
      ;(rg as any).placeRoadAt(100, 100)
      expect(gridMap.get(100, 100)).toBe(CellType.ZONE_RESIDENTIAL)
      expect(gridMap.version).toBe(versionBefore)
      expect(rg.roadCount).toBe(0)
    })

    it('does NOT overwrite a ZONE_COMMERCIAL cell', () => {
      const { rg, gridMap } = createRoadGrid()
      gridMap.set(5, 5, CellType.ZONE_COMMERCIAL)
      ;(rg as any).placeRoadAt(5, 5)
      expect(gridMap.get(5, 5)).toBe(CellType.ZONE_COMMERCIAL)
    })

    it('does NOT overwrite a ZONE_INDUSTRIAL cell', () => {
      const { rg, gridMap } = createRoadGrid()
      gridMap.set(5, 5, CellType.ZONE_INDUSTRIAL)
      ;(rg as any).placeRoadAt(5, 5)
      expect(gridMap.get(5, 5)).toBe(CellType.ZONE_INDUSTRIAL)
    })
  })
})
