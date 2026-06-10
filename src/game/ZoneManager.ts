import {
  ArcRotateCamera,
  Color3,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  type InstancedMesh,
  type Observer,
  type PointerInfo,
} from '@babylonjs/core'
import { CellType, GridMap } from '../simulation'
import { BuildingSystem, ZoneType } from './BuildingSystem'

export type ZoneTool = 'residential' | 'commercial' | 'industrial' | 'demolish'

// Maps zone tool name → CellType stored in GridMap
const TOOL_TO_CELL: Record<Exclude<ZoneTool, 'demolish'>, CellType> = {
  residential: CellType.ZONE_RESIDENTIAL,
  commercial:  CellType.ZONE_COMMERCIAL,
  industrial:  CellType.ZONE_INDUSTRIAL,
}

// Maps ZONE_* CellType to ZoneType enum index (ZONE_RESIDENTIAL=2 → 0, etc.)
const CELL_TO_ZONE: Partial<Record<CellType, ZoneType>> = {
  [CellType.ZONE_RESIDENTIAL]: ZoneType.Residential,
  [CellType.ZONE_COMMERCIAL]:  ZoneType.Commercial,
  [CellType.ZONE_INDUSTRIAL]:  ZoneType.Industrial,
}

const OVERLAY_COLORS: Color3[] = [
  new Color3(0.18, 0.42, 0.92),
  new Color3(0.12, 0.80, 0.28),
  new Color3(0.95, 0.78, 0.08),
]
const OVERLAY_ALPHA = 0.30

export class ZoneManager {
  private scene: Scene
  private camera: ArcRotateCamera
  private gridMap: GridMap
  private ground: Mesh
  private buildingSystem: BuildingSystem
  private buildings: Map<string, InstancedMesh> = new Map()
  private overlays: Map<string, Mesh> = new Map()
  private overlayMaterials: StandardMaterial[]
  private activeTool: ZoneTool | null = null
  private isDragging = false
  private active = false
  private pointerObserver: Observer<PointerInfo> | null = null

  constructor(scene: Scene, camera: ArcRotateCamera, gridMap: GridMap, ground: Mesh) {
    this.scene = scene
    this.camera = camera
    this.gridMap = gridMap
    this.ground = ground
    this.buildingSystem = new BuildingSystem(scene)
    this.overlayMaterials = OVERLAY_COLORS.map((color, i) => {
      const mat = new StandardMaterial(`overlayMat${i}`, scene)
      mat.diffuseColor = color
      mat.alpha = OVERLAY_ALPHA
      mat.backFaceCulling = false
      mat.disableLighting = true
      return mat
    })
  }

  get zonedCellCount(): number {
    return this.buildings.size
  }

  setTool(tool: ZoneTool | null): void {
    this.activeTool = tool
    if (tool !== null) {
      this.activate()
    } else {
      this.deactivate()
    }
  }

  activate(): void {
    if (this.active) return
    this.active = true
    this.camera.detachControl()
    this.pointerObserver = this.scene.onPointerObservable.add((info) => {
      this.handlePointerEvent(info)
    })
  }

  deactivate(): void {
    if (!this.active) return
    this.active = false
    this.isDragging = false
    this.camera.attachControl(true)
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver)
      this.pointerObserver = null
    }
  }

  private handlePointerEvent(info: PointerInfo): void {
    switch (info.type) {
      case PointerEventTypes.POINTERDOWN:
        if (info.event.button === 0) {
          this.isDragging = true
          this.paintAtPointer()
        }
        break
      case PointerEventTypes.POINTERMOVE:
        if (this.isDragging) this.paintAtPointer()
        break
      case PointerEventTypes.POINTERUP:
        this.isDragging = false
        break
    }
  }

  private paintAtPointer(): void {
    if (!this.activeTool) return
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.ground,
    )
    if (!pick.hit || !pick.pickedPoint) return
    const { x, z } = this.gridMap.worldToCell(pick.pickedPoint.x, pick.pickedPoint.z)

    if (this.activeTool === 'demolish') {
      this.demolishAt(x, z)
    } else {
      this.zoneAt(x, z, this.activeTool)
    }
  }

  private zoneAt(cx: number, cz: number, tool: Exclude<ZoneTool, 'demolish'>): void {
    const cellType = TOOL_TO_CELL[tool]
    const current = this.gridMap.get(cx, cz)
    if (current === CellType.ROAD) return      // never overwrite roads
    if (current === cellType) return            // already this zone, skip

    const key = `${cx},${cz}`
    this.removeVisuals(key)                     // remove old visuals if re-zoning

    this.gridMap.set(cx, cz, cellType)

    const zone = CELL_TO_ZONE[cellType]!
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    this.buildings.set(key, this.buildingSystem.spawnAt(cx, cz, zone, x, z))
    this.overlays.set(key, this.createOverlayQuad(key, x, z, zone))
  }

  private demolishAt(cx: number, cz: number): void {
    const current = this.gridMap.get(cx, cz)
    if (current === CellType.EMPTY || current === CellType.ROAD) return

    const key = `${cx},${cz}`
    this.removeVisuals(key)
    this.gridMap.set(cx, cz, CellType.EMPTY)
  }

  private removeVisuals(key: string): void {
    this.buildings.get(key)?.dispose()
    this.buildings.delete(key)
    this.overlays.get(key)?.dispose()
    this.overlays.delete(key)
  }

  private createOverlayQuad(key: string, worldX: number, worldZ: number, zone: ZoneType): Mesh {
    // Shared material per zone type → one material for all residential overlays, etc.
    const quad = MeshBuilder.CreateGround(
      `overlay_${key}`,
      { width: 0.95, height: 0.95 },
      this.scene,
    )
    quad.position.x = worldX
    quad.position.y = 0.02   // just above the ground to avoid z-fighting
    quad.position.z = worldZ
    quad.material = this.overlayMaterials[zone]
    quad.isPickable = false
    return quad
  }

  dispose(): void {
    this.deactivate()
    for (const key of [...this.buildings.keys()]) this.removeVisuals(key)
    this.buildingSystem.dispose()
    for (const mat of this.overlayMaterials) mat.dispose()
  }
}
