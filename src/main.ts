import { GameEngine } from './engine'
import { DemoScene, RoadGrid, ZoneManager, CitizenManager } from './game'
import { GridMap, RoadGraph, EconomyManager } from './simulation'
import { HUD, MiniMap, ZoningToolbar } from './ui'

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  if (!canvas) throw new Error('Canvas element not found')

  const engine = await GameEngine.create(canvas)
  const scene = new DemoScene(engine.scene)
  const gridMap       = new GridMap()
  const roadGraph     = new RoadGraph(gridMap)
  const roadGrid      = new RoadGrid(engine.scene, scene.camera, gridMap, scene.ground)
  const zoneManager   = new ZoneManager(engine.scene, scene.camera, gridMap, scene.ground)
  const citizens      = new CitizenManager(engine.scene, gridMap, roadGraph)
  const economy       = new EconomyManager(gridMap)

  const hud = new HUD()
  const toolbar = new ZoningToolbar()
  const miniMap = new MiniMap(gridMap, scene.camera)

  economy.onBankruptcy(() => {
    hud.showNotification('⚠ CITY BANKRUPT! Build more zones to generate income.', 8_000)
  })

  economy.onTaxCycle((receipt) => {
    hud.updateEconomy(
      receipt.balance,
      receipt.income,
      receipt.expenses,
      receipt.state,
      economy.secondsUntilCycle,
    )
  })

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
    const deltaSeconds = Math.min(engine.engine.getDeltaTime() / 1_000, 0.1)
    economy.tick(deltaSeconds)
    citizens.update(deltaSeconds)
    hud.update(engine.engine.getFps())
    hud.updateEconomy(
      economy.balance,
      economy.lastIncome,
      economy.lastExpenses,
      economy.fiscalState,
      economy.secondsUntilCycle,
    )
    miniMap.update()
  })
}

main().catch(console.error)
