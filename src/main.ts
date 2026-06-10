import { GameEngine } from './engine'
import { DemoScene, RoadGrid, ZoneManager, CitizenManager } from './game'
import { GridMap, RoadGraph, EconomyManager, SimulationEngine } from './simulation'
import { HUD, MiniMap, StatsPanel, ZoningToolbar } from './ui'

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
  const sim           = new SimulationEngine()

  const hud       = new HUD()
  const toolbar   = new ZoningToolbar()
  const miniMap   = new MiniMap(gridMap, scene.camera)
  const statsPanel = new StatsPanel()

  // ── Economy events ──────────────────────────────────────────────────────

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

  // ── SimulationEngine: subsystem ticks and state callbacks ──────────────

  sim.onTick((scaledDelta) => {
    economy.tick(scaledDelta)
    citizens.update(scaledDelta)
  })

  sim.onStateChange((state) => hud.updateSimState(state))
  sim.onHour((state) => hud.updateSimState(state))

  // Speed-control panel (top-right corner)
  hud.initSimPanel(
    () => sim.togglePause(),
    (speed) => sim.setSpeed(speed),
  )
  hud.updateSimState(sim.state)

  // ── Keyboard hotkeys: Space=pause, 1/2/3 = 1×/2×/4× ───────────────────

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    switch (e.key) {
      case ' ':
        e.preventDefault()
        sim.togglePause()
        break
      case '1': sim.setSpeed(1); break
      case '2': sim.setSpeed(2); break
      case '3': sim.setSpeed(4); break
    }
  })

  // ── Zoning toolbar ─────────────────────────────────────────────────────

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

  // ── Render loop ────────────────────────────────────────────────────────

  engine.start(() => {
    const realDelta = Math.min(engine.engine.getDeltaTime() / 1_000, 0.1)
    sim.tick(realDelta)          // drives economy + citizens via onTick
    hud.update(engine.engine.getFps())
    hud.updateEconomy(
      economy.balance,
      economy.lastIncome,
      economy.lastExpenses,
      economy.fiscalState,
      economy.secondsUntilCycle,
    )
    miniMap.update()
    statsPanel.push(
      citizens.count,
      economy.balance,
      economy.lastIncome,
      economy.lastExpenses,
      economy.fiscalState,
    )
  })
}

main().catch(console.error)
