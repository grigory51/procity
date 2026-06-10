import { GameEngine } from './engine'
import { DemoScene } from './game'
import { HUD } from './ui'

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  if (!canvas) throw new Error('Canvas element not found')

  const engine = await GameEngine.create(canvas)
  new DemoScene(engine.scene)

  const hud = new HUD()

  engine.start(() => {
    hud.update(engine.engine.getFps())
  })
}

main().catch(console.error)
