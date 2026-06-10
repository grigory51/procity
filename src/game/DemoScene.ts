import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
} from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials'
import { BuildingSystem } from './BuildingSystem'

export class DemoScene {
  constructor(scene: Scene) {
    this.setup(scene)
  }

  private setup(scene: Scene): void {
    // ArcRotateCamera — city-builder view with angle/zoom constraints
    // beta=0 is directly overhead; beta=PI/2 is at horizon level
    const camera = new ArcRotateCamera(
      'cityCamera',
      -Math.PI / 4,       // alpha: 45° initial azimuth
      Math.PI / 4,        // beta: 45° from zenith (isometric-ish start)
      60,                 // radius: initial zoom distance
      Vector3.Zero(),
      scene,
    )
    camera.attachControl(true)
    camera.lowerBetaLimit = 0.2          // ~11° from zenith — near top-down view
    camera.upperBetaLimit = 1.45         // ~83° — nearly at horizon but not past it
    camera.lowerRadiusLimit = 10         // minimum zoom
    camera.upperRadiusLimit = 200        // maximum zoom out
    camera.wheelPrecision = 5            // scroll-to-zoom sensitivity
    camera.panningSensibility = 150      // right-click / two-finger pan

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
    const ground = MeshBuilder.CreateGround(
      'groundGrid',
      { width: groundSize, height: groundSize, subdivisions: 1 },
      scene,
    )
    const gridMat = new GridMaterial('gridMat', scene)
    gridMat.majorUnitFrequency = 10       // major lines every 10 units (city blocks)
    gridMat.minorUnitVisibility = 0.35    // subtle minor (1-unit) lines
    gridMat.gridRatio = 1.0              // 1 minor grid cell = 1 world unit
    gridMat.backFaceCulling = false
    gridMat.mainColor = new Color3(0.08, 0.10, 0.13)
    gridMat.lineColor = new Color3(0.28, 0.38, 0.50)
    ground.material = gridMat

    new BuildingSystem(scene)
  }
}
