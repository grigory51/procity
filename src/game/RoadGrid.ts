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

export class RoadGrid {
  private scene: Scene
  private camera: ArcRotateCamera
  private gridMap: GridMap
  private ground: Mesh
  private sourceMesh: Mesh
  private roadInstances: Map<string, InstancedMesh> = new Map()
  private isDragging = false
  private active = false
  private pointerObserver: Observer<PointerInfo> | null = null

  constructor(scene: Scene, camera: ArcRotateCamera, gridMap: GridMap, ground: Mesh) {
    this.scene = scene
    this.camera = camera
    this.gridMap = gridMap
    this.ground = ground
    this.sourceMesh = this.createSourceMesh()
  }

  get roadCount(): number {
    return this.roadInstances.size
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

  private createSourceMesh(): Mesh {
    const mat = new StandardMaterial('roadMat', this.scene)
    mat.diffuseColor = new Color3(0.22, 0.22, 0.22)
    mat.specularColor = Color3.Black()

    const mesh = MeshBuilder.CreateBox(
      'roadSource',
      { width: 0.92, height: 0.06, depth: 0.92 },
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
    if (this.gridMap.get(x, z) === CellType.ROAD) return
    this.gridMap.set(x, z, CellType.ROAD)
    this.spawnRoadMesh(x, z)
  }

  private spawnRoadMesh(cx: number, cz: number): void {
    const key = `${cx},${cz}`
    if (this.roadInstances.has(key)) return
    const { x, z } = this.gridMap.cellToWorld(cx, cz)
    const instance = this.sourceMesh.createInstance(`road_${key}`)
    instance.position.x = x
    instance.position.y = 0.03
    instance.position.z = z
    this.roadInstances.set(key, instance)
  }

  dispose(): void {
    this.deactivate()
    for (const inst of this.roadInstances.values()) inst.dispose()
    this.sourceMesh.dispose()
  }
}
