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

export type RoadTier = 'local' | 'collector' | 'arterial'

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
  private isDragging = false
  private active = false
  private pointerObserver: Observer<PointerInfo> | null = null
  private _onRoadPlacedCb: (() => void) | null = null
  private _onIntersectionCb: (() => void) | null = null

  constructor(scene: Scene, camera: ArcRotateCamera, gridMap: GridMap, ground: Mesh) {
    this.scene = scene
    this.camera = camera
    this.gridMap = gridMap
    this.ground = ground
    for (const tier of ['local', 'collector', 'arterial'] as RoadTier[]) {
      this.sourceMeshes.set(tier, this.createSourceMesh(tier))
    }
  }

  get roadCount(): number {
    return this.roadInstances.size
  }

  setTier(tier: RoadTier): void {
    this.currentTier = tier
  }

  onRoadPlaced(cb: () => void): void {
    this._onRoadPlacedCb = cb
  }

  onIntersectionCreated(cb: () => void): void {
    this._onIntersectionCb = cb
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
      case PointerEventTypes.POINTERDOWN:
        if (info.event.button === 0) {
          this.isDragging = true
          this.placeRoadAtPointer()
        }
        break
      case PointerEventTypes.POINTERMOVE:
        if (this.isDragging) this.placeRoadAtPointer()
        break
      case PointerEventTypes.POINTERUP:
        this.isDragging = false
        break
    }
  }

  private placeRoadAtPointer(): void {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.ground,
    )
    if (!pick.hit || !pick.pickedPoint) return
    const { x, z } = this.gridMap.worldToCell(pick.pickedPoint.x, pick.pickedPoint.z)
    this.placeRoadAt(x, z)
  }

  private placeRoadAt(cx: number, cz: number): void {
    if (this.gridMap.get(cx, cz) !== CellType.EMPTY) return

    // Count road neighbors before placing to detect intersection formation
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
    for (const inst of this.roadInstances.values()) inst.dispose()
    for (const mesh of this.sourceMeshes.values()) mesh.dispose()
  }
}
