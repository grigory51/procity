import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

export class DemoScene {
  private angle = 0

  constructor(scene: Scene) {
    this.setup(scene)
  }

  private setup(scene: Scene): void {
    // Camera
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 4, 8, Vector3.Zero(), scene)
    camera.attachControl()
    camera.lowerRadiusLimit = 3
    camera.upperRadiusLimit = 20

    // Lighting
    new HemisphericLight('ambient', new Vector3(0, 1, 0), scene).intensity = 0.4
    const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
    sun.intensity = 0.8
    sun.diffuse = new Color3(1, 0.95, 0.8)

    // Rotating cube
    const cube = MeshBuilder.CreateBox('cube', { size: 2 }, scene)
    const mat = new StandardMaterial('cubeMat', scene)
    mat.diffuseColor = new Color3(0.2, 0.6, 1)
    mat.specularColor = new Color3(0.3, 0.3, 0.3)
    cube.material = mat

    // Ground plane
    const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12 }, scene)
    const groundMat = new StandardMaterial('groundMat', scene)
    groundMat.diffuseColor = new Color3(0.15, 0.15, 0.2)
    ground.material = groundMat
    ground.position.y = -1.5

    // Register rotation update
    scene.registerBeforeRender(() => {
      this.angle += 0.01
      cube.rotation.y = this.angle
      cube.rotation.x = this.angle * 0.4
    })
  }
}
