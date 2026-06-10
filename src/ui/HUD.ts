import type { FiscalState } from '../simulation'

const STATE_COLOR: Record<FiscalState, string> = {
  surplus:    '#4caf50',
  deficit:    '#f5a623',
  bankruptcy: '#e53935',
}

const STATE_LABEL: Record<FiscalState, string> = {
  surplus:    'SURPLUS',
  deficit:    'DEFICIT',
  bankruptcy: 'BANKRUPT',
}

export class HUD {
  private el: HTMLDivElement
  private notificationEl: HTMLDivElement | null = null
  private notificationTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.el = document.createElement('div')
    this.el.style.cssText = [
      'position:fixed', 'top:16px', 'left:16px',
      'color:#fff', 'font-family:monospace', 'font-size:12px',
      'background:rgba(0,0,0,0.6)', 'padding:8px 12px',
      'border-radius:4px', 'pointer-events:none', 'line-height:1.6',
    ].join(';')
    this.el.innerHTML = 'Cities Skylines Browser'
    document.body.appendChild(this.el)
  }

  update(fps: number): void {
    this.updateFps(fps)
  }

  private updateFps(fps: number): void {
    // Preserve economy lines; only update the first line
    const lines = this.el.innerHTML.split('<br>')
    lines[0] = `Cities Skylines Browser — ${fps.toFixed(0)} FPS`
    this.el.innerHTML = lines.join('<br>')
  }

  updateEconomy(
    balance: number,
    lastIncome: number,
    lastExpenses: number,
    state: FiscalState,
    secondsUntilCycle: number,
  ): void {
    const fmt = (n: number): string =>
      '$' + Math.abs(Math.round(n)).toLocaleString()

    const stateColor = STATE_COLOR[state]
    const stateLabel = STATE_LABEL[state]
    const netChange = lastIncome - lastExpenses
    const netSign = netChange >= 0 ? '+' : '−'

    const fps = this.el.innerHTML.split('<br>')[0]
    this.el.innerHTML = [
      fps,
      `Balance: <span style="color:#fff;font-weight:bold">${fmt(balance)}</span>` +
        `  <span style="color:${stateColor};font-weight:bold">[${stateLabel}]</span>`,
      `Income: <span style="color:#4caf50">+${fmt(lastIncome)}</span>` +
        `  Expenses: <span style="color:#e53935">−${fmt(lastExpenses)}</span>` +
        `  Net: <span style="color:${netChange >= 0 ? '#4caf50' : '#e53935'}">${netSign}${fmt(Math.abs(netChange))}</span>`,
      `Next tax cycle: <span style="color:#aaa">${Math.ceil(secondsUntilCycle)}s</span>`,
    ].join('<br>')
  }

  showNotification(message: string, durationMs = 5_000): void {
    if (this.notificationTimer !== null) {
      clearTimeout(this.notificationTimer)
      this.notificationEl?.remove()
    }

    const note = document.createElement('div')
    note.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:rgba(180,20,20,0.92)',
      'color:#fff', 'font-family:monospace', 'font-size:18px', 'font-weight:bold',
      'padding:20px 36px', 'border-radius:8px',
      'border:2px solid #e53935',
      'pointer-events:none', 'z-index:200',
      'text-align:center',
    ].join(';')
    note.textContent = message
    document.body.appendChild(note)
    this.notificationEl = note

    this.notificationTimer = setTimeout(() => {
      note.remove()
      this.notificationEl = null
      this.notificationTimer = null
    }, durationMs)
  }

  dispose(): void {
    this.el.remove()
    if (this.notificationTimer !== null) clearTimeout(this.notificationTimer)
    this.notificationEl?.remove()
  }
}
