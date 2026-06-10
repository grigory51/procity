import { GameEngine } from './engine'
import { DemoScene, RoadGrid, ZoneManager } from './game'
import { GridMap } from './simulation'
import { HUD, MiniMap, ZoningToolbar } from './ui'

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  if (!canvas) throw new Error('Canvas element not found')

  const engine = await GameEngine.create(canvas)
  const scene = new DemoScene(engine.scene)
  const gridMap = new GridMap()
  const roadGrid = new RoadGrid(engine.scene, scene.camera, gridMap, scene.ground)
  const zoneManager = new ZoneManager(engine.scene, scene.camera, gridMap, scene.ground)

  const hud = new HUD()
  const toolbar = new ZoningToolbar()
  const miniMap = new MiniMap(gridMap, scene.camera)

  toolbar.onChange(tool => {
    if (tool === 'road') {
      zoneManager.setTool(null)
      roadGrid.activate()
    } else if (
      tool === 'residential' ||
      tool === 'commercial' ||
      tool === 'industrial' ||
      tool === 'demolish'
    ) {
      roadGrid.deactivate()
      zoneManager.setTool(tool)
    } else {
      roadGrid.deactivate()
      zoneManager.setTool(null)
    }
  })

  engine.start(() => {
    hud.update(engine.engine.getFps())
    miniMap.update()
  })
}

main().catch(console.error)
