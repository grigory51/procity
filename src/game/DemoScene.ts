import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  Vector3,
} from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials'

export class DemoScene {
  readonly camera: ArcRotateCamera
  readonly ground: Mesh

  constructor(scene: Scene) {
    // ArcRotateCamera — city-builder view with angle/zoom constraints
    // beta=0 is directly overhead; beta=PI/2 is at horizon level
    this.camera = new ArcRotateCamera(
      'cityCamera',
      -Math.PI / 4,       // alpha: 45° initial azimuth
      Math.PI / 4,        // beta: 45° from zenith (isometric-ish start)
      60,                 // radius: initial zoom distance
      Vector3.Zero(),
      scene,
    )
    this.camera.attachControl(true)
    this.camera.lowerBetaLimit = 0.2          // ~11° from zenith — near top-down view
    this.camera.upperBetaLimit = 1.45         // ~83° — nearly at horizon but not past it
    this.camera.lowerRadiusLimit = 10         // minimum zoom
    this.camera.upperRadiusLimit = 200        // maximum zoom out
    this.camera.wheelPrecision = 5            // scroll-to-zoom sensitivity
    this.camera.panningSensibility = 150      // right-click / two-finger pan

    // Mac: Cmd+drag → rotation (same angular sensitivity as default left-drag)
    let metaDragLast: { x: number; y: number } | null = null
    scene.onPointerObservable.add((info) => {
      const evt = info.event as PointerEvent
      if (!evt.metaKey) {
        metaDragLast = null
        return
      }
      if (info.type === PointerEventTypes.POINTERDOWN) {
        metaDragLast = { x: evt.clientX, y: evt.clientY }
      } else if (info.type === PointerEventTypes.POINTERMOVE && metaDragLast !== null) {
        const dx = evt.clientX - metaDragLast.x
        const dy = evt.clientY - metaDragLast.y
        this.camera.alpha -= dx / 1000
        this.camera.beta -= dy / 1000
        this.camera.beta = Math.max(
          this.camera.lowerBetaLimit ?? 0.2,
          Math.min(this.camera.upperBetaLimit ?? 1.45, this.camera.beta),
        )
        metaDragLast = { x: evt.clientX, y: evt.clientY }
      } else if (info.type === PointerEventTypes.POINTERUP) {
        metaDragLast = null
      }
    })

    // Ambient fill — cool sky tint above, warm ground fill below
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene)
    ambient.intensity = 0.5
    ambient.diffuse = new Color3(0.88, 0.93, 1.0)
    ambient.groundColor = new Color3(0.28, 0.22, 0.18)

    // Sun — warm directional light casting city shadows
    const sun = new DirectionalLight('sun', new Vector3(-1.5, -3.0, -1.0), scene)
    sun.intensity = 1.1
    sun.diffuse = new Color3(1.0, 0.95, 0.82)
    sun.specular = new Color3(0.5, 0.48, 0.4)

    // Ground grid — 200×200 units, GridMaterial for procedural grid lines
    const groundSize = 200
    this.ground = MeshBuilder.CreateGround(
      'groundGrid',
      { width: groundSize, height: groundSize, subdivisions: 1 },
      scene,
    )
    const gridMat = new GridMaterial('gridMat', scene)
    gridMat.majorUnitFrequency = 8        // major lines every 8 units (~80m blocks)
    gridMat.minorUnitVisibility = 0.35    // subtle minor (1-unit) lines
    gridMat.gridRatio = 1.0              // 1 minor grid cell = 1 world unit
    gridMat.backFaceCulling = false
    gridMat.mainColor = new Color3(0.08, 0.10, 0.13)
    gridMat.lineColor = new Color3(0.28, 0.38, 0.50)
    this.ground.material = gridMat
    this.ground.receiveShadows = true
  }
}
