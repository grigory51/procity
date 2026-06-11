export enum CellType {
  EMPTY = 0,
  ROAD = 1,
  ZONE_RESIDENTIAL = 2,
  ZONE_COMMERCIAL = 3,
  ZONE_INDUSTRIAL = 4,
  ROAD_COLLECTOR = 5,
  ROAD_ARTERIAL = 6,
}

export function isRoadCell(type: CellType): boolean {
  return type === CellType.ROAD || type === CellType.ROAD_COLLECTOR || type === CellType.ROAD_ARTERIAL
}

const GRID_SIZE = 200
const CELL_SIZE = 1.0
const HALF_GRID = GRID_SIZE / 2

export class GridMap {
  readonly width = GRID_SIZE
  readonly height = GRID_SIZE
  readonly cellSize = CELL_SIZE
  private cells: Uint8Array
  private _version = 0

  constructor() {
    this.cells = new Uint8Array(GRID_SIZE * GRID_SIZE)
  }

  get version(): number {
    return this._version
  }

  get(x: number, z: number): CellType {
    if (this.outOfBounds(x, z)) return CellType.EMPTY
    return this.cells[z * this.width + x] as CellType
  }

  set(x: number, z: number, type: CellType): boolean {
    if (this.outOfBounds(x, z)) return false
    this.cells[z * this.width + x] = type
    this._version++
    return true
  }

  /** Returns a snapshot copy of the raw cell buffer for serialization. */
  getCells(): Uint8Array {
    return new Uint8Array(this.cells)
  }

  /** Bulk-loads cell data from a saved snapshot. Silently ignores size mismatch. */
  loadFrom(data: Uint8Array): void {
    if (data.length !== this.cells.length) return
    this.cells.set(data)
    this._version++
  }

  outOfBounds(x: number, z: number): boolean {
    return x < 0 || z < 0 || x >= this.width || z >= this.height
  }

  worldToCell(wx: number, wz: number): { x: number; z: number } {
    return {
      x: Math.floor(wx / CELL_SIZE + HALF_GRID),
      z: Math.floor(wz / CELL_SIZE + HALF_GRID),
    }
  }

  cellToWorld(cx: number, cz: number): { x: number; z: number } {
    return {
      x: (cx - HALF_GRID + 0.5) * CELL_SIZE,
      z: (cz - HALF_GRID + 0.5) * CELL_SIZE,
    }
  }
}
