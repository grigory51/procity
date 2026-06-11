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
  private activityPanel: HTMLDivElement | null = null
  private activityCollapsed = false
  private activityCommutingEl: HTMLSpanElement | null = null
  private activityAtHomeEl: HTMLSpanElement | null = null
  private activityAtWorkEl: HTMLSpanElement | null = null
  private activityLogEl: HTMLDivElement | null = null
  private activityLogEntries: string[] = []
  private saveIndicatorEl: HTMLDivElement | null = null
  private saveIndicatorTimer: ReturnType<typeof setTimeout> | null = null

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

  /** Appends a "New Game" button to the sim panel. Call after initSimPanel. */
  addNewGameButton(onClick: () => void): void {
    if (!this.simPanel) return
    const btn = document.createElement('button')
    btn.textContent = 'New Game'
    btn.title = 'Clear save and start a fresh city'
    btn.style.cssText = [
      'background:rgba(200,50,50,0.25)',
      'border:1px solid rgba(200,50,50,0.5)',
      'color:#ffaaaa', 'font-family:monospace', 'font-size:11px',
      'padding:2px 8px', 'border-radius:3px', 'cursor:pointer',
      'transition:background 0.1s', 'width:100%', 'text-align:center',
    ].join(';')
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(200,50,50,0.5)'
    })
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(200,50,50,0.25)'
    })
    btn.addEventListener('click', onClick)
    this.simPanel.appendChild(btn)
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

  /** Creates the "What's Happening" activity panel at the bottom-left. */
  initActivityPanel(): void {
    const panel = document.createElement('div')
    panel.style.cssText = [
      'position:fixed', 'bottom:16px', 'left:16px',
      'color:#fff', 'font-family:monospace', 'font-size:12px',
      'background:rgba(0,0,0,0.65)', 'padding:8px 12px',
      'border-radius:4px', 'line-height:1.7',
      'min-width:240px', 'user-select:none',
    ].join(';')

    const header = document.createElement('div')
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:4px'

    const title = document.createElement('span')
    title.style.cssText = 'font-size:11px;letter-spacing:0.08em;color:rgba(255,255,255,0.45);text-transform:uppercase'
    title.textContent = 'What\'s Happening'

    const toggle = document.createElement('span')
    toggle.textContent = '▼'
    toggle.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.45);transition:transform 0.15s'

    header.append(title, toggle)
    header.addEventListener('click', () => {
      this.activityCollapsed = !this.activityCollapsed
      body.style.display = this.activityCollapsed ? 'none' : 'block'
      toggle.textContent = this.activityCollapsed ? '▶' : '▼'
    })

    const body = document.createElement('div')

    const mkRow = (icon: string, id: string): HTMLDivElement => {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;gap:6px;align-items:center'
      const iconEl = document.createElement('span')
      iconEl.textContent = icon
      const valEl = document.createElement('span')
      valEl.id = id
      valEl.style.color = 'rgba(255,255,255,0.85)'
      row.append(iconEl, valEl)
      return row
    }

    body.appendChild(mkRow('👤', 'hud-act-commuting'))
    body.appendChild(mkRow('🏠', 'hud-act-home'))
    body.appendChild(mkRow('🏪', 'hud-act-work'))

    const sep = document.createElement('div')
    sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.1);margin:5px 0 3px'
    body.appendChild(sep)

    const logLabel = document.createElement('div')
    logLabel.style.cssText = 'font-size:10px;letter-spacing:0.06em;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-bottom:2px'
    logLabel.textContent = 'Recent Events'
    body.appendChild(logLabel)

    const logEl = document.createElement('div')
    logEl.style.cssText = [
      'max-height:110px', 'overflow-y:auto',
      'font-size:10px', 'line-height:1.6',
      'color:rgba(255,255,255,0.6)',
      'scrollbar-width:none',
    ].join(';')
    body.appendChild(logEl)
    this.activityLogEl = logEl
    this.activityLogEntries = ['🛤 Residents commute to shops along roads — each trip earns taxes']
    logEl.textContent = this.activityLogEntries[0]

    panel.append(header, body)
    document.body.appendChild(panel)
    this.activityPanel = panel
    this.activityCommutingEl = document.getElementById('hud-act-commuting') as HTMLSpanElement
    this.activityAtHomeEl    = document.getElementById('hud-act-home')      as HTMLSpanElement
    this.activityAtWorkEl    = document.getElementById('hud-act-work')      as HTMLSpanElement
  }

  /** Prepends a plain-language event to the activity log (max 10 entries). */
  logActivity(message: string): void {
    if (!this.activityLogEl) return
    this.activityLogEntries.unshift(message)
    if (this.activityLogEntries.length > 10) this.activityLogEntries.pop()
    this.activityLogEl.innerHTML = this.activityLogEntries
      .map((e, i) => `<div style="opacity:${1 - i * 0.08};padding:1px 0">${e}</div>`)
      .join('')
    this.activityLogEl.scrollTop = 0
  }

  /** Shows a brief non-intrusive "✓ Saved" badge at the bottom-right. */
  showSaveIndicator(): void {
    if (this.saveIndicatorTimer !== null) {
      clearTimeout(this.saveIndicatorTimer)
      this.saveIndicatorEl?.remove()
    }
    const el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px',
      'background:rgba(20,160,60,0.88)',
      'color:#fff', 'font-family:monospace', 'font-size:11px',
      'padding:4px 10px', 'border-radius:3px',
      'pointer-events:none', 'z-index:150',
      'opacity:1', 'transition:opacity 0.4s',
    ].join(';')
    el.textContent = '✓ Saved'
    document.body.appendChild(el)
    this.saveIndicatorEl = el
    this.saveIndicatorTimer = setTimeout(() => {
      el.style.opacity = '0'
      setTimeout(() => {
        el.remove()
        if (this.saveIndicatorEl === el) this.saveIndicatorEl = null
        this.saveIndicatorTimer = null
      }, 400)
    }, 1_200)
  }

  updateCitizenActivity(commuting: number, atHome: number, atWork: number): void {
    if (!this.activityCommutingEl) return
    this.activityCommutingEl.textContent = `${commuting} citizens commuting`
    this.activityAtHomeEl!.textContent   = `${atHome} residents home`
    this.activityAtWorkEl!.textContent   = `${atWork} shopping`
  }

  dispose(): void {
    this.el.remove()
    this.simPanel?.remove()
    this.activityPanel?.remove()
    if (this.notificationTimer !== null) clearTimeout(this.notificationTimer)
    this.notificationEl?.remove()
    if (this.saveIndicatorTimer !== null) clearTimeout(this.saveIndicatorTimer)
    this.saveIndicatorEl?.remove()
  }
}
