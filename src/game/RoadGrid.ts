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

type PlacementPhase = 'idle' | 'placing'

const TIER_CELL_TYPE: Record<RoadTier, CellType> = {
  local:     CellType.ROAD,
  collector: CellType.ROAD_COLLECTOR,
  arterial:  CellType.ROAD_ARTERIAL,
}

// Visual dimensions per tier [width, height, depth]
const TIER_DIMS: Record<RoadTier, [number, number, number]> = {
  local:     [0.92, 0.06, 0.92],
  collector: [0.94, 0.07, 0.94],
  arterial:  [0.96, 0.08, 0.96],
}

const TIER_COLOR: Record<RoadTier, Color3> = {
  local:     new Color3(0.22, 0.22, 0.22),
  collector: new Color3(0.28, 0.28, 0.28),
  arterial:  new Color3(0.35, 0.33, 0.30),
}

export class RoadGrid {
  private scene: Scene
  private camera: ArcRotateCamera
  private gridMap: GridMap
  private ground: Mesh
  private sourceMeshes: Map<RoadTier, Mesh> = new Map()
  private roadInstances: Map<string, InstancedMesh> = new Map()
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
    for (const tier of ['local', 'collector', 'arterial'] as RoadTier[]) {
      this.sourceMeshes.set(tier, this.createSourceMesh(tier))
    }
    this.initPreviewMeshes()
  }

  get roadCount(): number {
    return this.roadInstances.size
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

  /** Remove the road at a cell and clear the grid cell. Used by the demolish tool. */
  removeAt(cx: number, cz: number): void {
    const key = `${cx},${cz}`
    const inst = this.roadInstances.get(key)
    if (inst) {
      inst.dispose()
      this.roadInstances.delete(key)
    }
    this.gridMap.set(cx, cz, CellType.EMPTY)
    this._onRoadPlacedCb?.()
  }

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

  private createSourceMesh(tier: RoadTier): Mesh {
    const mat = new StandardMaterial(`roadMat_${tier}`, this.scene)
    mat.diffuseColor = TIER_COLOR[tier]
    mat.specularColor = Color3.Black()

    const [w, h, d] = TIER_DIMS[tier]
    const mesh = MeshBuilder.CreateBox(
      `roadSource_${tier}`,
      { width: w, height: h, depth: d },
      this.scene,
    )
    mesh.material = mat
    mesh.isPickable = false
    mesh.setEnabled(false)
    return mesh
  }

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

    const key = `${cx},${cz}`
    const oldInst = this.roadInstances.get(key)
    if (oldInst) { oldInst.dispose(); this.roadInstances.delete(key) }

    this.gridMap.set(cx, cz, TIER_CELL_TYPE[nextTier])
    this.spawnRoadMesh(cx, cz, nextTier)
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
    this.spawnRoadMesh(cx, cz, this.currentTier)
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

  /** Recreates the road mesh for a saved cell without modifying GridMap. */
  restoreAt(cx: number, cz: number): void {
    const tier = this.cellTypeToTier(this.gridMap.get(cx, cz))
    this.spawnRoadMesh(cx, cz, tier)
  }

  private spawnRoadMesh(cx: number, cz: number, tier: RoadTier): void {
    const key = `${cx},${cz}`
    if (this.roadInstances.has(key)) return
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    const source = this.sourceMeshes.get(tier)!
    const instance = source.createInstance(`road_${key}`)
    instance.position.x = x
    instance.position.y = 0.03
    instance.position.z = z
    this.roadInstances.set(key, instance)
  }

  dispose(): void {
    this.deactivate()
    this.clearGhost()
    this.ghostSourceMesh?.dispose()
    this.startIndicator?.dispose()
    this.snapIndicator?.dispose()
    for (const inst of this.roadInstances.values()) inst.dispose()
    for (const mesh of this.sourceMeshes.values()) mesh.dispose()
  }
}
