import {
  AbstractEngine,
  Engine,
  Scene,
  WebGPUEngine,
} from '@babylonjs/core'

export class GameEngine {
  readonly engine: AbstractEngine
  readonly scene: Scene

  private constructor(engine: AbstractEngine, scene: Scene) {
    this.engine = engine
    this.scene = scene
  }

  static async create(canvas: HTMLCanvasElement): Promise<GameEngine> {
    let engine: AbstractEngine

    // Prefer WebGPU when available, fall back to WebGL
    if (await WebGPUEngine.IsSupportedAsync) {
      const webgpu = new WebGPUEngine(canvas)
      await webgpu.initAsync()
      engine = webgpu
    } else {
      engine = new Engine(canvas, true)
    }

    const scene = new Scene(engine)
    return new GameEngine(engine, scene)
  }

  start(renderFn?: () => void): void {
    this.engine.runRenderLoop(() => {
      renderFn?.()
      this.scene.render()
    })

    window.addEventListener('resize', () => {
      this.engine.resize()
    })
  }

  dispose(): void {
    this.engine.dispose()
  }
}
