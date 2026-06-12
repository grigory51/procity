import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type InstancedMesh,
} from '@babylonjs/core'
import { CellType, GridMap, isRoadCell } from '../simulation'
import { RoadGraph } from '../simulation'
import type { PathNode } from '../simulation'

// ── Simulation constants ─────────────────────────────────────────────────────

/** World units (= grid cells) per second each citizen travels along road path. */
const CITIZEN_SPEED      = 4.0
/** Seconds a citizen spends at work before heading home. */
const WORK_DWELL         = 5.0
/** Seconds a citizen spends at home before the next commute. */
const HOME_DWELL         = 3.0
/** Seconds a citizen spends at a commercial zone on a shopping trip. */
const SHOP_DWELL         = 2.0
/** Maximum simultaneous citizens (MVP cap). */
const MAX_CITIZENS       = 100
/** BFS radius (cells) to find the nearest road from a zone cell. */
const ROAD_SEARCH_RADIUS = 8
/** Savings (game currency) earned per game-second while at work. */
const WAGE_PER_SECOND    = 1.0
/** Minimum savings required before a citizen will go shopping. */
const SHOP_COST          = 20.0
/** Probability per home-dwell expiry that a citizen with enough savings goes shopping. */
const SHOP_PROBABILITY   = 0.40

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// ── State machine ────────────────────────────────────────────────────────────

enum State {
  CommutingToWork   = 0,
  AtWork            = 1,
  CommutingHome     = 2,
  AtHome            = 3,
  CommutingToShop   = 4,  // heading to a commercial zone for spending
  Shopping          = 5,  // dwelling at the commercial zone
  CommutingFromShop = 6,  // returning home after shopping
}

// ── Citizen data ─────────────────────────────────────────────────────────────

interface Citizen {
  readonly homeCell:        { x: number; z: number }
  readonly workCell:        { x: number; z: number }
  readonly forwardPath:     PathNode[]  // homeRoad → workRoad
  readonly returnPath:      PathNode[]  // workRoad → homeRoad (reverse)
  readonly shopCell:        { x: number; z: number } | null
  readonly shopGoPath:      PathNode[] | null  // homeRoad → shopRoad
  readonly shopReturnPath:  PathNode[] | null  // shopRoad → homeRoad
  state:        State
  pathProgress: number   // fractional node index [0 .. path.length-1]
  dwellTimer:   number   // seconds remaining in AtWork / AtHome / Shopping
  savings:      number   // game currency accumulated from working
  marker:       InstancedMesh
}

// ── CitizenManager ─────────────────────────────────────────────────────────────

/**
 * Manages up to MAX_CITIZENS agents that live in residential zones, commute to
 * commercial or industrial workplaces, and occasionally visit commercial zones
 * to spend their savings.
 *
 * Lifecycle: home → work → (shopping trip?) → home → work → …
 * Rebuilds whenever gridMap.version changes.
 */
export class CitizenManager {
  private citizens:        Citizen[] = []
  private template:        Mesh
  private matCommuting:    StandardMaterial
  private matStationary:   StandardMaterial
  private matShopping:     StandardMaterial
  private lastGridVersion  = -1
  private nextInstanceId   = 0
  private _onShopCb: ((amount: number) => void) | null = null

  constructor(
    scene:                      Scene,
    private readonly gridMap:   GridMap,
    private readonly roadGraph: RoadGraph,
  ) {
    // Blue: citizens in transit to/from work
    this.matCommuting              = new StandardMaterial('citizenMatCommuting', scene)
    this.matCommuting.diffuseColor  = new Color3(0.20, 0.55, 1.00)
    this.matCommuting.emissiveColor = new Color3(0.08, 0.22, 0.50)
    this.matCommuting.specularColor = new Color3(0.20, 0.20, 0.20)

    // Green: citizens stationary at home or work
    this.matStationary              = new StandardMaterial('citizenMatStationary', scene)
    this.matStationary.diffuseColor  = new Color3(0.20, 0.85, 0.30)
    this.matStationary.emissiveColor = new Color3(0.08, 0.40, 0.12)
    this.matStationary.specularColor = new Color3(0.20, 0.20, 0.20)

    // Amber: citizens on shopping trips
    this.matShopping              = new StandardMaterial('citizenMatShopping', scene)
    this.matShopping.diffuseColor  = new Color3(1.00, 0.75, 0.10)
    this.matShopping.emissiveColor = new Color3(0.50, 0.35, 0.05)
    this.matShopping.specularColor = new Color3(0.20, 0.20, 0.20)

    this.template            = MeshBuilder.CreateSphere('citizenTemplate', { diameter: 0.22, segments: 4 }, scene)
    this.template.material   = this.matCommuting
    this.template.isPickable = false
    this.template.setEnabled(false)
  }

  /**
   * Register a callback that fires each time a citizen completes a shopping trip.
   * The argument is the amount spent (game currency). Wire into EconomyManager.addShopRevenue().
   */
  onShop(cb: (amount: number) => void): void {
    this._onShopCb = cb
  }

  /**
   * Advance simulation by deltaTime seconds and sync visual marker positions.
   * Must be called once per render frame. deltaTime is in seconds.
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

  /** Citizens currently moving along a road (to/from work or shop). */
  get commutingCount(): number {
    let n = 0
    for (const c of this.citizens) {
      if (
        c.state === State.CommutingToWork ||
        c.state === State.CommutingHome ||
        c.state === State.CommutingToShop ||
        c.state === State.CommutingFromShop
      ) n++
    }
    return n
  }

  get atWorkCount(): number {
    let n = 0
    for (const c of this.citizens) {
      if (c.state === State.AtWork) n++
    }
    return n
  }

  get atHomeCount(): number {
    let n = 0
    for (const c of this.citizens) {
      if (c.state === State.AtHome) n++
    }
    return n
  }

  /** Citizens currently dwelling at a commercial zone on a shopping trip. */
  get shoppingCount(): number {
    let n = 0
    for (const c of this.citizens) {
      if (c.state === State.Shopping) n++
    }
    return n
  }

  /** Returns how many citizens call (cx,cz) home, work there, or regularly shop there. */
  citizensAtCell(cx: number, cz: number): { residents: number; workers: number; shoppers: number } {
    let residents = 0, workers = 0, shoppers = 0
    for (const c of this.citizens) {
      if (c.homeCell.x === cx && c.homeCell.z === cz) residents++
      if (c.workCell.x === cx && c.workCell.z === cz) workers++
      if (c.shopCell && c.shopCell.x === cx && c.shopCell.z === cz) shoppers++
    }
    return { residents, workers, shoppers }
  }

  dispose(): void {
    for (const c of this.citizens) c.marker.dispose()
    this.citizens = []
    this.template.dispose()
    this.matCommuting.dispose()
    this.matStationary.dispose()
    this.matShopping.dispose()
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  private tickCitizen(c: Citizen, dt: number): void {
    switch (c.state) {
      case State.CommutingToWork:
        this.advanceAlongPath(c, c.forwardPath, dt, State.AtWork, WORK_DWELL)
        break

      case State.AtWork:
        c.savings += WAGE_PER_SECOND * dt
        c.dwellTimer -= dt
        if (c.dwellTimer <= 0) this.startNextCommute(c)
        break

      case State.CommutingHome:
        this.advanceAlongPath(c, c.returnPath, dt, State.AtHome, HOME_DWELL)
        break

      case State.AtHome:
        c.dwellTimer -= dt
        if (c.dwellTimer <= 0) {
          if (c.shopGoPath && c.savings >= SHOP_COST && Math.random() < SHOP_PROBABILITY) {
            this.startShoppingTrip(c)
          } else {
            this.startNextCommute(c)
          }
        }
        break

      case State.CommutingToShop:
        this.advanceAlongPath(c, c.shopGoPath!, dt, State.Shopping, SHOP_DWELL)
        break

      case State.Shopping:
        c.dwellTimer -= dt
        if (c.dwellTimer <= 0) {
          const spent = Math.min(c.savings, SHOP_COST)
          c.savings -= spent
          this._onShopCb?.(spent)
          this.startReturnFromShop(c)
        }
        break

      case State.CommutingFromShop:
        this.advanceAlongPath(c, c.shopReturnPath!, dt, State.AtHome, HOME_DWELL)
        break
    }
  }

  private advanceAlongPath(
    c:         Citizen,
    path:      PathNode[],
    dt:        number,
    nextState: State.AtWork | State.AtHome | State.Shopping,
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
    state: State.AtWork | State.AtHome | State.Shopping,
    dwell: number,
  ): void {
    c.state      = state
    c.dwellTimer = dwell

    let cell: { x: number; z: number }
    if (state === State.AtWork) {
      cell = c.workCell
      c.marker.material = this.matStationary
    } else if (state === State.Shopping) {
      cell = c.shopCell!
      c.marker.material = this.matShopping
    } else {
      cell = c.homeCell
      c.marker.material = this.matStationary
    }

    const wp = this.gridMap.cellToWorld(cell.x, cell.z)
    c.marker.position.x = wp.x
    c.marker.position.z = wp.z
  }

  private startNextCommute(c: Citizen): void {
    const leavingWork  = c.state === State.AtWork
    c.state            = leavingWork ? State.CommutingHome : State.CommutingToWork
    c.pathProgress     = 0
    c.marker.material  = this.matCommuting
    const startNode    = leavingWork ? c.returnPath[0] : c.forwardPath[0]
    const wp           = this.gridMap.cellToWorld(startNode.x, startNode.z)
    c.marker.position.x = wp.x
    c.marker.position.z = wp.z
  }

  private startShoppingTrip(c: Citizen): void {
    c.state             = State.CommutingToShop
    c.pathProgress      = 0
    c.marker.material   = this.matShopping
    const startNode     = c.shopGoPath![0]
    const wp            = this.gridMap.cellToWorld(startNode.x, startNode.z)
    c.marker.position.x = wp.x
    c.marker.position.z = wp.z
  }

  private startReturnFromShop(c: Citizen): void {
    c.state             = State.CommutingFromShop
    c.pathProgress      = 0
    c.marker.material   = this.matShopping
    const startNode     = c.shopReturnPath![0]
    const wp            = this.gridMap.cellToWorld(startNode.x, startNode.z)
    c.marker.position.x = wp.x
    c.marker.position.z = wp.z
  }

  // ── Zone scan & citizen spawn ───────────────────────────────────────────────

  private rebuildCitizens(): void {
    for (const c of this.citizens) c.marker.dispose()
    this.citizens = []

    type Entry = { cell: { x: number; z: number }; road: { x: number; z: number } }
    const residential:     Entry[] = []
    const workplaces:      Entry[] = []  // ZONE_COMMERCIAL + ZONE_INDUSTRIAL
    const commercialZones: Entry[] = [] // ZONE_COMMERCIAL only (for shopping)

    for (let z = 0; z < this.gridMap.height; z++) {
      for (let x = 0; x < this.gridMap.width; x++) {
        const cell = this.gridMap.get(x, z)
        if (cell === CellType.ZONE_RESIDENTIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) residential.push({ cell: { x, z }, road })
        } else if (cell === CellType.ZONE_COMMERCIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) {
            const entry = { cell: { x, z }, road }
            workplaces.push(entry)
            commercialZones.push(entry)
          }
        } else if (cell === CellType.ZONE_INDUSTRIAL) {
          const road = this.findNearestRoad(x, z)
          if (road) workplaces.push({ cell: { x, z }, road })
        }
      }
    }

    if (residential.length === 0 || workplaces.length === 0) return

    for (let i = 0; i < residential.length && this.citizens.length < MAX_CITIZENS; i++) {
      const home = residential[i]
      const work = workplaces[i % workplaces.length]

      const path = this.roadGraph.findPath(home.road.x, home.road.z, work.road.x, work.road.z)
      if (!path || path.length < 2) continue

      const shopInfo = this.findShopDestination(home, work, commercialZones)

      const startWp     = this.gridMap.cellToWorld(path[0].x, path[0].z)
      const marker      = this.template.createInstance(`citizen_${this.nextInstanceId++}`)
      marker.position   = new Vector3(startWp.x, 0.25, startWp.z)
      marker.isPickable = false

      this.citizens.push({
        homeCell:       home.cell,
        workCell:       work.cell,
        forwardPath:    path,
        returnPath:     path.slice().reverse(),
        shopCell:       shopInfo?.shopCell ?? null,
        shopGoPath:     shopInfo?.shopGoPath ?? null,
        shopReturnPath: shopInfo?.shopReturnPath ?? null,
        state:          State.CommutingToWork,
        pathProgress:   0,
        dwellTimer:     0,
        savings:        0,
        marker,
      })
    }
  }

  /**
   * Finds a commercial zone the citizen can reach from home for shopping.
   * Prefers zones different from the work cell so shopping is a distinct trip.
   */
  private findShopDestination(
    home:            { cell: { x: number; z: number }; road: { x: number; z: number } },
    work:            { cell: { x: number; z: number }; road: { x: number; z: number } },
    commercialZones: { cell: { x: number; z: number }; road: { x: number; z: number } }[],
  ): { shopCell: { x: number; z: number }; shopGoPath: PathNode[]; shopReturnPath: PathNode[] } | null {
    if (commercialZones.length === 0) return null

    // Prefer a different zone from work so shopping is a distinct destination
    const others = commercialZones.filter(c => c.cell.x !== work.cell.x || c.cell.z !== work.cell.z)
    const pool   = others.length > 0 ? others : commercialZones

    for (const shop of pool) {
      const goPath = this.roadGraph.findPath(home.road.x, home.road.z, shop.road.x, shop.road.z)
      if (goPath && goPath.length >= 2) {
        return {
          shopCell:       shop.cell,
          shopGoPath:     goPath,
          shopReturnPath: goPath.slice().reverse(),
        }
      }
    }
    return null
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
        if (isRoadCell(this.gridMap.get(nx, nz))) return { x: nx, z: nz }
        queue.push({ x: nx, z: nz, dist: dist + 1 })
      }
    }
    return null
  }
}
