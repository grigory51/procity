import type { FiscalState } from '../simulation'

const STATE_COLOR: Record<FiscalState, string> = {
  surplus:    '#4caf50',
  deficit:    '#f5a623',
  bankruptcy: '#e53935',
}

interface Snapshot {
  population:          number
  balance:             number
  income:              number
  expenses:            number
  state:               FiscalState
  residentialIncome:   number
  commercialIncome:    number
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
  private el:            HTMLDivElement
  private spanPop:       HTMLSpanElement
  private spanBal:       HTMLSpanElement
  private spanInc:       HTMLSpanElement
  private spanResInc:    HTMLSpanElement
  private spanComInc:    HTMLSpanElement
  private spanExp:       HTMLSpanElement
  private spanNet:       HTMLSpanElement
  private spanState:     HTMLSpanElement
  private pending:       Snapshot | null = null
  private firstFlush     = true
  private intervalId:    ReturnType<typeof setInterval>
  private cycleNets:     number[] = []
  private trendEl:       HTMLDivElement | null = null

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
      'min-width:200px',
    ].join(';')

    const title = document.createElement('div')
    title.style.cssText = 'font-size:11px;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin-bottom:4px;text-transform:uppercase'
    title.textContent = 'City Statistics'
    this.el.appendChild(title)

    const rowPop    = row('Population',    'sp-pop')
    const rowBal    = row('Balance',       'sp-bal')
    const rowInc    = row('Income',        'sp-inc')
    const rowResInc = row('· Residential', 'sp-res-inc')
    const rowComInc = row('· Commercial',  'sp-com-inc')
    const rowExp    = row('Services cost', 'sp-exp')
    const rowNet    = row('Net / cycle',   'sp-net')
    const rowState  = row('Fiscal',        'sp-state')

    // Indent sub-rows
    for (const subRow of [rowResInc, rowComInc]) {
      subRow.style.paddingLeft = '8px'
      subRow.querySelector('span')!.style.color = 'rgba(255,255,255,0.35)'
    }

    for (const r of [rowPop, rowBal, rowInc, rowResInc, rowComInc, rowExp, rowNet, rowState]) {
      this.el.appendChild(r)
    }

    const trendHeader = document.createElement('div')
    trendHeader.style.cssText = 'margin-top:6px;font-size:10px;letter-spacing:0.06em;color:rgba(255,255,255,0.3);text-transform:uppercase'
    trendHeader.textContent = 'Last 5 cycles'

    const trendEl = document.createElement('div')
    trendEl.style.cssText = 'height:20px;display:flex;align-items:flex-end;gap:3px;margin-top:3px'
    trendEl.innerHTML = '<span style="font-size:10px;color:rgba(255,255,255,0.2)">— no data yet</span>'
    this.trendEl = trendEl

    this.el.appendChild(trendHeader)
    this.el.appendChild(trendEl)

    document.body.appendChild(this.el)

    this.spanPop    = document.getElementById('sp-pop')     as HTMLSpanElement
    this.spanBal    = document.getElementById('sp-bal')     as HTMLSpanElement
    this.spanInc    = document.getElementById('sp-inc')     as HTMLSpanElement
    this.spanResInc = document.getElementById('sp-res-inc') as HTMLSpanElement
    this.spanComInc = document.getElementById('sp-com-inc') as HTMLSpanElement
    this.spanExp    = document.getElementById('sp-exp')     as HTMLSpanElement
    this.spanNet    = document.getElementById('sp-net')     as HTMLSpanElement
    this.spanState  = document.getElementById('sp-state')   as HTMLSpanElement

    // Seed with zeroes so the panel isn't blank on first load
    this.applySnapshot({ population: 0, balance: 0, income: 0, expenses: 0, state: 'surplus', residentialIncome: 0, commercialIncome: 0 })

    // Flush queued values every 2 s — no per-frame DOM thrashing
    this.intervalId = setInterval(() => this.flush(), 2_000)
  }

  /**
   * Buffer the latest simulation values.
   * Safe to call every render frame — DOM is only written by flush().
   */
  push(
    population:        number,
    balance:           number,
    income:            number,
    expenses:          number,
    state:             FiscalState,
    residentialIncome: number,
    commercialIncome:  number,
  ): void {
    this.pending = { population, balance, income, expenses, state, residentialIncome, commercialIncome }
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

    this.spanPop.textContent    = s.population.toLocaleString()
    this.spanBal.textContent    = fmt(s.balance)
    this.spanInc.textContent    = '+' + fmt(s.income)
    this.spanInc.style.color    = '#4caf50'
    this.spanResInc.textContent = '+' + fmt(s.residentialIncome)
    this.spanResInc.style.color = '#4caf50'
    this.spanComInc.textContent = '+' + fmt(s.commercialIncome)
    this.spanComInc.style.color = '#4caf50'
    this.spanExp.textContent    = '−' + fmt(s.expenses)
    this.spanExp.style.color    = '#e53935'
    this.spanNet.textContent    = (net >= 0 ? '+' : '−') + fmt(Math.abs(net))
    this.spanNet.style.color    = net >= 0 ? '#4caf50' : '#e53935'
    this.spanState.textContent  = s.state.toUpperCase()
    this.spanState.style.color  = STATE_COLOR[s.state]
  }

  /** Record the net change from a completed tax cycle and update the trend bars. */
  pushCycleNet(net: number): void {
    this.cycleNets.push(net)
    if (this.cycleNets.length > 5) this.cycleNets.shift()
    this.renderTrend()
  }

  private renderTrend(): void {
    if (!this.trendEl || this.cycleNets.length === 0) return
    const maxAbs = Math.max(...this.cycleNets.map(n => Math.abs(n)), 1)
    this.trendEl.innerHTML = this.cycleNets.map(n => {
      const heightPct = Math.max(Math.round(Math.abs(n) / maxAbs * 100), 10)
      const color = n >= 0 ? '#4caf50' : '#e53935'
      const label = (n >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(n)).toLocaleString()
      return `<div title="${label}" style="background:${color};width:14px;height:${heightPct}%;min-height:3px;border-radius:2px 2px 0 0;flex-shrink:0"></div>`
    }).join('')
  }

  dispose(): void {
    clearInterval(this.intervalId)
    this.el.remove()
  }
}
