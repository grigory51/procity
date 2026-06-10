import type { FiscalState, SimSpeed, SimTimeState } from '../simulation'

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
  private simPanel: HTMLDivElement | null = null
  private simTimeEl: HTMLSpanElement | null = null
  private simBtns: Map<string, HTMLButtonElement> = new Map()

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

  /**
   * Creates the simulation time and speed-control panel in the top-right corner.
   * Must be called once after the HUD is constructed.
   */
  initSimPanel(
    onPause:    () => void,
    onSetSpeed: (speed: SimSpeed) => void,
  ): void {
    const panel = document.createElement('div')
    panel.style.cssText = [
      'position:fixed', 'top:230px', 'right:16px',
      'color:#fff', 'font-family:monospace', 'font-size:12px',
      'background:rgba(0,0,0,0.6)', 'padding:8px 12px',
      'border-radius:4px', 'line-height:1.6',
      'display:flex', 'flex-direction:column', 'gap:6px',
      'user-select:none',
    ].join(';')

    const timeRow = document.createElement('div')
    timeRow.style.cssText = 'display:flex;align-items:center;gap:8px'

    const clockIcon = document.createElement('span')
    clockIcon.textContent = '🕐'
    clockIcon.style.fontSize = '11px'

    const timeEl = document.createElement('span')
    timeEl.textContent = 'Day 1  06:00'
    this.simTimeEl = timeEl

    timeRow.append(clockIcon, timeEl)

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:4px'

    const makeBtn = (id: string, label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.title = title
      btn.style.cssText = [
        'background:rgba(255,255,255,0.15)',
        'border:1px solid rgba(255,255,255,0.3)',
        'color:#fff', 'font-family:monospace', 'font-size:11px',
        'padding:2px 8px', 'border-radius:3px', 'cursor:pointer',
        'transition:background 0.1s',
      ].join(';')
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255,255,255,0.3)'
      })
      btn.addEventListener('mouseleave', () => {
        btn.style.background = this.simBtns.get(id) === btn && btn.dataset['active'] === '1'
          ? 'rgba(255,255,255,0.35)'
          : 'rgba(255,255,255,0.15)'
      })
      btn.addEventListener('click', onClick)
      this.simBtns.set(id, btn)
      return btn
    }

    const pauseBtn = makeBtn('pause', '⏸', 'Pause (Space)', onPause)
    const btn1x    = makeBtn('1x', '1×', 'Normal speed (1)', () => onSetSpeed(1))
    const btn2x    = makeBtn('2x', '2×', 'Fast (2)', () => onSetSpeed(2))
    const btn4x    = makeBtn('4x', '4×', 'Very fast (3)', () => onSetSpeed(4))

    btnRow.append(pauseBtn, btn1x, btn2x, btn4x)
    panel.append(timeRow, btnRow)
    document.body.appendChild(panel)
    this.simPanel = panel
  }

  updateSimState(state: SimTimeState): void {
    if (!this.simTimeEl) return
    const h  = state.gameHour.toString().padStart(2, '0')
    const indicator = state.isPaused ? ' ⏸' : ` ${state.speed}×`
    this.simTimeEl.textContent = `Day ${state.gameDay}  ${h}:00${indicator}`

    // Highlight the active button
    const activeId = state.isPaused ? 'pause' : `${state.speed}x`
    for (const [id, btn] of this.simBtns) {
      const isActive = id === activeId
      btn.dataset['active'] = isActive ? '1' : '0'
      btn.style.background = isActive ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)'
      btn.style.borderColor = isActive ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'
    }
  }

  dispose(): void {
    this.el.remove()
    this.simPanel?.remove()
    if (this.notificationTimer !== null) clearTimeout(this.notificationTimer)
    this.notificationEl?.remove()
  }
}
