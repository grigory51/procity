import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
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

// ── Texture helpers ──────────────────────────────────────────────────────────

function buildWindowTexture(
  name: string,
  floors: number,
  cols: number,
  wallHex: string,
  winHex: string,
  scene: Scene,
): DynamicTexture {
  const W = 256, H = 256
  const tex = new DynamicTexture(name, { width: W, height: H }, scene, false)
  const ctx = tex.getContext()
  ctx.fillStyle = wallHex
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = winHex
  const cw = (W / cols) * 0.50
  const ch = (H / floors) * 0.44
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect((c + 0.25) * (W / cols), H - (f + 0.75) * (H / floors), cw, ch)
    }
  }
  tex.update()
  return tex
}

// ── Geometry builders ────────────────────────────────────────────────────────

/**
 * Box walls + square pyramid hip roof.
 * Building base sits at local y=0 (ready for ground placement).
 */
function buildHouse(
  name: string,
  fp: number,
  wallH: number,
  roofH: number,
  mat: StandardMaterial,
  scene: Scene,
): Mesh {
  const walls = MeshBuilder.CreateBox(`${name}_w`, { width: fp, height: wallH, depth: fp }, scene)
  walls.position.y = wallH / 2
  walls.bakeCurrentTransformIntoVertices()

  // tessellation=4 → square pyramid; rotation aligns corners to box corners
  const roof = MeshBuilder.CreateCylinder(`${name}_r`, {
    tessellation: 4,
    diameterTop: 0,
    diameterBottom: fp * 1.25,
    height: roofH,
  }, scene)
  roof.position.y = wallH + roofH / 2
  roof.rotation.y = Math.PI / 4
  roof.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([walls, roof], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  return merged
}

/** Box with window-grid texture (apartment block). */
function buildApartment(
  name: string,
  fp: number,
  h: number,
  mat: StandardMaterial,
  scene: Scene,
): Mesh {
  const m = MeshBuilder.CreateBox(name, { width: fp, height: h, depth: fp }, scene)
  m.position.y = h / 2
  m.bakeCurrentTransformIntoVertices()
  m.material = mat
  m.isVisible = false
  return m
}

/** Stepped tower: wider lower section + narrower upper section (setback). */
function buildOfficeTower(
  name: string,
  fp: number,
  h: number,
  mat: PBRMaterial,
  scene: Scene,
): Mesh {
  const lo = MeshBuilder.CreateBox(`${name}_lo`, { width: fp, height: h * 0.55, depth: fp }, scene)
  lo.position.y = (h * 0.55) / 2
  lo.bakeCurrentTransformIntoVertices()

  const up = MeshBuilder.CreateBox(`${name}_up`, {
    width: fp * 0.72, height: h * 0.45, depth: fp * 0.72,
  }, scene)
  up.position.y = h * 0.55 + (h * 0.45) / 2
  up.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([lo, up], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  return merged
}

/** Ground-floor retail: box + thin canopy overhang on one side. */
function buildRetail(
  name: string,
  fp: number,
  h: number,
  mat: StandardMaterial,
  scene: Scene,
): Mesh {
  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  const awningD = fp * 0.32
  const awning = MeshBuilder.CreateBox(`${name}_a`, {
    width: fp * 0.88,
    height: 0.05,
    depth: awningD,
  }, scene)
  awning.position.y = h * 0.65
  awning.position.z = -(fp / 2 + awningD / 2)
  awning.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, awning], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  return merged
}

/** Flat warehouse box, optionally with a chimney stack. */
function buildWarehouse(
  name: string,
  fp: number,
  h: number,
  chimney: boolean,
  mat: StandardMaterial,
  scene: Scene,
): Mesh {
  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  if (!chimney) {
    body.name = name
    body.material = mat
    body.isVisible = false
    return body
  }

  const chH = h * 0.65
  const ch = MeshBuilder.CreateCylinder(`${name}_ch`, {
    tessellation: 6,
    diameterTop: 0.06,
    diameterBottom: 0.09,
    height: chH,
  }, scene)
  ch.position.x = fp * 0.25
  ch.position.y = h + chH / 2
  ch.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, ch], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  return merged
}

// ── BuildingSystem ───────────────────────────────────────────────────────────

export class BuildingSystem {
  private templatesByZone: Map<ZoneType, Mesh[]> = new Map()
  private materials: (StandardMaterial | PBRMaterial)[] = []
  private textures: DynamicTexture[] = []

  constructor(scene: Scene) {
    // ── Residential ────────────────────────────────────────────────────────────
    const resHouseMat = new StandardMaterial('mat_res_house', scene)
    resHouseMat.diffuseColor = new Color3(0.78, 0.52, 0.36)
    resHouseMat.specularColor = new Color3(0.08, 0.08, 0.08)

    const resAptTexA = buildWindowTexture('tex_apt_a', 4, 6, '#7a8a9a', '#cde8ff', scene)
    const resAptMatA = new StandardMaterial('mat_res_apt_a', scene)
    resAptMatA.diffuseTexture = resAptTexA

    const resAptTexB = buildWindowTexture('tex_apt_b', 5, 8, '#6a7282', '#bbd5f5', scene)
    const resAptMatB = new StandardMaterial('mat_res_apt_b', scene)
    resAptMatB.diffuseTexture = resAptTexB

    // ── Commercial ─────────────────────────────────────────────────────────────
    const comTowerMat = new PBRMaterial('mat_com_tower', scene)
    comTowerMat.albedoColor = new Color3(0.50, 0.68, 0.88)
    comTowerMat.metallic = 0.3
    comTowerMat.roughness = 0.35

    const comRetailMat = new StandardMaterial('mat_com_retail', scene)
    comRetailMat.diffuseColor = new Color3(0.92, 0.88, 0.78)
    comRetailMat.specularColor = new Color3(0.15, 0.15, 0.10)

    // ── Industrial ─────────────────────────────────────────────────────────────
    const indMat = new StandardMaterial('mat_ind', scene)
    indMat.diffuseColor = new Color3(0.60, 0.60, 0.55)
    indMat.specularColor = new Color3(0.08, 0.08, 0.08)

    this.materials = [resHouseMat, resAptMatA, resAptMatB, comTowerMat, comRetailMat, indMat]
    this.textures = [resAptTexA, resAptTexB]

    // ── Templates (9 total) ────────────────────────────────────────────────────
    // Residential: 2 low-rise houses + 2 mid-rise apartments
    this.templatesByZone.set(ZoneType.Residential, [
      buildHouse('res_house_a', 0.60, 0.90, 0.44, resHouseMat, scene),
      buildHouse('res_house_b', 0.65, 1.10, 0.52, resHouseMat, scene),
      buildApartment('res_apt_a', 0.58, 2.00, resAptMatA, scene),
      buildApartment('res_apt_b', 0.60, 2.50, resAptMatB, scene),
    ])

    // Commercial: 2 stepped office towers + 1 ground-floor retail
    this.templatesByZone.set(ZoneType.Commercial, [
      buildOfficeTower('com_tower_a', 0.45, 3.50, comTowerMat, scene),
      buildOfficeTower('com_tower_b', 0.48, 5.00, comTowerMat, scene),
      buildRetail('com_retail_a', 0.68, 1.50, comRetailMat, scene),
    ])

    // Industrial: flat warehouse + warehouse with chimney
    this.templatesByZone.set(ZoneType.Industrial, [
      buildWarehouse('ind_wh_a', 0.78, 0.70, false, indMat, scene),
      buildWarehouse('ind_wh_b', 0.75, 0.85, true, indMat, scene),
    ])
  }

  /** Spawn a building instance at worldX/worldZ for a grid cell. Geometry is deterministic via cell coords. */
  spawnAt(cx: number, cz: number, zone: ZoneType, worldX: number, worldZ: number): InstancedMesh {
    const seed = (cx * 31337 + cz * 7919) >>> 0
    const rng = lcg(seed)
    const templates = this.templatesByZone.get(zone)!

    // Weighted subtype selection per zone
    const r = rng()
    let idx: number
    if (zone === ZoneType.Residential) {
      // 60% low-rise houses, 40% mid-rise apartments
      idx = r < 0.30 ? 0 : r < 0.60 ? 1 : r < 0.80 ? 2 : 3
    } else if (zone === ZoneType.Commercial) {
      // 75% towers, 25% retail
      idx = r < 0.25 ? 2 : r < 0.62 ? 0 : 1
    } else {
      // Industrial 50/50
      idx = r < 0.50 ? 0 : 1
    }

    const scaleFactor = lerp(0.88, 1.12, rng())
    const inst = templates[idx].createInstance(`bld_${cx}_${cz}`)
    // Buildings are built base-at-y=0; place directly on ground plane
    inst.position = new Vector3(worldX, 0, worldZ)
    inst.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor)
    return inst
  }

  dispose(): void {
    for (const zone of this.templatesByZone.values()) {
      for (const t of zone) t.dispose()
    }
    this.templatesByZone.clear()
    for (const m of this.materials) m.dispose()
    for (const t of this.textures) t.dispose()
    this.materials = []
    this.textures = []
  }
}
