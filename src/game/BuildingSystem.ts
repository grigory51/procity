import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

export const enum ZoneType {
  Residential = 0,
  Commercial = 1,
  Industrial = 2,
}

// Colors: Residential=blue, Commercial=green, Industrial=yellow
const ZONE_COLORS: Color3[] = [
  new Color3(0.18, 0.42, 0.92),
  new Color3(0.12, 0.80, 0.28),
  new Color3(0.95, 0.78, 0.08),
]

// [minHeight, maxHeight] per zone type
const ZONE_HEIGHT_RANGE: [number, number][] = [
  [4, 16],   // Residential
  [12, 40],  // Commercial
  [3, 9],    // Industrial
]

// [minFootprint, maxFootprint] per zone type
const ZONE_FOOTPRINT_RANGE: [number, number][] = [
  [1.5, 2.5],
  [2.0, 3.5],
  [3.5, 5.5],
]

// Knuth LCG — deterministic, seed-reproducible
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return (): number => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

const BUILDING_COUNT = 100
const GRID_COLS = 10
const GRID_ROWS = 10
const CELL_SPACING = 8  // world units between building centres

export class BuildingSystem {
  private templates: Mesh[] = []

  constructor(scene: Scene) {
    this.build(scene)
  }

  private build(scene: Scene): void {
    const rng = lcg(42)  // fixed seed → deterministic geometry

    // One unit-cube template per zone type; invisible, instances take the visual role
    this.templates = ZONE_COLORS.map((color, i) => {
      const mat = new StandardMaterial(`zoneMat${i}`, scene)
      mat.diffuseColor = color
      mat.specularColor = new Color3(0.15, 0.15, 0.15)

      const mesh = MeshBuilder.CreateBox(`zoneTemplate${i}`, { size: 1 }, scene)
      mesh.material = mat
      mesh.isVisible = false  // template is a draw-call source only
      return mesh
    })

    // Zone assignment: 40 residential, 35 commercial, 25 industrial, then shuffle
    const assignments = new Array<ZoneType>(BUILDING_COUNT)
    const counts: [ZoneType, number][] = [
      [ZoneType.Residential, 40],
      [ZoneType.Commercial, 35],
      [ZoneType.Industrial, 25],
    ]
    let cursor = 0
    for (const [zone, n] of counts) {
      for (let k = 0; k < n; k++) assignments[cursor++] = zone
    }
    // Fisher-Yates with seeded rng
    for (let i = assignments.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[assignments[i], assignments[j]] = [assignments[j], assignments[i]]
    }

    const halfGrid = ((GRID_COLS - 1) * CELL_SPACING) / 2

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = row * GRID_COLS + col
        const zone = assignments[idx]

        const height = lerp(ZONE_HEIGHT_RANGE[zone][0], ZONE_HEIGHT_RANGE[zone][1], rng())
        const footprint = lerp(ZONE_FOOTPRINT_RANGE[zone][0], ZONE_FOOTPRINT_RANGE[zone][1], rng())

        const inst = this.templates[zone].createInstance(`bld_${idx}`)
        inst.position = new Vector3(
          col * CELL_SPACING - halfGrid,
          height / 2,  // raise so base sits on y=0 ground plane
          row * CELL_SPACING - halfGrid,
        )
        inst.scaling = new Vector3(footprint, height, footprint)
      }
    }
  }

  dispose(): void {
    for (const t of this.templates) t.dispose()
    this.templates = []
  }
}
