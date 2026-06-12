import { GameEngine } from './engine'
import { DemoScene, RoadGrid, ZoneManager, CitizenManager } from './game'
import type { RoadTier } from './game/RoadGrid'
import { GridMap, CellType, RoadGraph, EconomyManager, SimulationEngine, SaveSystem, isRoadCell } from './simulation'
import { HUD, MiniMap, StatsPanel, BottomPanel, TutorialPanel, BuildingTooltip } from './ui'

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

  const hud        = new HUD()
  const toolbar    = new BottomPanel()
  const miniMap    = new MiniMap(gridMap, scene.camera)
  const statsPanel = new StatsPanel()

  // ── UX clarity: onboarding, tooltips, activity panel ──────────────────
  new TutorialPanel()
  new BuildingTooltip(engine.scene, scene.ground, gridMap, economy, citizens)
  hud.initActivityPanel()

  // ── Restore saved state ────────────────────────────────────────────────

  const saved = SaveSystem.load()
  if (saved) {
    try {
      const cells = SaveSystem.decodeCells(saved.cells)
      gridMap.loadFrom(cells)
      economy.restoreBalance(saved.balance)
      sim.restoreState(saved.simSpeed, saved.simPaused)

      // Rebuild visuals from cell data
      for (let z = 0; z < gridMap.height; z++) {
        for (let x = 0; x < gridMap.width; x++) {
          const cell = gridMap.get(x, z)
          if (isRoadCell(cell)) {
            roadGrid.restoreAt(x, z)   // restoreAt reads tier from GridMap
          } else if (cell !== CellType.EMPTY) {
            zoneManager.restoreAt(x, z, cell)
          }
        }
      }
    } catch {
      // Corrupt save data — start fresh silently
    }
  }

  // ── AutoSave ───────────────────────────────────────────────────────────

  const saveSystem = new SaveSystem(gridMap.version, () => {
    SaveSystem.write({
      version: 1,
      cells: SaveSystem.encodeCells(gridMap.getCells()),
      balance: economy.balance,
      simSpeed: sim.speed,
      simPaused: sim.isPaused,
    })
    hud.showSaveIndicator()
  })

  // Flush any pending debounced save before the page unloads so rapid
  // reloads do not lose the last changes (debounce would otherwise be
  // cancelled by the browser before it fires).
  window.addEventListener('beforeunload', () => { saveSystem.flush() })

  // ── Road adjacency notification ────────────────────────────────────────

  zoneManager.onNoRoadAccess(() => {
    hud.showNotification('🚫 No road access — build a road first', 3_000)
  })

  zoneManager.onWrongRoadTier((zone, needed) => {
    const zoneName = zone.charAt(0).toUpperCase() + zone.slice(1)
    hud.showNotification(`🚫 ${zoneName} zones need ${needed}`, 3_000)
  })

  zoneManager.onDemolishRoad((cx, cz) => {
    roadGrid.removeAt(cx, cz)
    zoneManager.refreshGhostLayer()
  })

  // ── Road placement events ──────────────────────────────────────────────

  // Refresh ghost layer so newly placed roads unlock adjacent cells immediately
  roadGrid.onRoadPlaced(() => {
    zoneManager.refreshGhostLayer()
  })

  // ── Urban design one-time tooltips ─────────────────────────────────────

  let roadToolTipShown = false
  let intersectionTipShown = false

  roadGrid.onIntersectionCreated(() => {
    if (intersectionTipShown) return
    intersectionTipShown = true
    hud.showNotification('🏙 Intersections create the blocks your city grows into', 5_000)
  })

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
    saveSystem.scheduleSave()  // persist balance after each tax cycle
    statsPanel.pushCycleNet(receipt.netChange)

    const resCells = gridMap.countCellType(CellType.ZONE_RESIDENTIAL)
    const comCells = gridMap.countCellType(CellType.ZONE_COMMERCIAL)
    const resInc   = Math.round(economy.lastResidentialIncome)
    const comInc   = Math.round(economy.lastCommercialIncome)
    const roadCost = Math.round(receipt.expenses)
    if (resCells + comCells > 0) {
      hud.logActivity(
        `💰 +$${resInc.toLocaleString()} res (${resCells}) · +$${comInc.toLocaleString()} com (${comCells}) · −$${roadCost.toLocaleString()} roads`
      )
    } else {
      hud.logActivity('💰 Tax cycle: no zones yet — build residential zones to earn income')
    }
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

  hud.addNewGameButton(() => {
    SaveSystem.clear()
    window.location.reload()
  })

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

  const ROAD_TIER_MAP: Record<string, RoadTier> = {
    road_local:     'local',
    road_collector: 'collector',
    road_arterial:  'arterial',
  }

  let upgradeTipShown = false

  toolbar.onChange(tool => {
    if (tool === 'road_local' || tool === 'road_collector' || tool === 'road_arterial') {
      roadGrid.setTier(ROAD_TIER_MAP[tool])
      zoneManager.setTool(null)
      roadGrid.activate()

      // First-time road tool tip
      if (!roadToolTipShown) {
        roadToolTipShown = true
        hud.showNotification(
          '🛤 Build roads first — zones grow along road edges, just like real cities',
          6_000,
        )
      }
    } else if (tool === 'road_upgrade') {
      roadGrid.setMode('upgrade')
      zoneManager.setTool(null)
      roadGrid.activate()

      if (!upgradeTipShown) {
        upgradeTipShown = true
        hud.showNotification('⬆ Click a local road to upgrade it to collector, or collector to arterial', 5_000)
      }
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

  roadGrid.onRoadUpgraded(() => {
    zoneManager.refreshGhostLayer()
  })

  // ── Render loop ────────────────────────────────────────────────────────

  let firstCommuteLogged = false

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
    miniMap.update(citizens.count)
    hud.updateCitizenActivity(citizens.commutingCount, citizens.atHomeCount, citizens.atWorkCount)
    if (!firstCommuteLogged && citizens.commutingCount > 0) {
      firstCommuteLogged = true
      hud.logActivity('👨‍💼 First residents are commuting — tax income grows as more zones are built!')
    }
    statsPanel.push(
      citizens.count,
      economy.balance,
      economy.lastIncome,
      economy.lastExpenses,
      economy.fiscalState,
      economy.lastResidentialIncome,
      economy.lastCommercialIncome,
    )
    saveSystem.checkVersion(gridMap.version)
  })
}

main().catch(console.error)
