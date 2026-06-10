import { CellType, GridMap } from './GridMap'

export interface PathNode {
  x: number
  z: number
}

// Binary min-heap keyed on f-score
class MinHeap {
  private heap: [number, number][] = [] // [fScore, encodedId]

  push(fScore: number, nodeId: number): void {
    this.heap.push([fScore, nodeId])
    this._siftUp(this.heap.length - 1)
  }

  pop(): [number, number] | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this._siftDown(0)
    }
    return top
  }

  get size(): number {
    return this.heap.length
  }

  private _siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.heap[parent][0] <= this.heap[i][0]) break
      ;[this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]]
      i = parent
    }
  }

  private _siftDown(i: number): void {
    const n = this.heap.length
    for (;;) {
      let smallest = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && this.heap[l][0] < this.heap[smallest][0]) smallest = l
      if (r < n && this.heap[r][0] < this.heap[smallest][0]) smallest = r
      if (smallest === i) break
      ;[this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]]
      i = smallest
    }
  }
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Road graph derived from GridMap. Provides A* pathfinding over road cells.
 * Reads cell state directly from GridMap — no separate adjacency store needed.
 */
export class RoadGraph {
  constructor(private readonly gridMap: GridMap) {}

  addRoad(x: number, z: number): void {
    this.gridMap.set(x, z, CellType.ROAD)
  }

  removeRoad(x: number, z: number): void {
    this.gridMap.set(x, z, CellType.EMPTY)
  }

  /**
   * A* shortest path on the road graph.
   * Returns the ordered list of road cells from start to end (inclusive),
   * or null if no path exists or start/end are not road cells.
   */
  findPath(startX: number, startZ: number, endX: number, endZ: number): PathNode[] | null {
    if (this.gridMap.get(startX, startZ) !== CellType.ROAD) return null
    if (this.gridMap.get(endX, endZ) !== CellType.ROAD) return null

    const width = this.gridMap.width
    const startId = this._encode(startX, startZ, width)
    const endId = this._encode(endX, endZ, width)

    if (startId === endId) return [{ x: startX, z: startZ }]

    const gScore = new Map<number, number>()
    const cameFrom = new Map<number, number>()
    const open = new MinHeap()

    gScore.set(startId, 0)
    open.push(this._h(startX, startZ, endX, endZ), startId)

    const closed = new Set<number>()

    while (open.size > 0) {
      const [, currentId] = open.pop()!
      if (currentId === endId) return this._reconstructPath(cameFrom, endId, width)
      if (closed.has(currentId)) continue
      closed.add(currentId)

      const cx = currentId % width
      const cz = (currentId / width) | 0
      const g = gScore.get(currentId)!

      for (const [dx, dz] of DIRS) {
        const nx = cx + dx
        const nz = cz + dz
        if (this.gridMap.get(nx, nz) !== CellType.ROAD) continue

        const neighborId = this._encode(nx, nz, width)
        if (closed.has(neighborId)) continue

        const tentativeG = g + 1
        const knownG = gScore.get(neighborId)
        if (knownG !== undefined && tentativeG >= knownG) continue

        gScore.set(neighborId, tentativeG)
        cameFrom.set(neighborId, currentId)
        open.push(tentativeG + this._h(nx, nz, endX, endZ), neighborId)
      }
    }

    return null // unreachable
  }

  private _encode(x: number, z: number, width: number): number {
    return z * width + x
  }

  private _h(ax: number, az: number, bx: number, bz: number): number {
    return Math.abs(ax - bx) + Math.abs(az - bz)
  }

  private _reconstructPath(cameFrom: Map<number, number>, endId: number, width: number): PathNode[] {
    const path: PathNode[] = []
    let current: number | undefined = endId
    while (current !== undefined) {
      path.push({ x: current % width, z: (current / width) | 0 })
      current = cameFrom.get(current)
    }
    return path.reverse()
  }
}
