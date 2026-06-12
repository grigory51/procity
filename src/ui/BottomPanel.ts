export type ZoneType =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'road_local'
  | 'road_collector'
  | 'road_arterial'
  | 'road_upgrade'
  | 'demolish'
  | null

interface ToolDef {
  key: Exclude<ZoneType, null>
  label: string
  hotkey: string
  bg: string
  activeBg: string
  activeBorder: string
}

interface TabDef {
  key: string
  label: string
  icon: string
  tools: ToolDef[]
}

const TABS: TabDef[] = [
  {
    key: 'zones',
    label: 'Zones',
    icon: '🏘',
    tools: [
      { key: 'residential', label: 'Residential', hotkey: 'R', bg: '#162616', activeBg: '#1f5c1f', activeBorder: '#4caf50' },
      { key: 'commercial',  label: 'Commercial',  hotkey: 'C', bg: '#131f36', activeBg: '#1b3d6e', activeBorder: '#4a90d9' },
      { key: 'industrial',  label: 'Industrial',  hotkey: 'I', bg: '#2e2010', activeBg: '#6b470f', activeBorder: '#f5a623' },
      { key: 'demolish',    label: '🗑 Demolish',  hotkey: 'X', bg: '#2e1010', activeBg: '#6b1010', activeBorder: '#e53935' },
    ],
  },
  {
    key: 'roads',
    label: 'Roads',
    icon: '🛣',
    tools: [
      { key: 'road_local',     label: '🛤 Local',     hotkey: 'D', bg: '#1e1e1e', activeBg: '#3d3d3d', activeBorder: '#aaaaaa' },
      { key: 'road_collector', label: '🛣 Collector', hotkey: 'E', bg: '#1e1e1e', activeBg: '#3d3d3d', activeBorder: '#cccccc' },
      { key: 'road_arterial',  label: '🛣 Arterial',  hotkey: 'F', bg: '#221a10', activeBg: '#4a3a18', activeBorder: '#f5c842' },
      { key: 'road_upgrade',   label: '⬆ Upgrade',   hotkey: 'U', bg: '#181e2a', activeBg: '#2a3a5c', activeBorder: '#7eb8f7' },
    ],
  },
]

const HOTKEY_MAP: Record<string, Exclude<ZoneType, null>> = {
  r: 'residential',
  c: 'commercial',
  i: 'industrial',
  x: 'demolish',
  d: 'road_local',
  e: 'road_collector',
  f: 'road_arterial',
  u: 'road_upgrade',
}

const TOOL_TO_TAB: Record<string, string> = {}
for (const tab of TABS) {
  for (const tool of tab.tools) {
    TOOL_TO_TAB[tool.key] = tab.key
  }
}

export class BottomPanel {
  private wrapper: HTMLDivElement
  private contentArea!: HTMLDivElement
  private tabBar!: HTMLDivElement
  private toolButtons: Map<string, HTMLButtonElement> = new Map()
  private tabButtons: Map<string, HTMLButtonElement> = new Map()

  private _activeTool: ZoneType = null
  private _activeTab: string = TABS[0].key
  private onChangeCallbacks: Array<(tool: ZoneType) => void> = []
  private keyHandler: (e: KeyboardEvent) => void

  constructor() {
    this.wrapper = this.buildDOM()
    document.body.appendChild(this.wrapper)

    this.keyHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const toolKey = HOTKEY_MAP[e.key.toLowerCase()]
      if (!toolKey) return
      e.preventDefault()
      const tabKey = TOOL_TO_TAB[toolKey]
      if (tabKey && tabKey !== this._activeTab) {
        this.switchTab(tabKey)
      }
      this.setActiveTool(this._activeTool === toolKey ? null : toolKey)
    }
    window.addEventListener('keydown', this.keyHandler)
  }

  get activeTool(): ZoneType {
    return this._activeTool
  }

  onChange(cb: (tool: ZoneType) => void): void {
    this.onChangeCallbacks.push(cb)
  }

  setActiveTool(tool: ZoneType): void {
    this._activeTool = tool
    this.refreshToolButtons()
    this.onChangeCallbacks.forEach(cb => cb(tool))
  }

  private buildDOM(): HTMLDivElement {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'left:50%',
      'transform:translateX(-50%)',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'z-index:100',
      'user-select:none',
    ].join(';')

    this.contentArea = document.createElement('div')
    this.contentArea.style.cssText = [
      'display:flex',
      'gap:8px',
      'padding:10px 14px 8px',
      'background:rgba(0,0,0,0.78)',
      'border-radius:8px 8px 0 0',
      'border:1px solid rgba(255,255,255,0.09)',
      'border-bottom:none',
      'backdrop-filter:blur(6px)',
      'min-height:64px',
      'align-items:center',
    ].join(';')

    this.tabBar = document.createElement('div')
    this.tabBar.style.cssText = [
      'display:flex',
      'gap:0',
      'width:100%',
      'background:rgba(0,0,0,0.88)',
      'border-radius:0 0 8px 8px',
      'border:1px solid rgba(255,255,255,0.09)',
      'border-top:1px solid rgba(255,255,255,0.13)',
      'overflow:hidden',
    ].join(';')

    for (const tab of TABS) {
      const btn = document.createElement('button')
      btn.style.cssText = this.tabButtonCss(tab.key === this._activeTab)
      btn.innerHTML = `<span style="font-size:15px">${tab.icon}</span><span style="font-size:11px;margin-top:2px">${tab.label}</span>`
      btn.title = tab.label
      btn.addEventListener('click', () => this.switchTab(tab.key))
      this.tabButtons.set(tab.key, btn)
      this.tabBar.appendChild(btn)
    }

    wrapper.appendChild(this.contentArea)
    wrapper.appendChild(this.tabBar)

    this.renderTabContent()
    return wrapper
  }

  private tabButtonCss(active: boolean): string {
    return [
      'flex:1',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:2px',
      'padding:6px 24px',
      `background:${active ? 'rgba(255,255,255,0.09)' : 'transparent'}`,
      `color:${active ? '#fff' : 'rgba(255,255,255,0.5)'}`,
      `border-top:2px solid ${active ? 'rgba(255,255,255,0.5)' : 'transparent'}`,
      'border-left:none',
      'border-right:none',
      'border-bottom:none',
      'cursor:pointer',
      'font-family:monospace',
      'transition:background 0.12s,color 0.12s',
      'outline:none',
    ].join(';')
  }

  private switchTab(tabKey: string): void {
    if (tabKey === this._activeTab) return
    this._activeTab = tabKey

    // Deselect any active tool that belongs to the old tab
    if (this._activeTool && TOOL_TO_TAB[this._activeTool] !== tabKey) {
      this.setActiveTool(null)
    }

    this.tabButtons.forEach((btn, key) => {
      btn.style.cssText = this.tabButtonCss(key === tabKey)
    })

    this.renderTabContent()
  }

  private renderTabContent(): void {
    this.contentArea.innerHTML = ''
    this.toolButtons.clear()

    const tab = TABS.find(t => t.key === this._activeTab)
    if (!tab) return

    for (const tool of tab.tools) {
      const btn = document.createElement('button')
      btn.dataset.tool = tool.key
      btn.title = `${tool.label} [${tool.hotkey}]`
      btn.innerHTML = `
        <span style="display:block;font-size:13px;font-weight:600;letter-spacing:0.02em">${tool.label}</span>
        <span style="display:block;font-size:10px;opacity:0.55;margin-top:2px">[${tool.hotkey}]</span>
      `
      this.applyButtonStyle(btn, tool, this._activeTool === tool.key)
      btn.addEventListener('click', () => {
        this.setActiveTool(this._activeTool === tool.key ? null : tool.key)
      })
      this.toolButtons.set(tool.key, btn)
      this.contentArea.appendChild(btn)
    }
  }

  private applyButtonStyle(btn: HTMLButtonElement, tool: ToolDef, active: boolean): void {
    btn.style.cssText = [
      `background:${active ? tool.activeBg : tool.bg}`,
      `border:2px solid ${active ? tool.activeBorder : 'rgba(255,255,255,0.12)'}`,
      'border-radius:6px',
      'color:#fff',
      'cursor:pointer',
      'font-family:monospace',
      'padding:8px 14px',
      'min-width:90px',
      'text-align:center',
      'transition:background 0.12s,border-color 0.12s',
      `box-shadow:${active ? `0 0 8px ${tool.activeBorder}66` : 'none'}`,
      'outline:none',
    ].join(';')
  }

  private refreshToolButtons(): void {
    const tab = TABS.find(t => t.key === this._activeTab)
    if (!tab) return
    for (const tool of tab.tools) {
      const btn = this.toolButtons.get(tool.key)
      if (btn) this.applyButtonStyle(btn, tool, this._activeTool === tool.key)
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler)
    this.wrapper.remove()
  }
}
