import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  type InstancedMesh,
} from '@babylonjs/core'
import { CellType, GridMap, isRoadCell } from '../simulation'
import { RoadGraph } from '../simulation'
import type { PathNode } from '../simulation'

// ── Simulation constants ─────────────────────────────────────────────────────

const VEHICLE_SPEED      = 8.0
const WORK_DWELL         = 8.0
const HOME_DWELL         = 5.0
const MAX_VEHICLES       = 50
const ROAD_SEARCH_RADIUS = 8
/** Right-lane lateral offset from road center (road center - perp * LANE_OFFSET). */
const LANE_OFFSET        = 0.18

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// ── State machine ────────────────────────────────────────────────────────────

enum State {
  CommutingToWork = 0,
  AtWork          = 1,
  CommutingHome   = 2,
  AtHome          = 3,
}

// ── Vehicle data ─────────────────────────────────────────────────────────────

interface Vehicle {
  readonly homeCell:    { x: number; z: number }
  readonly workCell:    { x: number; z: number }
  readonly forwardPath: PathNode[]
  readonly returnPath:  PathNode[]
  state:        State
  pathProgress: number
  dwellTimer:   number
  marker:       InstancedMesh
  yieldState:   'none' | 'braking' | 'waiting' | 'resuming'
  yieldTimer:   number
  yieldCellIdx: number
}

// ── VehicleManager ────────────────────────────────────────────────────────────

/**
 * Manages up to MAX_VEHICLES car agents that commute between residential and
 * commercial/industrial zones, driving in the right lane of road cells.
 *
 * Mirrors CitizenManager structure but uses a box mesh, faster speed, and a
 * right-lane offset instead of a sidewalk offset.
 */
export class VehicleManager {
  private vehicles:      Vehicle[] = []
  private template:      Mesh
  private matCommuting:  StandardMaterial
  private matParked:     StandardMaterial
  private lastGridVersion = -1
  private nextInstanceId  = 0

  constructor(
    scene:                      Scene,
    private readonly gridMap:   GridMap,
    private readonly roadGraph: RoadGraph,
  ) {
    this.matCommuting              = new StandardMaterial('vehicleMatCommuting', scene)
    this.matCommuting.diffuseColor  = new Color3(1.0, 0.55, 0.1)
    this.matCommuting.emissiveColor = new Color3(0.30, 0.16, 0.03)
    this.matCommuting.specularColor = new Color3(0.20, 0.20, 0.20)

    this.matParked              = new StandardMaterial('vehicleMatParked', scene)
    this.matParked.diffuseColor  = new Color3(0.3, 0.3, 0.3)
    this.matParked.specularColor = new Color3(0.10, 0.10, 0.10)

    this.template            = MeshBuilder.CreateBox('vehicleTemplate', { width: 0.16, height: 0.08, depth: 0.32 }, scene)
    this.template.material   = this.matCommuting
    this.template.isPickable = false
    this.template.setEnabled(false)
  }

  /**
   * Advance simulation by deltaTime seconds and sync visual marker positions.
   * Rebuilds whenever the grid version changes.
   */
  update(deltaTime: number): void {
    if (this.gridMap.version !== this.lastGridVersion) {
      this.lastGridVersion = this.gridMap.version
      this.rebuildVehicles()
    }
    for (const v of this.vehicles) this.tickVehicle(v, deltaTime)
  }

  get count(): number { return this.vehicles.length }

  get commutingCount(): number {
    let n = 0
    for (const v of this.vehicles) {
      if (v.state === State.CommutingToWork || v.state === State.CommutingHome) n++
    }
    return n
  }

  dispose(): void {
    for (const v of this.vehicles) v.marker.dispose()
    this.vehicles = []
    this.template.dispose()
    this.matCommuting.dispose()
    this.matParked.dispose()
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  private tickVehicle(v: Vehicle, dt: number): void {
    switch (v.state) {
      case State.CommutingToWork:
        this.advanceAlongPath(v, v.forwardPath, dt, State.AtWork, WORK_DWELL)
        break

      case State.AtWork:
        v.dwellTimer -= dt
        if (v.dwellTimer <= 0) this.startNextCommute(v)
        break

      case State.CommutingHome:
        this.advanceAlongPath(v, v.returnPath, dt, State.AtHome, HOME_DWELL)
        break

      case State.AtHome:
        v.dwellTimer -= dt
        if (v.dwellTimer <= 0) this.startNextCommute(v)
        break
    }
  }

  private advanceAlongPath(
    v:         Vehicle,
    path:      PathNode[],
    dt:        number,
    nextState: State.AtWork | State.AtHome,
    nextDwell: number,
  ): void {
    if (path.length < 2) {
      this.arriveAt(v, path, nextState, nextDwell)
      return
    }

    // ── Intersection yield state machine ──────────────────────────────────────
    if (v.yieldState === 'braking' || v.yieldState === 'waiting') {
      v.yieldTimer -= dt
      if (v.yieldState === 'braking' && v.yieldTimer <= 0) {
        v.yieldState = 'waiting'
        v.yieldTimer = 0.3
      } else if (v.yieldState === 'waiting' && v.yieldTimer <= 0) {
        v.yieldState = 'resuming'
        v.yieldTimer = 0
      }
      // Hold position at intersection center, no lane offset
      const node = path[v.yieldCellIdx]
      const wp   = this.gridMap.cellToWorld(node.x, node.z)
      v.marker.position.x = wp.x
      v.marker.position.y = 0.09
      v.marker.position.z = wp.z
      return
    }

    if (v.yieldState === 'resuming') v.yieldState = 'none'

    // ── Normal path advance ───────────────────────────────────────────────────
    v.pathProgress += VEHICLE_SPEED * dt
    const maxProgress = path.length - 1

    if (v.pathProgress >= maxProgress) {
      v.pathProgress = maxProgress
      this.arriveAt(v, path, nextState, nextDwell)
      return
    }

    const idx  = Math.floor(v.pathProgress)
    const t    = v.pathProgress - idx

    // Yield trigger: first time entering this intersection cell on this commute
    if (v.yieldState === 'none' && idx !== v.yieldCellIdx && idx < path.length - 1) {
      const node = path[idx]
      if (this.isIntersectionCell(node.x, node.z)) {
        v.yieldCellIdx  = idx
        v.yieldState    = 'braking'
        v.yieldTimer    = 0.2
        v.pathProgress  = idx   // snap to cell entry (intersection center)
        const wp        = this.gridMap.cellToWorld(node.x, node.z)
        v.marker.position.x = wp.x
        v.marker.position.y = 0.09
        v.marker.position.z = wp.z
        return
      }
    }

    const a    = this.gridMap.cellToWorld(path[idx].x,     path[idx].z)
    const b    = this.gridMap.cellToWorld(path[idx + 1].x, path[idx + 1].z)
    const dx   = b.x - a.x
    const dz   = b.z - a.z
    const len  = Math.sqrt(dx * dx + dz * dz)
    const dirX = len > 0 ? dx / len : 0
    const dirZ = len > 0 ? dz / len : 0
    // perp = Vector3(-dir.z, 0, dir.x); vehiclePos = roadCenter - perp * LANE_OFFSET
    const perpX = -dirZ
    const perpZ =  dirX

    // Blend lane offset to 0 at intersections so the vehicle tracks through center
    const offsetScale = this.isIntersectionCell(path[idx].x, path[idx].z) ? 0.0 : 1.0

    v.marker.position.x = a.x + (b.x - a.x) * t - perpX * LANE_OFFSET * offsetScale
    v.marker.position.y = 0.09
    v.marker.position.z = a.z + (b.z - a.z) * t - perpZ * LANE_OFFSET * offsetScale
    v.marker.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.atan2(dirZ, dirX))
  }

  /** Returns true when (cx,cz) has road neighbors on both axes (NS and EW). */
  private isIntersectionCell(cx: number, cz: number): boolean {
    const hasN = isRoadCell(this.gridMap.get(cx,     cz - 1))
    const hasS = isRoadCell(this.gridMap.get(cx,     cz + 1))
    const hasE = isRoadCell(this.gridMap.get(cx + 1, cz))
    const hasW = isRoadCell(this.gridMap.get(cx - 1, cz))
    return (hasN || hasS) && (hasE || hasW)
  }

  private arriveAt(
    v:     Vehicle,
    path:  PathNode[],
    state: State.AtWork | State.AtHome,
    dwell: number,
  ): void {
    v.state           = state
    v.dwellTimer      = dwell
    v.marker.material = this.matParked

    if (path.length >= 2) {
      const from  = path.length - 2
      const dx    = path[from + 1].x - path[from].x
      const dz    = path[from + 1].z - path[from].z
      const len   = Math.sqrt(dx * dx + dz * dz)
      const perpX = len > 0 ? -dz / len : 0
      const perpZ = len > 0 ?  dx / len : 0
      const last  = path[path.length - 1]
      const wp    = this.gridMap.cellToWorld(last.x, last.z)
      v.marker.position.x = wp.x - perpX * LANE_OFFSET
      v.marker.position.y = 0.09
      v.marker.position.z = wp.z - perpZ * LANE_OFFSET
    }
  }

  private startNextCommute(v: Vehicle): void {
    const leavingWork = v.state === State.AtWork
    v.state           = leavingWork ? State.CommutingHome : State.CommutingToWork
    v.pathProgress    = 0
    v.yieldState      = 'none'
    v.yieldTimer      = 0
    v.yieldCellIdx    = -1
    v.marker.material = this.matCommuting
    const path        = leavingWork ? v.returnPath : v.forwardPath
    const { px, pz }  = this._perpAtPathNode(path, 0)
    const wp          = this.gridMap.cellToWorld(path[0].x, path[0].z)
    v.marker.position.x = wp.x - px * LANE_OFFSET
    v.marker.position.y = 0.09
    v.marker.position.z = wp.z - pz * LANE_OFFSET
  }

  // ── Zone scan & vehicle spawn ───────────────────────────────────────────────

  private rebuildVehicles(): void {
    for (const v of this.vehicles) v.marker.dispose()
    this.vehicles = []

    type Entry = { cell: { x: number; z: number }; road: { x: number; z: number } }
    const residential: Entry[] = []
    const workplaces:  Entry[] = []

    for (let z = 0; z < this.gridMap.height; z++) {
      for (let x = 0; x < this.gridMap.width; x++) {
        const cell = this.gridMap.get(x, z)
        if (cell === CellType.ZONE_RESIDENTIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) residential.push({ cell: { x, z }, road })
        } else if (cell === CellType.ZONE_COMMERCIAL || cell === CellType.ZONE_INDUSTRIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) workplaces.push({ cell: { x, z }, road })
        }
      }
    }

    if (residential.length === 0 || workplaces.length === 0) return

    for (let i = 0; i < residential.length && this.vehicles.length < MAX_VEHICLES; i++) {
      const home = residential[i]
      const work = workplaces[i % workplaces.length]

      const path = this.roadGraph.findPath(home.road.x, home.road.z, work.road.x, work.road.z)
      if (!path || path.length < 2) continue

      const { px, pz } = this._perpAtPathNode(path, 0)
      const startWp    = this.gridMap.cellToWorld(path[0].x, path[0].z)
      const marker     = this.template.createInstance(`vehicle_${this.nextInstanceId++}`)
      marker.position  = new Vector3(startWp.x - px * LANE_OFFSET, 0.09, startWp.z - pz * LANE_OFFSET)
      marker.isPickable = false

      // Set initial rotation facing the first travel direction
      if (path.length >= 2) {
        const dx  = path[1].x - path[0].x
        const dz  = path[1].z - path[0].z
        const len = Math.sqrt(dx * dx + dz * dz)
        if (len > 0) {
          marker.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.atan2(dz / len, dx / len))
        }
      }

      this.vehicles.push({
        homeCell:     home.cell,
        workCell:     work.cell,
        forwardPath:  path,
        returnPath:   path.slice().reverse(),
        state:        State.CommutingToWork,
        pathProgress: 0,
        dwellTimer:   0,
        yieldState:   'none',
        yieldTimer:   0,
        yieldCellIdx: -1,
        marker,
      })
    }
  }

  /**
   * Unit perpendicular to the road segment at nodeIndex.
   * Returns {px:0,pz:0} for degenerate single-node paths.
   */
  private _perpAtPathNode(path: PathNode[], nodeIndex: number): { px: number; pz: number } {
    if (path.length < 2) return { px: 0, pz: 0 }
    const from = nodeIndex < path.length - 1 ? nodeIndex : nodeIndex - 1
    const dx   = path[from + 1].x - path[from].x
    const dz   = path[from + 1].z - path[from].z
    const len  = Math.sqrt(dx * dx + dz * dz)
    return len > 0 ? { px: -dz / len, pz: dx / len } : { px: 0, pz: 0 }
  }

  /**
   * BFS outward from (cx, cz) to locate the nearest road cell.
   * Returns null when no road exists within ROAD_SEARCH_RADIUS cells.
   */
  private findNearestRoad(cx: number, cz: number): { x: number; z: number } | null {
    const visited = new Set<number>()
    const queue: Array<{ x: number; z: number; dist: number }> = [{ x: cx, z: cz, dist: 0 }]
    visited.add(cz * this.gridMap.width + cx)

    while (queue.length > 0) {
      const { x, z, dist } = queue.shift()!
      if (dist >= ROAD_SEARCH_RADIUS) continue

      for (const [dx, dz] of DIRS) {
        const nx = x + dx
        const nz = z + dz
        if (this.gridMap.outOfBounds(nx, nz)) continue
        const id = nz * this.gridMap.width + nx
        if (visited.has(id)) continue
        visited.add(id)
        if (isRoadCell(this.gridMap.get(nx, nz))) return { x: nx, z: nz }
        queue.push({ x: nx, z: nz, dist: dist + 1 })
      }
    }
    return null
  }
}
