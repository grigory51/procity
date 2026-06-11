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

// Ghost layer: tier-colored tints on road-accessible EMPTY cells
// blue = residential, green = commercial, yellow = industrial
const GHOST_COLORS: [Color3, Color3, Color3] = [
  new Color3(0.18, 0.42, 0.92), // blue — residential (local+)
  new Color3(0.12, 0.80, 0.28), // green — commercial (collector+)
  new Color3(0.95, 0.78, 0.08), // yellow — industrial (arterial)
]
const GHOST_ALPHA = 0.28

/** 0=residential 1=commercial 2=industrial, or -1 if no road access */
type AccessTier = -1 | 0 | 1 | 2

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

  // Ghost layer: one source mesh per tier (blue/green/yellow)
  private ghostSources: [Mesh | null, Mesh | null, Mesh | null] = [null, null, null]
  private ghostMats: [StandardMaterial | null, StandardMaterial | null, StandardMaterial | null] = [null, null, null]
  private ghostInstances: Map<string, InstancedMesh> = new Map()

  // Callbacks
  private _noRoadAccessCb: (() => void) | null = null
  private _wrongTierCb: ((zone: Exclude<ZoneTool, 'demolish'>, needed: string) => void) | null = null
  private _demolishRoadCb: ((cx: number, cz: number) => void) | null = null
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

  /** Register a callback that fires when a zone is rejected because the adjacent road tier is too low. */
  onWrongRoadTier(cb: (zone: Exclude<ZoneTool, 'demolish'>, needed: string) => void): void {
    this._wrongTierCb = cb
  }

  /** Register a callback that fires when the demolish tool hits a road cell. */
  onDemolishRoad(cb: (cx: number, cz: number) => void): void {
    this._demolishRoadCb = cb
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

  /** Returns the highest zone tier accessible from (cx,cz): 2=industrial, 1=commercial, 0=residential, -1=none */
  private bestAccessTier(cx: number, cz: number): AccessTier {
    const neighbors = [
      { x: cx - 1, z: cz }, { x: cx + 1, z: cz },
      { x: cx, z: cz - 1 }, { x: cx, z: cz + 1 },
    ]
    let best: AccessTier = -1
    for (const n of neighbors) {
      const cell = this.gridMap.get(n.x, n.z)
      if (cell === CellType.ROAD_ARTERIAL && best < 2) best = 2
      else if (cell === CellType.ROAD_COLLECTOR && best < 1) best = 1
      else if (cell === CellType.ROAD && best < 0) best = 0
    }
    return best
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

  // Minimum access tier required per zone type
  private static readonly ZONE_MIN_TIER: Record<Exclude<ZoneTool, 'demolish'>, AccessTier> = {
    residential: 0,
    commercial:  1,
    industrial:  2,
  }

  private static readonly ZONE_TIER_LABEL: Record<1 | 2, string> = {
    1: 'a collector or arterial road',
    2: 'an arterial road',
  }

  private zoneAt(cx: number, cz: number, tool: Exclude<ZoneTool, 'demolish'>): void {
    const cellType = TOOL_TO_CELL[tool]
    const current = this.gridMap.get(cx, cz)
    if (isRoadCell(current)) return      // never overwrite roads
    if (current === cellType) return     // already this zone, skip

    const tier = this.bestAccessTier(cx, cz)
    const now = Date.now()

    if (tier < 0) {
      if (now - this._lastNoRoadNotifyMs > 2_000) {
        this._noRoadAccessCb?.()
        this._lastNoRoadNotifyMs = now
      }
      return
    }

    const minTier = ZoneManager.ZONE_MIN_TIER[tool]
    if (tier < minTier) {
      if (now - this._lastNoRoadNotifyMs > 2_000) {
        this._wrongTierCb?.(tool, ZoneManager.ZONE_TIER_LABEL[minTier as 1 | 2])
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
    if (current === CellType.EMPTY) return

    if (isRoadCell(current)) {
      // Delegate road removal to RoadGrid via callback
      this._demolishRoadCb?.(cx, cz)
      return
    }

    const key = `${cx},${cz}`
    this.removeVisuals(key)
    this.gridMap.set(cx, cz, CellType.EMPTY)

    // Restored cell is now EMPTY — show ghost at the appropriate tier
    if (this.active) {
      const tier = this.bestAccessTier(cx, cz)
      if (tier >= 0) this.addGhostAt(cx, cz, key, tier as 0 | 1 | 2)
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

  // ── Ghost layer (road-access hint overlay, tier-colored) ─────────────────

  private initGhostLayer(): void {
    const tierNames = ['res', 'com', 'ind'] as const
    for (let i = 0; i < 3; i++) {
      const mat = new StandardMaterial(`ghostMat_${tierNames[i]}`, this.scene)
      mat.diffuseColor = GHOST_COLORS[i]
      mat.alpha = GHOST_ALPHA
      mat.backFaceCulling = false
      mat.disableLighting = true
      this.ghostMats[i] = mat

      const mesh = MeshBuilder.CreateGround(
        `ghostSource_${tierNames[i]}`,
        { width: 0.95, height: 0.95 },
        this.scene,
      )
      mesh.material = mat
      mesh.isPickable = false
      mesh.setEnabled(false)
      this.ghostSources[i] = mesh
    }
  }

  private buildGhostLayer(): void {
    this.clearGhostLayer()
    const { width, height } = this.gridMap
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (this.gridMap.get(x, z) !== CellType.EMPTY) continue
        const tier = this.bestAccessTier(x, z)
        if (tier < 0) continue
        const key = `${x},${z}`
        this.addGhostAt(x, z, key, tier as 0 | 1 | 2)
      }
    }
  }

  private clearGhostLayer(): void {
    for (const inst of this.ghostInstances.values()) inst.dispose()
    this.ghostInstances.clear()
  }

  private addGhostAt(cx: number, cz: number, key: string, tier: 0 | 1 | 2): void {
    const source = this.ghostSources[tier]
    if (!source || this.ghostInstances.has(key)) return
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    const inst = source.createInstance(`ghost_${key}`)
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
    for (const source of this.ghostSources) source?.dispose()
    for (const mat of this.ghostMats) mat?.dispose()
  }
}
