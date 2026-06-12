import {
  ArcRotateCamera,
  Color3,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  Vector3,
  type InstancedMesh,
  type Observer,
  type PointerInfo,
} from '@babylonjs/core'
import { CellType, GridMap, isRoadCell } from '../simulation'

export type RoadTier = 'local' | 'collector' | 'arterial'
export type RoadMode = 'place' | 'upgrade'
export type RoadOrientation = 'NS_STRAIGHT' | 'EW_STRAIGHT' | 'INTERSECTION'

type PlacementPhase = 'idle' | 'placing'

const TIER_CELL_TYPE: Record<RoadTier, CellType> = {
  local:     CellType.ROAD,
  collector: CellType.ROAD_COLLECTOR,
  arterial:  CellType.ROAD_ARTERIAL,
}

// Road surface widths per tier (the asphalt strip, flanked by sidewalks)
const ROAD_SURFACE_WIDTH: Record<RoadTier, number> = {
  local:     0.68,
  collector: 0.74,
  arterial:  0.80,
}

const SIDEWALK_WIDTH = 0.12
const SIDEWALK_OFFSET = 0.40   // sidewalk center offset from road center
const CELL_LENGTH = 0.92       // mesh dimension along the road direction

// Y positions
const ROAD_Y = 0.03
const MARK_Y = 0.055   // floats just above road surface to avoid z-fighting

// Layer heights
const ROAD_H = 0.04
const MARK_H = 0.01

// Lane marking geometry
const MARK_W = 0.04
const MARK_EDGE_LENGTH = 0.88  // slightly shorter than cell to avoid edge bleed
const DASH_LENGTH = 0.12

// Three evenly-spaced dashes per cell along CELL_LENGTH=0.92:
// gap=(0.92-3*0.12)/4=0.14  first-center=-0.46+0.14+0.06=-0.26
const DASH_OFFSETS = [-0.26, 0, 0.26] as const

// Sidewalk concrete color: #c8bfb0
const SIDEWALK_COLOR = new Color3(0.784, 0.749, 0.690)

// Arterial extra lane marking offset from road center
const ARTERIAL_LANE_OFFSET = 0.18

export class RoadGrid {
  private scene: Scene
  private camera: ArcRotateCamera
  private gridMap: GridMap
  private ground: Mesh

  // Source meshes — created once, instanced per cell
  private roadSurfaceSources: Map<RoadTier, Mesh> = new Map()
  private intersectionFillSources: Map<RoadTier, Mesh> = new Map()
  private sidewalkSource!: Mesh
  private laneMarkEdgeSource!: Mesh
  private laneMarkDashSource!: Mesh

  // All InstancedMeshes for each road cell (keyed by "cx,cz")
  private roadCells: Map<string, InstancedMesh[]> = new Map()

  private currentTier: RoadTier = 'local'
  private currentMode: RoadMode = 'place'
  private active = false
  private pointerObserver: Observer<PointerInfo> | null = null
  private _onRoadPlacedCb: (() => void) | null = null
  private _onIntersectionCb: (() => void) | null = null
  private _onRoadUpgradedCb: (() => void) | null = null

  // CS-style click-click placement state
  private placementPhase: PlacementPhase = 'idle'
  private startCell: { x: number; z: number } | null = null

  // Ghost preview meshes
  private ghostSourceMesh: Mesh | null = null
  private ghostInstances: InstancedMesh[] = []
  private startIndicator: Mesh | null = null
  private snapIndicator: Mesh | null = null

  // Snap radius in cells (Manhattan distance)
  private static readonly SNAP_RADIUS = 1

  constructor(scene: Scene, camera: ArcRotateCamera, gridMap: GridMap, ground: Mesh) {
    this.scene = scene
    this.camera = camera
    this.gridMap = gridMap
    this.ground = ground
    this.createSourceMeshes()
    this.initPreviewMeshes()
  }

  get roadCount(): number {
    return this.roadCells.size
  }

  setTier(tier: RoadTier): void {
    this.currentTier = tier
    this.currentMode = 'place'
    this.cancelPlacement()
  }

  setMode(mode: RoadMode): void {
    if (this.currentMode !== mode) this.cancelPlacement()
    this.currentMode = mode
  }

  onRoadPlaced(cb: () => void): void {
    this._onRoadPlacedCb = cb
  }

  onIntersectionCreated(cb: () => void): void {
    this._onIntersectionCb = cb
  }

  onRoadUpgraded(cb: () => void): void {
    this._onRoadUpgradedCb = cb
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
    this.cancelPlacement()
    this.camera.attachControl(true)
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver)
      this.pointerObserver = null
    }
  }

  /** Remove the road at a cell, clear the grid, and refresh neighbor visuals. */
  removeAt(cx: number, cz: number): void {
    this.gridMap.set(cx, cz, CellType.EMPTY)
    this.rebuildCellAndNeighbors(cx, cz)
    this._onRoadPlacedCb?.()
  }

  /** Recreates the road mesh for a saved cell without modifying GridMap. */
  restoreAt(cx: number, cz: number): void {
    this.rebuildCellAndNeighbors(cx, cz)
  }

  // ─── Source mesh creation ────────────────────────────────────────────────────

  private createSourceMeshes(): void {
    const asphaltMat = new StandardMaterial('roadAsphaltMat', this.scene)
    asphaltMat.diffuseColor = new Color3(0.22, 0.22, 0.22)
    asphaltMat.specularColor = Color3.Black()

    const sidewalkMat = new StandardMaterial('roadSidewalkMat', this.scene)
    sidewalkMat.diffuseColor = SIDEWALK_COLOR
    sidewalkMat.specularColor = Color3.Black()

    const markMat = new StandardMaterial('laneMarkMat', this.scene)
    markMat.diffuseColor = new Color3(1, 1, 1)
    markMat.emissiveColor = new Color3(0.5, 0.5, 0.5)
    markMat.specularColor = Color3.Black()

    for (const tier of ['local', 'collector', 'arterial'] as RoadTier[]) {
      const surfW = ROAD_SURFACE_WIDTH[tier]

      // Road surface — oriented NS by default; EW instances rotate 90° around Y
      const surface = MeshBuilder.CreateBox(
        `roadSurface_${tier}`,
        { width: surfW, height: ROAD_H, depth: CELL_LENGTH },
        this.scene,
      )
      surface.material = asphaltMat
      surface.isPickable = false
      surface.setEnabled(false)
      this.roadSurfaceSources.set(tier, surface)

      // Intersection fill — full-cell square, no lane markings
      const fill = MeshBuilder.CreateBox(
        `intersectionFill_${tier}`,
        { width: CELL_LENGTH, height: ROAD_H, depth: CELL_LENGTH },
        this.scene,
      )
      fill.material = asphaltMat
      fill.isPickable = false
      fill.setEnabled(false)
      this.intersectionFillSources.set(tier, fill)
    }

    // Sidewalk — shared across all tiers
    this.sidewalkSource = MeshBuilder.CreateBox(
      'sidewalkSource',
      { width: SIDEWALK_WIDTH, height: ROAD_H, depth: CELL_LENGTH },
      this.scene,
    )
    this.sidewalkSource.material = sidewalkMat
    this.sidewalkSource.isPickable = false
    this.sidewalkSource.setEnabled(false)

    // Solid edge lane marking
    this.laneMarkEdgeSource = MeshBuilder.CreateBox(
      'laneMarkEdge',
      { width: MARK_W, height: MARK_H, depth: MARK_EDGE_LENGTH },
      this.scene,
    )
    this.laneMarkEdgeSource.material = markMat
    this.laneMarkEdgeSource.isPickable = false
    this.laneMarkEdgeSource.setEnabled(false)

    // Single dash — instanced multiple times per cell for center line
    this.laneMarkDashSource = MeshBuilder.CreateBox(
      'laneMarkDash',
      { width: MARK_W, height: MARK_H, depth: DASH_LENGTH },
      this.scene,
    )
    this.laneMarkDashSource.material = markMat
    this.laneMarkDashSource.isPickable = false
    this.laneMarkDashSource.setEnabled(false)
  }

  // ─── Orientation & rebuild ───────────────────────────────────────────────────

  private computeOrientation(cx: number, cz: number): RoadOrientation {
    const hasN = isRoadCell(this.gridMap.get(cx, cz - 1))
    const hasS = isRoadCell(this.gridMap.get(cx, cz + 1))
    const hasE = isRoadCell(this.gridMap.get(cx + 1, cz))
    const hasW = isRoadCell(this.gridMap.get(cx - 1, cz))
    const hasNS = hasN || hasS
    const hasEW = hasE || hasW
    if (hasNS && hasEW) return 'INTERSECTION'
    if (hasEW) return 'EW_STRAIGHT'
    return 'NS_STRAIGHT'
  }

  private rebuildCellAndNeighbors(cx: number, cz: number): void {
    this.rebuildCell(cx,     cz)
    this.rebuildCell(cx - 1, cz)
    this.rebuildCell(cx + 1, cz)
    this.rebuildCell(cx,     cz - 1)
    this.rebuildCell(cx,     cz + 1)
  }

  private rebuildCell(cx: number, cz: number): void {
    const key = `${cx},${cz}`
    const existing = this.roadCells.get(key)
    if (existing) {
      for (const inst of existing) inst.dispose()
      this.roadCells.delete(key)
    }
    const cellType = this.gridMap.get(cx, cz)
    if (!isRoadCell(cellType)) return
    this.spawnComposedRoadMesh(cx, cz, this.cellTypeToTier(cellType))
  }

  private spawnComposedRoadMesh(cx: number, cz: number, tier: RoadTier): void {
    const key = `${cx},${cz}`
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    const orientation = this.computeOrientation(cx, cz)
    const isEW = orientation === 'EW_STRAIGHT'
    const instances: InstancedMesh[] = []

    if (orientation === 'INTERSECTION') {
      const inst = this.intersectionFillSources.get(tier)!.createInstance(`int_${key}`)
      inst.position.x = x
      inst.position.y = ROAD_Y
      inst.position.z = z
      instances.push(inst)
    } else {
      // Road surface
      const surf = this.roadSurfaceSources.get(tier)!.createInstance(`surf_${key}`)
      surf.position.x = x
      surf.position.y = ROAD_Y
      surf.position.z = z
      if (isEW) surf.rotation.y = Math.PI / 2
      instances.push(surf)

      // Sidewalks on each lateral side
      for (const side of [-1, 1] as const) {
        const sw = this.sidewalkSource.createInstance(`sw_${key}_${side}`)
        sw.position.y = ROAD_Y
        if (isEW) {
          sw.position.x = x
          sw.position.z = z + side * SIDEWALK_OFFSET
          sw.rotation.y = Math.PI / 2
        } else {
          sw.position.x = x + side * SIDEWALK_OFFSET
          sw.position.z = z
        }
        instances.push(sw)
      }

      // Solid edge lane markings
      const halfSurf = ROAD_SURFACE_WIDTH[tier] / 2
      for (const side of [-1, 1] as const) {
        const edge = this.laneMarkEdgeSource.createInstance(`edge_${key}_${side}`)
        edge.position.y = MARK_Y
        if (isEW) {
          edge.position.x = x
          edge.position.z = z + side * halfSurf
          edge.rotation.y = Math.PI / 2
        } else {
          edge.position.x = x + side * halfSurf
          edge.position.z = z
        }
        instances.push(edge)
      }

      // Center dashed line (3 dashes per cell)
      for (let i = 0; i < DASH_OFFSETS.length; i++) {
        const dp = DASH_OFFSETS[i]
        const dash = this.laneMarkDashSource.createInstance(`dash_${key}_${i}`)
        dash.position.y = MARK_Y
        if (isEW) {
          dash.position.x = x + dp
          dash.position.z = z
          dash.rotation.y = Math.PI / 2
        } else {
          dash.position.x = x
          dash.position.z = z + dp
        }
        instances.push(dash)
      }

      // Arterial: two additional dashed lane markings flanking center
      if (tier === 'arterial') {
        for (const laneOff of [-ARTERIAL_LANE_OFFSET, ARTERIAL_LANE_OFFSET]) {
          for (let i = 0; i < DASH_OFFSETS.length; i++) {
            const dp = DASH_OFFSETS[i]
            const dash = this.laneMarkDashSource.createInstance(`artDash_${key}_${laneOff}_${i}`)
            dash.position.y = MARK_Y
            if (isEW) {
              dash.position.x = x + dp
              dash.position.z = z + laneOff
              dash.rotation.y = Math.PI / 2
            } else {
              dash.position.x = x + laneOff
              dash.position.z = z + dp
            }
            instances.push(dash)
          }
        }
      }
    }

    this.roadCells.set(key, instances)
  }

  // ─── Preview meshes ──────────────────────────────────────────────────────────

  private initPreviewMeshes(): void {
    // Ghost road (semi-transparent blue — shows where road will be placed)
    const ghostMat = new StandardMaterial('roadGhostMat', this.scene)
    ghostMat.diffuseColor = new Color3(0.4, 0.7, 1.0)
    ghostMat.alpha = 0.45
    ghostMat.backFaceCulling = false
    ghostMat.disableLighting = true

    this.ghostSourceMesh = MeshBuilder.CreateBox(
      'roadGhostSource',
      { width: 0.9, height: 0.08, depth: 0.9 },
      this.scene,
    )
    this.ghostSourceMesh.material = ghostMat
    this.ghostSourceMesh.isPickable = false
    this.ghostSourceMesh.setEnabled(false)

    // Start indicator (green) — marks where the road segment begins
    const startMat = new StandardMaterial('roadStartMat', this.scene)
    startMat.diffuseColor = new Color3(0.1, 1.0, 0.5)
    startMat.alpha = 0.75
    startMat.disableLighting = true
    startMat.backFaceCulling = false

    this.startIndicator = MeshBuilder.CreateBox(
      'roadStartIndicator',
      { width: 0.96, height: 0.14, depth: 0.96 },
      this.scene,
    )
    this.startIndicator.material = startMat
    this.startIndicator.isPickable = false
    this.startIndicator.setEnabled(false)

    // Snap indicator (yellow) — highlights the nearest existing road node that will snap
    const snapMat = new StandardMaterial('roadSnapMat', this.scene)
    snapMat.diffuseColor = new Color3(1.0, 0.85, 0.1)
    snapMat.alpha = 0.7
    snapMat.disableLighting = true
    snapMat.backFaceCulling = false

    this.snapIndicator = MeshBuilder.CreateBox(
      'roadSnapIndicator',
      { width: 1.0, height: 0.16, depth: 1.0 },
      this.scene,
    )
    this.snapIndicator.material = snapMat
    this.snapIndicator.isPickable = false
    this.snapIndicator.setEnabled(false)
  }

  // ─── Pointer handling ────────────────────────────────────────────────────────

  private handlePointerEvent(info: PointerInfo): void {
    switch (info.type) {
      case PointerEventTypes.POINTERMOVE:
        this.onPointerMove()
        break
      case PointerEventTypes.POINTERDOWN:
        if (info.event.button === 0) this.onLeftClick()
        else if (info.event.button === 2) this.cancelPlacement()
        break
    }
  }

  private pickCell(): { x: number; z: number } | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.ground,
    )
    if (!pick.hit || !pick.pickedPoint) return null
    return this.gridMap.worldToCell(pick.pickedPoint.x, pick.pickedPoint.z)
  }

  private onPointerMove(): void {
    const raw = this.pickCell()
    if (!raw) {
      this.snapIndicator?.setEnabled(false)
      if (this.placementPhase === 'placing') this.clearGhost()
      return
    }

    if (this.currentMode === 'upgrade') {
      const isRoad = isRoadCell(this.gridMap.get(raw.x, raw.z))
      this.snapIndicator!.setEnabled(isRoad)
      if (isRoad) this.snapIndicator!.position = this.cellPos(raw.x, raw.z)
      return
    }

    const snapped = this.findSnap(raw.x, raw.z)
    const target = snapped ?? raw

    if (snapped) {
      this.snapIndicator!.position = this.cellPos(snapped.x, snapped.z)
      this.snapIndicator!.setEnabled(true)
    } else {
      this.snapIndicator!.setEnabled(false)
    }

    if (this.placementPhase === 'placing' && this.startCell) {
      this.updateGhostPath(this.startCell, target)
    }
  }

  private onLeftClick(): void {
    const raw = this.pickCell()
    if (!raw) return

    if (this.currentMode === 'upgrade') {
      this.upgradeRoadAt(raw.x, raw.z)
      return
    }

    const snapped = this.findSnap(raw.x, raw.z)
    const cell = snapped ?? raw

    if (this.placementPhase === 'idle') {
      // Click 1: set start of segment
      this.startCell = cell
      this.placementPhase = 'placing'
      this.startIndicator!.position = this.cellPos(cell.x, cell.z)
      this.startIndicator!.setEnabled(true)
      this.clearGhost()
    } else if (this.startCell) {
      // Click 2: place road from start to end, then continue from end
      this.placeRoadSegment(this.startCell, cell)
      this.startCell = cell
      this.startIndicator!.position = this.cellPos(cell.x, cell.z)
    }
  }

  private cancelPlacement(): void {
    this.placementPhase = 'idle'
    this.startCell = null
    this.clearGhost()
    this.startIndicator?.setEnabled(false)
    this.snapIndicator?.setEnabled(false)
  }

  private cellPos(cx: number, cz: number): Vector3 {
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    return new Vector3(x, 0.05, z)
  }

  /** Returns the nearest existing road cell within SNAP_RADIUS (Manhattan), or null. */
  private findSnap(cx: number, cz: number): { x: number; z: number } | null {
    const r = RoadGrid.SNAP_RADIUS
    let best: { x: number; z: number } | null = null
    let bestDist = Infinity

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx
        const nz = cz + dz
        if (!isRoadCell(this.gridMap.get(nx, nz))) continue
        const dist = Math.abs(dx) + Math.abs(dz)
        if (dist < bestDist) {
          bestDist = dist
          best = { x: nx, z: nz }
        }
      }
    }

    return best
  }

  /**
   * Returns the grid cells forming an L-shaped path from `from` to `to`:
   * horizontal first, then vertical. Both endpoints included.
   */
  private getPathCells(
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): { x: number; z: number }[] {
    const cells: { x: number; z: number }[] = []
    const dx = Math.sign(to.x - from.x)

    // Horizontal segment: from.x → to.x at from.z
    let x = from.x
    while (true) {
      cells.push({ x, z: from.z })
      if (x === to.x) break
      x += dx
    }

    // Vertical segment: from.z+step → to.z at to.x (corner already added above)
    const dz = Math.sign(to.z - from.z)
    if (dz !== 0) {
      let z = from.z + dz
      while (true) {
        cells.push({ x: to.x, z })
        if (z === to.z) break
        z += dz
      }
    }

    return cells
  }

  private ghostSeq = 0

  private updateGhostPath(
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): void {
    this.clearGhost()
    const cells = this.getPathCells(from, to)
    for (const cell of cells) {
      if (this.gridMap.get(cell.x, cell.z) !== CellType.EMPTY) continue
      const inst = this.ghostSourceMesh!.createInstance(`ghost_${this.ghostSeq++}`)
      const { x, z } = this.gridMap.cellToWorld(cell.x, cell.z)
      inst.position.set(x, 0.04, z)
      this.ghostInstances.push(inst)
    }
  }

  private clearGhost(): void {
    for (const inst of this.ghostInstances) inst.dispose()
    this.ghostInstances = []
  }

  private placeRoadSegment(
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): void {
    const cells = this.getPathCells(from, to)
    for (const cell of cells) {
      this.placeRoadAt(cell.x, cell.z)
    }
    // Clear ghost after placing so it doesn't linger
    this.clearGhost()
  }

  private upgradeRoadAt(cx: number, cz: number): void {
    const current = this.gridMap.get(cx, cz)
    let nextTier: RoadTier | null = null
    if (current === CellType.ROAD) nextTier = 'collector'
    else if (current === CellType.ROAD_COLLECTOR) nextTier = 'arterial'
    if (!nextTier) return

    this.gridMap.set(cx, cz, TIER_CELL_TYPE[nextTier])
    this.rebuildCellAndNeighbors(cx, cz)
    this._onRoadUpgradedCb?.()
    this._onRoadPlacedCb?.()
  }

  private placeRoadAt(cx: number, cz: number): void {
    if (this.gridMap.get(cx, cz) !== CellType.EMPTY) return

    const neighbors = [
      { x: cx - 1, z: cz }, { x: cx + 1, z: cz },
      { x: cx, z: cz - 1 }, { x: cx, z: cz + 1 },
    ]
    const roadNeighborCount = neighbors.filter(n => isRoadCell(this.gridMap.get(n.x, n.z))).length

    this.gridMap.set(cx, cz, TIER_CELL_TYPE[this.currentTier])
    this.rebuildCellAndNeighbors(cx, cz)
    this._onRoadPlacedCb?.()

    if (roadNeighborCount >= 2) {
      this._onIntersectionCb?.()
    }
  }

  private cellTypeToTier(cellType: CellType): RoadTier {
    if (cellType === CellType.ROAD_COLLECTOR) return 'collector'
    if (cellType === CellType.ROAD_ARTERIAL) return 'arterial'
    return 'local'
  }

  dispose(): void {
    this.deactivate()
    this.clearGhost()
    this.ghostSourceMesh?.dispose()
    this.startIndicator?.dispose()
    this.snapIndicator?.dispose()
    for (const instances of this.roadCells.values()) {
      for (const inst of instances) inst.dispose()
    }
    for (const mesh of this.roadSurfaceSources.values()) mesh.dispose()
    for (const mesh of this.intersectionFillSources.values()) mesh.dispose()
    this.sidewalkSource?.dispose()
    this.laneMarkEdgeSource?.dispose()
    this.laneMarkDashSource?.dispose()
  }
}
