import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type InstancedMesh,
} from '@babylonjs/core'
import { CellType, GridMap } from '../simulation'
import { RoadGraph } from '../simulation'
import type { PathNode } from '../simulation'

// ── Simulation constants ─────────────────────────────────────────────────────

/** World units (= grid cells) per second each citizen travels along road path. */
const CITIZEN_SPEED      = 4.0
/** Seconds a citizen spends at work before heading home. */
const WORK_DWELL         = 5.0
/** Seconds a citizen spends at home before the next commute. */
const HOME_DWELL         = 3.0
/** Maximum simultaneous citizens (MVP cap). */
const MAX_CITIZENS       = 100
/** BFS radius (cells) to find the nearest road from a zone cell. */
const ROAD_SEARCH_RADIUS = 8

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// ── State machine ────────────────────────────────────────────────────────────

enum State {
  CommutingToWork = 0,
  AtWork          = 1,
  CommutingHome   = 2,
  AtHome          = 3,
}

// ── Citizen data ─────────────────────────────────────────────────────────────

interface Citizen {
  readonly homeCell:    { x: number; z: number }
  readonly workCell:    { x: number; z: number }
  readonly forwardPath: PathNode[]  // homeRoad → workRoad
  readonly returnPath:  PathNode[]  // workRoad → homeRoad (reverse)
  state:         State
  pathProgress:  number   // fractional node index [0 .. path.length-1]
  dwellTimer:    number   // seconds remaining in AtWork / AtHome
  marker:        InstancedMesh
}

// ── CitizenManager ─────────────────────────────────────────────────────────────

/**
 * Manages up to MAX_CITIZENS agents that commute between residential and
 * commercial zones along road paths.  Call update() once per render frame.
 *
 * Rebuilds the citizen list automatically whenever gridMap.version changes
 * (i.e. after any road or zone paint), disposing stale markers and spawning
 * new ones for newly reachable zone pairs.
 */
export class CitizenManager {
  private citizens:       Citizen[] = []
  private template:       Mesh
  private lastGridVersion = -1
  private nextInstanceId  = 0

  constructor(
    scene:                      Scene,
    private readonly gridMap:   GridMap,
    private readonly roadGraph: RoadGraph,
  ) {
    const mat         = new StandardMaterial('citizenMat', scene)
    mat.diffuseColor  = new Color3(1.0, 0.85, 0.10)
    mat.emissiveColor = new Color3(0.5, 0.40, 0.05)
    mat.specularColor = new Color3(0.2, 0.20, 0.20)

    this.template             = MeshBuilder.CreateSphere('citizenTemplate', { diameter: 0.22, segments: 4 }, scene)
    this.template.material    = mat
    this.template.isPickable  = false
    this.template.setEnabled(false)
  }

  /**
   * Advance simulation by deltaTime seconds and sync visual marker positions.
   * Must be called once per render frame.  deltaTime is in seconds.
   */
  update(deltaTime: number): void {
    if (this.gridMap.version !== this.lastGridVersion) {
      this.lastGridVersion = this.gridMap.version
      this.rebuildCitizens()
    }
    for (const c of this.citizens) this.tickCitizen(c, deltaTime)
  }

  /** Current number of active citizen agents. */
  get count(): number { return this.citizens.length }

  dispose(): void {
    for (const c of this.citizens) c.marker.dispose()
    this.citizens = []
    this.template.dispose()
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  private tickCitizen(c: Citizen, dt: number): void {
    switch (c.state) {
      case State.CommutingToWork:
        this.advanceAlongPath(c, c.forwardPath, dt, State.AtWork, WORK_DWELL)
        break
      case State.CommutingHome:
        this.advanceAlongPath(c, c.returnPath, dt, State.AtHome, HOME_DWELL)
        break
      case State.AtWork:
      case State.AtHome:
        c.dwellTimer -= dt
        if (c.dwellTimer <= 0) this.startNextCommute(c)
        break
    }
  }

  private advanceAlongPath(
    c:         Citizen,
    path:      PathNode[],
    dt:        number,
    nextState: State.AtWork | State.AtHome,
    nextDwell: number,
  ): void {
    if (path.length < 2) {
      this.arriveAt(c, nextState, nextDwell)
      return
    }

    c.pathProgress += CITIZEN_SPEED * dt
    const maxProgress = path.length - 1

    if (c.pathProgress >= maxProgress) {
      c.pathProgress = maxProgress
      this.arriveAt(c, nextState, nextDwell)
      return
    }

    const idx = Math.floor(c.pathProgress)
    const t   = c.pathProgress - idx
    const a   = this.gridMap.cellToWorld(path[idx].x,     path[idx].z)
    const b   = this.gridMap.cellToWorld(path[idx + 1].x, path[idx + 1].z)
    c.marker.position.x = a.x + (b.x - a.x) * t
    c.marker.position.z = a.z + (b.z - a.z) * t
  }

  private arriveAt(
    c:     Citizen,
    state: State.AtWork | State.AtHome,
    dwell: number,
  ): void {
    c.state      = state
    c.dwellTimer = dwell
    const cell   = state === State.AtWork ? c.workCell : c.homeCell
    const wp     = this.gridMap.cellToWorld(cell.x, cell.z)
    c.marker.position.x = wp.x
    c.marker.position.z = wp.z
  }

  private startNextCommute(c: Citizen): void {
    const leavingWork   = c.state === State.AtWork
    c.state             = leavingWork ? State.CommutingHome : State.CommutingToWork
    c.pathProgress      = 0
    const startNode     = leavingWork ? c.returnPath[0] : c.forwardPath[0]
    const wp            = this.gridMap.cellToWorld(startNode.x, startNode.z)
    c.marker.position.x = wp.x
    c.marker.position.z = wp.z
  }

  // ── Zone scan & citizen spawn ───────────────────────────────────────────────

  private rebuildCitizens(): void {
    for (const c of this.citizens) c.marker.dispose()
    this.citizens = []

    type Entry = { cell: { x: number; z: number }; road: { x: number; z: number } }
    const residential: Entry[] = []
    const commercial:  Entry[] = []

    for (let z = 0; z < this.gridMap.height; z++) {
      for (let x = 0; x < this.gridMap.width; x++) {
        const cell = this.gridMap.get(x, z)
        if (cell === CellType.ZONE_RESIDENTIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) residential.push({ cell: { x, z }, road })
        } else if (cell === CellType.ZONE_COMMERCIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) commercial.push({ cell: { x, z }, road })
        }
      }
    }

    if (residential.length === 0 || commercial.length === 0) return

    for (let i = 0; i < residential.length && this.citizens.length < MAX_CITIZENS; i++) {
      const home = residential[i]
      const work = commercial[i % commercial.length]

      const path = this.roadGraph.findPath(home.road.x, home.road.z, work.road.x, work.road.z)
      if (!path || path.length < 2) continue

      const startWp     = this.gridMap.cellToWorld(path[0].x, path[0].z)
      const marker      = this.template.createInstance(`citizen_${this.nextInstanceId++}`)
      marker.position   = new Vector3(startWp.x, 0.25, startWp.z)
      marker.isPickable = false

      this.citizens.push({
        homeCell:     home.cell,
        workCell:     work.cell,
        forwardPath:  path,
        returnPath:   path.slice().reverse(),
        state:        State.CommutingToWork,
        pathProgress: 0,
        dwellTimer:   0,
        marker,
      })
    }
  }

  /**
   * BFS outward from (cx, cz) to locate the nearest ROAD cell.
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
        if (this.gridMap.get(nx, nz) === CellType.ROAD) return { x: nx, z: nz }
        queue.push({ x: nx, z: nz, dist: dist + 1 })
      }
    }
    return null
  }
}
