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
import { CellType, GridMap, isRoadCell } from '../simulation'
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

// Ghost layer: subtle green tint on road-accessible EMPTY cells
const GHOST_COLOR = new Color3(0.20, 0.85, 0.30)
const GHOST_ALPHA  = 0.22

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

  // Ghost layer (road-access hints shown while zoning tool is active)
  private ghostSource: Mesh | null = null
  private ghostMat: StandardMaterial | null = null
  private ghostInstances: Map<string, InstancedMesh> = new Map()

  // Callbacks
  private _noRoadAccessCb: (() => void) | null = null
  private _lastNoRoadNotifyMs = 0

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
    this.initGhostLayer()
  }

  get zonedCellCount(): number {
    return this.buildings.size
  }

  /** Register a callback that fires (throttled to 2s) when zoning is rejected due to no road access. */
  onNoRoadAccess(cb: () => void): void {
    this._noRoadAccessCb = cb
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
    this.buildGhostLayer()
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
    this.clearGhostLayer()
  }

  /** Call after new roads are placed to update the access-hint ghost overlay. */
  refreshGhostLayer(): void {
    if (this.active) this.buildGhostLayer()
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

  private hasRoadAccess(cx: number, cz: number): boolean {
    const neighbors = [
      { x: cx - 1, z: cz }, { x: cx + 1, z: cz },
      { x: cx, z: cz - 1 }, { x: cx, z: cz + 1 },
    ]
    return neighbors.some(n => isRoadCell(this.gridMap.get(n.x, n.z)))
  }

  /** Recreates building + overlay visuals for a saved zone cell without modifying GridMap. */
  restoreAt(cx: number, cz: number, cellType: CellType): void {
    const zone = CELL_TO_ZONE[cellType]
    if (zone === undefined) return
    const key = `${cx},${cz}`
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    this.buildings.set(key, this.buildingSystem.spawnAt(cx, cz, zone, x, z))
    this.overlays.set(key, this.createOverlayQuad(key, x, z, zone))
  }

  private zoneAt(cx: number, cz: number, tool: Exclude<ZoneTool, 'demolish'>): void {
    const cellType = TOOL_TO_CELL[tool]
    const current = this.gridMap.get(cx, cz)
    if (isRoadCell(current)) return      // never overwrite roads
    if (current === cellType) return     // already this zone, skip

    if (!this.hasRoadAccess(cx, cz)) {
      const now = Date.now()
      if (now - this._lastNoRoadNotifyMs > 2_000) {
        this._noRoadAccessCb?.()
        this._lastNoRoadNotifyMs = now
      }
      return
    }

    const key = `${cx},${cz}`
    this.removeVisuals(key)              // remove old visuals if re-zoning
    this.removeGhostAt(key)             // cell is no longer an accessible-empty slot

    this.gridMap.set(cx, cz, cellType)

    const zone = CELL_TO_ZONE[cellType]!
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    this.buildings.set(key, this.buildingSystem.spawnAt(cx, cz, zone, x, z))
    this.overlays.set(key, this.createOverlayQuad(key, x, z, zone))
  }

  private demolishAt(cx: number, cz: number): void {
    const current = this.gridMap.get(cx, cz)
    if (current === CellType.EMPTY || isRoadCell(current)) return

    const key = `${cx},${cz}`
    this.removeVisuals(key)
    this.gridMap.set(cx, cz, CellType.EMPTY)

    // Restored cell is now EMPTY — show ghost if it has road access
    if (this.active && this.hasRoadAccess(cx, cz)) {
      this.addGhostAt(cx, cz, key)
    }
  }

  private removeVisuals(key: string): void {
    this.buildings.get(key)?.dispose()
    this.buildings.delete(key)
    this.overlays.get(key)?.dispose()
    this.overlays.delete(key)
  }

  private createOverlayQuad(key: string, worldX: number, worldZ: number, zone: ZoneType): Mesh {
    const quad = MeshBuilder.CreateGround(
      `overlay_${key}`,
      { width: 0.95, height: 0.95 },
      this.scene,
    )
    quad.position.x = worldX
    quad.position.y = 0.02   // just above ground to avoid z-fighting
    quad.position.z = worldZ
    quad.material = this.overlayMaterials[zone]
    quad.isPickable = false
    return quad
  }

  // ── Ghost layer (road-access hint overlay) ────────────────────────────────

  private initGhostLayer(): void {
    const mat = new StandardMaterial('ghostAccessMat', this.scene)
    mat.diffuseColor = GHOST_COLOR
    mat.alpha = GHOST_ALPHA
    mat.backFaceCulling = false
    mat.disableLighting = true
    this.ghostMat = mat

    const mesh = MeshBuilder.CreateGround(
      'ghostAccessSource',
      { width: 0.95, height: 0.95 },
      this.scene,
    )
    mesh.material = mat
    mesh.isPickable = false
    mesh.setEnabled(false)
    this.ghostSource = mesh
  }

  private buildGhostLayer(): void {
    this.clearGhostLayer()
    if (!this.ghostSource) return
    const { width, height } = this.gridMap
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (this.gridMap.get(x, z) !== CellType.EMPTY) continue
        if (!this.hasRoadAccess(x, z)) continue
        const key = `${x},${z}`
        this.addGhostAt(x, z, key)
      }
    }
  }

  private clearGhostLayer(): void {
    for (const inst of this.ghostInstances.values()) inst.dispose()
    this.ghostInstances.clear()
  }

  private addGhostAt(cx: number, cz: number, key: string): void {
    if (!this.ghostSource || this.ghostInstances.has(key)) return
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    const inst = this.ghostSource.createInstance(`ghost_${key}`)
    inst.position.x = x
    inst.position.y = 0.01
    inst.position.z = z
    this.ghostInstances.set(key, inst)
  }

  private removeGhostAt(key: string): void {
    const inst = this.ghostInstances.get(key)
    if (inst) {
      inst.dispose()
      this.ghostInstances.delete(key)
    }
  }

  dispose(): void {
    this.deactivate()
    for (const key of [...this.buildings.keys()]) this.removeVisuals(key)
    this.buildingSystem.dispose()
    for (const mat of this.overlayMaterials) mat.dispose()
    this.ghostSource?.dispose()
    this.ghostMat?.dispose()
  }
}
