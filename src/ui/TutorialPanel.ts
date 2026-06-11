const STORAGE_KEY = 'city-tutorial-seen'

const STEPS = [
  { icon: '🛣️', text: 'Build roads first — zones only grow next to roads' },
  { icon: '🏠', text: 'Zone residential areas for housing' },
  { icon: '🏪', text: 'Add commercial zones near residential — citizens need shops' },
  { icon: '💰', text: 'Watch your balance — expenses grow with city size' },
]

export class TutorialPanel {
  private el: HTMLDivElement | null = null

  constructor() {
    if (localStorage.getItem(STORAGE_KEY)) return
    this.render()
  }

  private render(): void {
    const overlay = document.createElement('div')
    overlay.style.cssText = [
      'position:fixed', 'inset:0',
      'background:rgba(0,0,0,0.72)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:300', 'font-family:monospace',
    ].join(';')

    const card = document.createElement('div')
    card.style.cssText = [
      'background:#0f1a2e',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:8px',
      'padding:28px 32px',
      'max-width:400px', 'width:90%',
      'color:#fff',
    ].join(';')

    const title = document.createElement('div')
    title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:4px'
    title.textContent = 'Welcome to your new city!'

    const subtitle = document.createElement('div')
    subtitle.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:18px'
    subtitle.textContent = 'Quick start guide'

    const list = document.createElement('div')
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:20px'

    for (const { icon, text } of STEPS) {
      const item = document.createElement('div')
      item.style.cssText = 'display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5'
      const iconEl = document.createElement('span')
      iconEl.textContent = icon
      iconEl.style.flexShrink = '0'
      const textEl = document.createElement('span')
      textEl.style.color = 'rgba(255,255,255,0.82)'
      textEl.textContent = text
      item.append(iconEl, textEl)
      list.appendChild(item)
    }

    const dismissBtn = document.createElement('button')
    dismissBtn.textContent = 'Got it, start building!'
    dismissBtn.style.cssText = [
      'width:100%', 'padding:10px',
      'background:#1a6bd4',
      'border:none', 'border-radius:4px',
      'color:#fff', 'font-family:monospace', 'font-size:13px',
      'cursor:pointer', 'transition:background 0.15s',
    ].join(';')
    dismissBtn.addEventListener('mouseenter', () => {
      dismissBtn.style.background = '#2280f0'
    })
    dismissBtn.addEventListener('mouseleave', () => {
      dismissBtn.style.background = '#1a6bd4'
    })
    dismissBtn.addEventListener('click', () => this.dismiss())

    card.append(title, subtitle, list, dismissBtn)
    overlay.appendChild(card)
    document.body.appendChild(overlay)
    this.el = overlay
  }

  private dismiss(): void {
    localStorage.setItem(STORAGE_KEY, '1')
    this.el?.remove()
    this.el = null
  }
}
