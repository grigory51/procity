import type { FiscalState } from '../simulation'

const STATE_COLOR: Record<FiscalState, string> = {
  surplus:    '#4caf50',
  deficit:    '#f5a623',
  bankruptcy: '#e53935',
}

interface Snapshot {
  population: number
  balance:    number
  income:     number
  expenses:   number
  state:      FiscalState
}

function fmt(n: number): string {
  return '$' + Math.abs(Math.round(n)).toLocaleString()
}

function row(label: string, valueId: string): HTMLDivElement {
  const div = document.createElement('div')
  div.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:2px 0'
  const lbl = document.createElement('span')
  lbl.style.color = 'rgba(255,255,255,0.55)'
  lbl.textContent = label
  const val = document.createElement('span')
  val.id = valueId
  val.style.fontWeight = 'bold'
  div.appendChild(lbl)
  div.appendChild(val)
  return div
}

export class StatsPanel {
  private el:          HTMLDivElement
  private spanPop:     HTMLSpanElement
  private spanBal:     HTMLSpanElement
  private spanInc:     HTMLSpanElement
  private spanExp:     HTMLSpanElement
  private spanNet:     HTMLSpanElement
  private spanState:   HTMLSpanElement
  private pending:     Snapshot | null = null
  private firstFlush   = true
  private intervalId:  ReturnType<typeof setInterval>

  constructor() {
    this.el = document.createElement('div')
    this.el.style.cssText = [
      'position:fixed',
      'top:130px',
      'left:16px',
      'color:#fff',
      'font-family:monospace',
      'font-size:12px',
      'background:rgba(0,0,0,0.6)',
      'padding:8px 12px',
      'border-radius:4px',
      'pointer-events:none',
      'line-height:1.6',
      'min-width:190px',
    ].join(';')

    const title = document.createElement('div')
    title.style.cssText = 'font-size:11px;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin-bottom:4px;text-transform:uppercase'
    title.textContent = 'City Statistics'
    this.el.appendChild(title)

    const rowPop   = row('Population',  'sp-pop')
    const rowBal   = row('Balance',     'sp-bal')
    const rowInc   = row('Income',      'sp-inc')
    const rowExp   = row('Expenses',    'sp-exp')
    const rowNet   = row('Net / cycle', 'sp-net')
    const rowState = row('Fiscal',      'sp-state')

    for (const r of [rowPop, rowBal, rowInc, rowExp, rowNet, rowState]) {
      this.el.appendChild(r)
    }

    document.body.appendChild(this.el)

    this.spanPop   = document.getElementById('sp-pop')   as HTMLSpanElement
    this.spanBal   = document.getElementById('sp-bal')   as HTMLSpanElement
    this.spanInc   = document.getElementById('sp-inc')   as HTMLSpanElement
    this.spanExp   = document.getElementById('sp-exp')   as HTMLSpanElement
    this.spanNet   = document.getElementById('sp-net')   as HTMLSpanElement
    this.spanState = document.getElementById('sp-state') as HTMLSpanElement

    // Seed with zeroes so the panel isn't blank on first load
    this.applySnapshot({ population: 0, balance: 0, income: 0, expenses: 0, state: 'surplus' })

    // Flush queued values every 2 s — no per-frame DOM thrashing
    this.intervalId = setInterval(() => this.flush(), 2_000)
  }

  /**
   * Buffer the latest simulation values.
   * Safe to call every render frame — DOM is only written by flush().
   */
  push(
    population: number,
    balance:    number,
    income:     number,
    expenses:   number,
    state:      FiscalState,
  ): void {
    this.pending = { population, balance, income, expenses, state }
    // Flush immediately on first push so the panel populates before the first 2 s tick
    if (this.firstFlush) {
      this.firstFlush = false
      this.flush()
    }
  }

  private flush(): void {
    if (!this.pending) return
    this.applySnapshot(this.pending)
    this.pending = null
  }

  private applySnapshot(s: Snapshot): void {
    const net = s.income - s.expenses

    this.spanPop.textContent   = s.population.toLocaleString()
    this.spanBal.textContent   = fmt(s.balance)
    this.spanInc.textContent   = '+' + fmt(s.income)
    this.spanInc.style.color   = '#4caf50'
    this.spanExp.textContent   = '−' + fmt(s.expenses)
    this.spanExp.style.color   = '#e53935'
    this.spanNet.textContent   = (net >= 0 ? '+' : '−') + fmt(Math.abs(net))
    this.spanNet.style.color   = net >= 0 ? '#4caf50' : '#e53935'
    this.spanState.textContent = s.state.toUpperCase()
    this.spanState.style.color = STATE_COLOR[s.state]
  }

  dispose(): void {
    clearInterval(this.intervalId)
    this.el.remove()
  }
}
