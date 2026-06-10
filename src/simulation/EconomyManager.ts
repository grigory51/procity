import { CellType, GridMap } from './GridMap'

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

export class EconomyManager {
  private _balance: number
  private _lastIncome = 0
  private _lastExpenses = 0
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
  get fiscalState(): FiscalState { return this._state }
  get taxRates(): Readonly<TaxRates> { return this._taxRates }
  /** Seconds remaining until next tax cycle fires */
  get secondsUntilCycle(): number { return TAX_CYCLE_SECONDS - this._elapsed }

  onBankruptcy(cb: () => void): void { this._onBankruptcyCb = cb }
  onTaxCycle(cb: (receipt: TaxReceipt) => void): void { this._onTaxCycleCb = cb }

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
    const income = this._computeIncome(counts)
    const expenses = counts.roads * this._taxRates.roadMaintenance
    const net = income - expenses

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
        switch (this.gridMap.get(x, z)) {
          case CellType.ZONE_RESIDENTIAL: residential++; break
          case CellType.ZONE_COMMERCIAL:  commercial++;  break
          case CellType.ZONE_INDUSTRIAL:  industrial++;  break
          case CellType.ROAD:             roads++;        break
        }
      }
    }
    return { residential, commercial, industrial, roads }
  }
}
