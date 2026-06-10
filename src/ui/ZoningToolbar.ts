export type ZoneType = 'residential' | 'commercial' | 'industrial' | 'road' | 'demolish' | null

interface ToolDef {
  key: ZoneType & string
  label: string
  hotkey: string
  bg: string
  activeBg: string
  activeBorder: string
}

const TOOLS: ToolDef[] = [
  { key: 'residential', label: 'Residential', hotkey: 'R', bg: '#162616', activeBg: '#1f5c1f', activeBorder: '#4caf50' },
  { key: 'commercial',  label: 'Commercial',  hotkey: 'C', bg: '#131f36', activeBg: '#1b3d6e', activeBorder: '#4a90d9' },
  { key: 'industrial',  label: 'Industrial',  hotkey: 'I', bg: '#2e2010', activeBg: '#6b470f', activeBorder: '#f5a623' },
  { key: 'road',        label: 'Road',        hotkey: 'D', bg: '#1e1e1e', activeBg: '#3d3d3d', activeBorder: '#aaaaaa' },
  { key: 'demolish',    label: 'Demolish',    hotkey: 'X', bg: '#2e1010', activeBg: '#6b1010', activeBorder: '#e53935' },
]

const HOTKEY_MAP: Record<string, ZoneType & string> = {
  r: 'residential', c: 'commercial', i: 'industrial', d: 'road', x: 'demolish',
}

export class ZoningToolbar {
  private el: HTMLDivElement
  private buttons: Map<string, HTMLButtonElement> = new Map()
  private _activeTool: ZoneType = null
  private onChangeCallbacks: Array<(tool: ZoneType) => void> = []
  private keyHandler: (e: KeyboardEvent) => void

  constructor() {
    this.el = this.buildDOM()
    document.body.appendChild(this.el)

    this.keyHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const toolKey = HOTKEY_MAP[e.key.toLowerCase()]
      if (toolKey) {
        e.preventDefault()
        this.setActiveTool(this._activeTool === toolKey ? null : toolKey)
      }
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
    this.refreshButtons()
    this.onChangeCallbacks.forEach(cb => cb(tool))
  }

  private buildDOM(): HTMLDivElement {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = [
      'position:fixed',
      'bottom:20px',
      'left:50%',
      'transform:translateX(-50%)',
      'display:flex',
      'gap:8px',
      'padding:10px 16px',
      'background:rgba(0,0,0,0.72)',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.08)',
      'backdrop-filter:blur(4px)',
      'z-index:100',
    ].join(';')

    for (const tool of TOOLS) {
      const btn = document.createElement('button')
      btn.dataset.tool = tool.key
      btn.title = `${tool.label} [${tool.hotkey}]`
      btn.innerHTML = `
        <span style="display:block;font-size:13px;font-weight:600;letter-spacing:0.02em">${tool.label}</span>
        <span style="display:block;font-size:10px;opacity:0.55;margin-top:2px">[${tool.hotkey}]</span>
      `
      this.applyButtonStyle(btn, tool, false)
      btn.addEventListener('click', () => {
        this.setActiveTool(this._activeTool === tool.key ? null : tool.key)
      })
      this.buttons.set(tool.key, btn)
      wrapper.appendChild(btn)
    }

    return wrapper
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

  private refreshButtons(): void {
    for (const tool of TOOLS) {
      const btn = this.buttons.get(tool.key)
      if (btn) this.applyButtonStyle(btn, tool, this._activeTool === tool.key)
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler)
    this.el.remove()
  }
}
