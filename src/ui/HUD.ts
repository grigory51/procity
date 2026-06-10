export class HUD {
  private el: HTMLDivElement

  constructor() {
    this.el = document.createElement('div')
    this.el.style.cssText = [
      'position:fixed', 'top:16px', 'left:16px',
      'color:#fff', 'font-family:monospace', 'font-size:12px',
      'background:rgba(0,0,0,0.5)', 'padding:8px 12px',
      'border-radius:4px', 'pointer-events:none',
    ].join(';')
    this.el.textContent = 'Cities Skylines Browser — Demo'
    document.body.appendChild(this.el)
  }

  update(fps: number): void {
    this.el.textContent = `Cities Skylines Browser — ${fps.toFixed(0)} FPS`
  }

  dispose(): void {
    this.el.remove()
  }
}
