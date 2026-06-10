import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type InstancedMesh,
} from '@babylonjs/core'

export enum ZoneType {
  Residential = 0,
  Commercial = 1,
  Industrial = 2,
}

// Height range [min, max] in world units (≈10m per unit at game scale)
const ZONE_HEIGHT_RANGE: [number, number][] = [
  [0.8, 2.5],   // Residential
  [1.5, 6.0],   // Commercial
  [0.4, 1.2],   // Industrial
]

// Footprint range [min, max] — fits within 1-unit cell
const ZONE_FOOTPRINT_RANGE: [number, number][] = [
  [0.50, 0.75],
  [0.45, 0.65],
  [0.65, 0.88],
]

const ZONE_COLORS: Color3[] = [
  new Color3(0.18, 0.42, 0.92),
  new Color3(0.12, 0.80, 0.28),
  new Color3(0.95, 0.78, 0.08),
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

export class BuildingSystem {
  private templates: Mesh[] = []

  constructor(scene: Scene) {
    this.templates = ZONE_COLORS.map((color, i) => {
      const mat = new StandardMaterial(`zoneMat${i}`, scene)
      mat.diffuseColor = color
      mat.specularColor = new Color3(0.15, 0.15, 0.15)

      const mesh = MeshBuilder.CreateBox(`zoneTemplate${i}`, { size: 1 }, scene)
      mesh.material = mat
      mesh.isVisible = false  // template is a draw-call source only; instances carry the visual
      return mesh
    })
  }

  /** Spawn a building instance at worldX/worldZ for a grid cell. Geometry is deterministic via cell coords. */
  spawnAt(cx: number, cz: number, zone: ZoneType, worldX: number, worldZ: number): InstancedMesh {
    const seed = (cx * 31337 + cz * 7919) >>> 0
    const rng = lcg(seed)
    const height = lerp(ZONE_HEIGHT_RANGE[zone][0], ZONE_HEIGHT_RANGE[zone][1], rng())
    const footprint = lerp(ZONE_FOOTPRINT_RANGE[zone][0], ZONE_FOOTPRINT_RANGE[zone][1], rng())

    const inst = this.templates[zone].createInstance(`bld_${cx}_${cz}`)
    inst.position = new Vector3(worldX, height / 2, worldZ)
    inst.scaling = new Vector3(footprint, height, footprint)
    return inst
  }

  dispose(): void {
    for (const t of this.templates) t.dispose()
    this.templates = []
  }
}
