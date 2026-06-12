import { CellType, GridMap, isRoadCell } from './GridMap'

export type FiscalState = 'surplus' | 'deficit' | 'bankruptcy'

export interface TaxRates {
  residential: number
  commercial: number
  industrial: number
  roadMaintenance: number
}

export interface TaxReceipt {
  income: number
  expenses: number
  netChange: number
  balance: number
  state: FiscalState
}

const DEFAULT_TAX_RATES: TaxRates = {
  residential: 10,
  commercial: 25,
  industrial: 15,
  roadMaintenance: 2,
}

export const TAX_CYCLE_SECONDS = 30
const BANKRUPTCY_THRESHOLD = -1_000
// Density multiplier caps at 2× when zone has this many cells
const MAX_DENSITY_CELLS = 200
// Arterial roads boost adjacent commercial tax yield by 50%
const ARTERIAL_COMMERCIAL_BONUS = 0.5

export class EconomyManager {
  private _balance: number
  private _lastIncome = 0
  private _lastExpenses = 0
  private _lastResidentialIncome = 0
  private _lastCommercialIncome = 0
  private _lastCitizenShopRevenue = 0
  private _citizenShopRevenue = 0  // accumulates between tax cycles
  private _state: FiscalState = 'surplus'
  private _elapsed = 0
  private _taxRates: TaxRates
  private _bankruptcyNotified = false
  private _onBankruptcyCb: (() => void) | null = null
  private _onTaxCycleCb: ((receipt: TaxReceipt) => void) | null = null

  constructor(
    private readonly gridMap: GridMap,
    initialBalance = 10_000,
    taxRates?: Partial<TaxRates>,
  ) {
    this._balance = initialBalance
    this._taxRates = { ...DEFAULT_TAX_RATES, ...taxRates }
  }

  get balance(): number { return this._balance }
  get lastIncome(): number { return this._lastIncome }
  get lastExpenses(): number { return this._lastExpenses }
  get lastResidentialIncome(): number { return this._lastResidentialIncome }
  get lastCommercialIncome(): number { return this._lastCommercialIncome }
  /** Citizen shopping revenue included in the most recent tax cycle. */
  get lastCitizenShopRevenue(): number { return this._lastCitizenShopRevenue }
  get fiscalState(): FiscalState { return this._state }
  get taxRates(): Readonly<TaxRates> { return this._taxRates }
  /** Seconds remaining until next tax cycle fires */
  get secondsUntilCycle(): number { return TAX_CYCLE_SECONDS - this._elapsed }

  onBankruptcy(cb: () => void): void { this._onBankruptcyCb = cb }
  onTaxCycle(cb: (receipt: TaxReceipt) => void): void { this._onTaxCycleCb = cb }

  /** Restores balance from a saved state. */
  restoreBalance(balance: number): void { this._balance = balance }

  /** Called by CitizenManager each time a citizen completes a shopping trip. Accumulates until next tax cycle. */
  addShopRevenue(amount: number): void {
    this._citizenShopRevenue += amount
  }

  /** Advance the simulation. deltaSeconds = real elapsed seconds × timeScale. */
  tick(deltaSeconds: number): void {
    this._elapsed += deltaSeconds
    if (this._elapsed >= TAX_CYCLE_SECONDS) {
      this._elapsed -= TAX_CYCLE_SECONDS
      this._runCycle()
    }
  }

  private _runCycle(): void {
    const counts = this._countCells()
    const arterialBonus = this._computeArterialBonus()

    // Collect and reset citizen shopping revenue accumulated since last cycle
    const shopRevenue = this._citizenShopRevenue
    this._citizenShopRevenue = 0
    this._lastCitizenShopRevenue = shopRevenue

    const income = this._computeIncome(counts) + arterialBonus + shopRevenue
    const expenses = counts.roads * this._taxRates.roadMaintenance
    const net = income - expenses

    const r = this._taxRates
    this._lastResidentialIncome = counts.residential * r.residential * this._densityMultiplier(counts.residential)
    this._lastCommercialIncome  = counts.commercial  * r.commercial  * this._densityMultiplier(counts.commercial) + arterialBonus + shopRevenue

    this._balance += net
    this._lastIncome = income
    this._lastExpenses = expenses
    this._state = this._computeState(this._balance, net)

    const receipt: TaxReceipt = {
      income,
      expenses,
      netChange: net,
      balance: this._balance,
      state: this._state,
    }
    this._onTaxCycleCb?.(receipt)

    if (this._state === 'bankruptcy' && !this._bankruptcyNotified) {
      this._bankruptcyNotified = true
      this._onBankruptcyCb?.()
    } else if (this._state !== 'bankruptcy') {
      // Allow re-notification if player recovers and then goes bankrupt again
      this._bankruptcyNotified = false
    }
  }

  private _computeIncome(counts: {
    residential: number
    commercial: number
    industrial: number
  }): number {
    const r = this._taxRates
    return (
      counts.residential * r.residential * this._densityMultiplier(counts.residential) +
      counts.commercial  * r.commercial  * this._densityMultiplier(counts.commercial)  +
      counts.industrial  * r.industrial  * this._densityMultiplier(counts.industrial)
    )
  }

  /**
   * Arterial road adjacency bonus: each commercial cell next to an arterial earns +50% of its
   * base commercial tax rate. Encourages players to route arterials through commercial areas.
   * Example: 10 commercial cells adjacent to arterials × $25 × 0.5 = $125 bonus per cycle.
   */
  private _computeArterialBonus(): number {
    let bonus = 0
    const { width, height } = this.gridMap
    const r = this._taxRates
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (this.gridMap.get(x, z) !== CellType.ZONE_COMMERCIAL) continue
        const neighbors = [
          { x: x - 1, z }, { x: x + 1, z },
          { x, z: z - 1 }, { x, z: z + 1 },
        ]
        if (neighbors.some(n => this.gridMap.get(n.x, n.z) === CellType.ROAD_ARTERIAL)) {
          bonus += r.commercial * ARTERIAL_COMMERCIAL_BONUS
        }
      }
    }
    return bonus
  }

  /**
   * Density bonus: each zone type earns more per cell as more of that type is built.
   * Scales linearly from 1× (0 cells) to 2× (MAX_DENSITY_CELLS+).
   */
  private _densityMultiplier(count: number): number {
    return 1.0 + Math.min(count, MAX_DENSITY_CELLS) / MAX_DENSITY_CELLS
  }

  private _computeState(balance: number, net: number): FiscalState {
    if (balance <= BANKRUPTCY_THRESHOLD) return 'bankruptcy'
    if (net < 0) return 'deficit'
    return 'surplus'
  }

  private _countCells(): {
    residential: number
    commercial: number
    industrial: number
    roads: number
  } {
    let residential = 0, commercial = 0, industrial = 0, roads = 0
    const { width, height } = this.gridMap
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cell = this.gridMap.get(x, z)
        switch (cell) {
          case CellType.ZONE_RESIDENTIAL: residential++; break
          case CellType.ZONE_COMMERCIAL:  commercial++;  break
          case CellType.ZONE_INDUSTRIAL:  industrial++;  break
          default:
            if (isRoadCell(cell)) roads++
            break
        }
      }
    }
    return { residential, commercial, industrial, roads }
  }
}
