import { ArcRotateCamera } from '@babylonjs/core'
import { CellType, GridMap } from '../simulation'

const MAP_PX = 200
const WORLD_SIZE = 200  // GridMap width/height in world units

// RGBA color per CellType (index == enum value)
const CELL_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [13,  21,  32],   // EMPTY              — dark navy
  [110, 110, 110],  // ROAD               — gray
  [46,  107, 235],  // ZONE_RESIDENTIAL   — blue  (matches BuildingSystem Color3(0.18,0.42,0.92))
  [31,  204,  71],  // ZONE_COMMERCIAL    — green (matches BuildingSystem Color3(0.12,0.80,0.28))
  [242, 197,  13],  // ZONE_INDUSTRIAL    — yellow(matches BuildingSystem Color3(0.95,0.78,0.08))
]

// World coordinate → canvas pixel (0..MAP_PX)
function worldToPx(w: number): number {
  return (w / WORLD_SIZE + 0.5) * MAP_PX
}

// Canvas pixel → world coordinate
function pxToWorld(px: number): number {
  return (px / MAP_PX - 0.5) * WORLD_SIZE
}

export class MiniMap {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private gridMap: GridMap
  private camera: ArcRotateCamera
  private lastVersion = -1
  private cachedLayer: ImageData | null = null

  constructor(gridMap: GridMap, camera: ArcRotateCamera) {
    this.gridMap = gridMap
    this.camera = camera

    this.canvas = document.createElement('canvas')
    this.canvas.width = MAP_PX
    this.canvas.height = MAP_PX
    this.canvas.style.cssText = [
      'position:fixed',
      'top:16px',
      'right:16px',
      'width:200px',
      'height:200px',
      'border:1px solid rgba(255,255,255,0.25)',
      'border-radius:4px',
      'cursor:crosshair',
      'z-index:100',
      'image-rendering:pixelated',
    ].join(';')

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('MiniMap: 2D canvas context unavailable')
    this.ctx = ctx

    document.body.appendChild(this.canvas)
    this.canvas.addEventListener('click', this.handleClick)
  }

  private handleClick = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect()
    const scaleX = MAP_PX / rect.width
    const scaleY = MAP_PX / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const pz = (e.clientY - rect.top) * scaleY
    // Pan the camera target without changing height or orbit radius
    this.camera.target.x = pxToWorld(px)
    this.camera.target.z = pxToWorld(pz)
  }

  // Rebuild the static ImageData layer from GridMap cells.
  // Cell (cx, cz) maps 1:1 to pixel (cx, cz) since MAP_PX == WORLD_SIZE.
  private buildCellLayer(): ImageData {
    const data = new ImageData(MAP_PX, MAP_PX)
    const buf = data.data

    // Fill background with EMPTY color
    const [br, bg, bb] = CELL_RGB[CellType.EMPTY]
    for (let i = 0; i < MAP_PX * MAP_PX; i++) {
      buf[i * 4]     = br
      buf[i * 4 + 1] = bg
      buf[i * 4 + 2] = bb
      buf[i * 4 + 3] = 255
    }

    // Paint each non-empty cell
    for (let cz = 0; cz < this.gridMap.height; cz++) {
      for (let cx = 0; cx < this.gridMap.width; cx++) {
        const type = this.gridMap.get(cx, cz)
        if (type === CellType.EMPTY) continue
        const rgb = CELL_RGB[type]
        if (!rgb) continue
        const idx = (cz * MAP_PX + cx) * 4
        buf[idx]     = rgb[0]
        buf[idx + 1] = rgb[1]
        buf[idx + 2] = rgb[2]
        // alpha already 255 from background fill
      }
    }

    return data
  }

  update(citizenCount = 0): void {
    // Lazily rebuild the pixel layer when the grid changes
    if (this.gridMap.version !== this.lastVersion) {
      this.cachedLayer = this.buildCellLayer()
      this.lastVersion = this.gridMap.version
    }

    if (this.cachedLayer) {
      this.ctx.putImageData(this.cachedLayer, 0, 0)
    } else {
      this.ctx.fillStyle = '#0d1520'
      this.ctx.fillRect(0, 0, MAP_PX, MAP_PX)
    }

    // Camera target crosshair — always drawn fresh on top
    const tx = Math.round(worldToPx(this.camera.target.x))
    const tz = Math.round(worldToPx(this.camera.target.z))
    this.ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    this.ctx.lineWidth = 1.5
    this.ctx.beginPath()
    this.ctx.moveTo(tx - 7, tz)
    this.ctx.lineTo(tx + 7, tz)
    this.ctx.moveTo(tx, tz - 7)
    this.ctx.lineTo(tx, tz + 7)
    this.ctx.stroke()
    // Center dot
    this.ctx.fillStyle = 'rgba(255,255,255,0.9)'
    this.ctx.fillRect(tx - 1, tz - 1, 3, 3)

    // Citizen count overlay at bottom-left of minimap
    if (citizenCount > 0) {
      this.ctx.fillStyle = 'rgba(0,0,0,0.55)'
      this.ctx.fillRect(2, MAP_PX - 18, 72, 16)
      this.ctx.fillStyle = 'rgba(255,255,255,0.8)'
      this.ctx.font = '10px monospace'
      this.ctx.fillText(`👤 ${citizenCount}`, 6, MAP_PX - 6)
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.handleClick)
    this.canvas.remove()
  }
}
