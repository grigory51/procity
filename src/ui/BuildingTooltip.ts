import { Mesh, PointerEventTypes, Scene } from '@babylonjs/core'
import { CellType, GridMap } from '../simulation'
import type { EconomyManager } from '../simulation'
import type { CitizenManager } from '../game'

const ZONE_LABEL: Partial<Record<CellType, string>> = {
  [CellType.ZONE_RESIDENTIAL]: 'Residential',
  [CellType.ZONE_COMMERCIAL]:  'Commercial',
  [CellType.ZONE_INDUSTRIAL]:  'Industrial',
  [CellType.ROAD]:             'Road (local)',
  [CellType.ROAD_COLLECTOR]:   'Road (collector)',
  [CellType.ROAD_ARTERIAL]:    'Road (arterial)',
}

function fmtMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString()
}

export class BuildingTooltip {
  private el: HTMLDivElement
  private mouseX = 0
  private mouseY = 0
  private visible = false

  constructor(
    private readonly scene:    Scene,
    private readonly ground:   Mesh,
    private readonly gridMap:  GridMap,
    private readonly economy:  EconomyManager,
    private readonly citizens: CitizenManager,
  ) {
    this.el = document.createElement('div')
    this.el.style.cssText = [
      'position:fixed',
      'background:rgba(10,20,40,0.92)',
      'border:1px solid rgba(255,255,255,0.18)',
      'color:#fff', 'font-family:monospace', 'font-size:11px',
      'padding:7px 10px', 'border-radius:4px',
      'pointer-events:none', 'z-index:150',
      'line-height:1.7', 'min-width:160px',
      'display:none',
    ].join(';')
    document.body.appendChild(this.el)

    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX
      this.mouseY = e.clientY
    })

    scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE) {
        this.handleMove()
      } else if (
        info.type === PointerEventTypes.POINTERDOWN ||
        info.type === PointerEventTypes.POINTERUP
      ) {
        this.hide()
      }
    })
  }

  private handleMove(): void {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.ground,
    )

    if (!pick.hit || !pick.pickedPoint) {
      this.hide()
      return
    }

    const { x, z } = this.gridMap.worldToCell(pick.pickedPoint.x, pick.pickedPoint.z)
    const cellType = this.gridMap.get(x, z)

    if (cellType === CellType.EMPTY) {
      this.hide()
      return
    }

    this.showAt(x, z, cellType)
  }

  private showAt(cx: number, cz: number, cellType: CellType): void {
    const label = ZONE_LABEL[cellType] ?? 'Unknown'

    const lines: string[] = [
      `<span style="color:rgba(255,255,255,0.45);font-size:10px">${label.toUpperCase()}</span>`,
      `Cell (${cx}, ${cz})`,
    ]

    if (
      cellType === CellType.ZONE_RESIDENTIAL ||
      cellType === CellType.ZONE_COMMERCIAL  ||
      cellType === CellType.ZONE_INDUSTRIAL
    ) {
      const { residents, workers, shoppers } = this.citizens.citizensAtCell(cx, cz)
      if (cellType === CellType.ZONE_RESIDENTIAL && residents > 0) {
        lines.push(`<span style="color:#7ec8ff">🏠 ${residents} resident${residents !== 1 ? 's' : ''}</span>`)
      } else if (cellType === CellType.ZONE_COMMERCIAL) {
        if (workers > 0) {
          lines.push(`<span style="color:#7effc8">💼 ${workers} worker${workers !== 1 ? 's' : ''}</span>`)
        }
        if (shoppers > 0) {
          lines.push(`<span style="color:#ffd54f">🛍 ${shoppers} regular shopper${shoppers !== 1 ? 's' : ''}</span>`)
        }
      } else if (cellType === CellType.ZONE_INDUSTRIAL && workers > 0) {
        lines.push(`<span style="color:#ffcc80">🏭 ${workers} worker${workers !== 1 ? 's' : ''}</span>`)
      }

      const incomePerCell = this.computeIncomePerCell(cellType)
      if (incomePerCell > 0) {
        lines.push(`<span style="color:#4caf50">+${fmtMoney(incomePerCell)}/cycle tax</span>`)
      }

      const tier = this.bestRoadTierAt(cx, cz)
      if (tier === CellType.ROAD_ARTERIAL) {
        lines.push(`<span style="color:#ffa726">🛣 Arterial road (+50% tax bonus)</span>`)
      } else if (tier === CellType.ROAD_COLLECTOR) {
        lines.push(`<span style="color:#90caf9">🛤 Collector road</span>`)
      } else if (tier === CellType.ROAD) {
        lines.push(`<span style="color:rgba(255,255,255,0.5)">🛤 Local road</span>`)
      } else {
        lines.push(`<span style="color:#e53935">⚠ No road access</span>`)
      }
    }

    if (cellType === CellType.ROAD_ARTERIAL) {
      lines.push(`<span style="color:#ffa726">Boosts adjacent commercial zones +50%</span>`)
      lines.push(`<span style="color:#e53935">−${fmtMoney(this.economy.taxRates.roadMaintenance)}/cycle maint.</span>`)
    } else if (cellType === CellType.ROAD_COLLECTOR || cellType === CellType.ROAD) {
      lines.push(`<span style="color:#e53935">−${fmtMoney(this.economy.taxRates.roadMaintenance)}/cycle maint.</span>`)
    }

    this.el.innerHTML = lines.join('<br>')
    this.el.style.display = 'block'
    this.visible = true

    const offsetX = 14, offsetY = -8
    const vw = window.innerWidth, vh = window.innerHeight
    const w = this.el.offsetWidth || 170, h = this.el.offsetHeight || 80
    let left = this.mouseX + offsetX
    let top  = this.mouseY + offsetY
    if (left + w > vw - 8) left = this.mouseX - w - offsetX
    if (top  + h > vh - 8) top  = this.mouseY - h - 4
    this.el.style.left = `${left}px`
    this.el.style.top  = `${top}px`
  }

  private bestRoadTierAt(cx: number, cz: number): CellType | null {
    const neighbors = [
      { x: cx - 1, z: cz }, { x: cx + 1, z: cz },
      { x: cx, z: cz - 1 }, { x: cx, z: cz + 1 },
    ]
    let best: CellType | null = null
    for (const n of neighbors) {
      const cell = this.gridMap.get(n.x, n.z)
      if (cell === CellType.ROAD_ARTERIAL) return CellType.ROAD_ARTERIAL
      if (cell === CellType.ROAD_COLLECTOR) best = CellType.ROAD_COLLECTOR
      else if (cell === CellType.ROAD && best !== CellType.ROAD_COLLECTOR) best = CellType.ROAD
    }
    return best
  }

  private computeIncomePerCell(cellType: CellType): number {
    let lastTotal: number
    let cellCount: number
    if (cellType === CellType.ZONE_RESIDENTIAL) {
      lastTotal = this.economy.lastResidentialIncome
      cellCount = this.gridMap.countCellType(CellType.ZONE_RESIDENTIAL)
    } else {
      lastTotal = this.economy.lastCommercialIncome
      cellCount = this.gridMap.countCellType(CellType.ZONE_COMMERCIAL)
    }
    return cellCount > 0 ? lastTotal / cellCount : 0
  }

  private hide(): void {
    if (!this.visible) return
    this.visible = false
    this.el.style.display = 'none'
  }

  dispose(): void {
    this.el.remove()
  }
}
