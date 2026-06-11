import {
  Color3,
  DirectionalLight,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
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
  trimHex: string,
  glassHex: string,
  scene: Scene,
): DynamicTexture {
  const W = 256, H = 256
  const tex = new DynamicTexture(name, { width: W, height: H }, scene, false)
  const ctx = tex.getContext()
  const fw = W / cols, fh = H / floors
  // Wall base
  ctx.fillStyle = wallHex
  ctx.fillRect(0, 0, W, H)
  // Window frame (trim)
  ctx.fillStyle = trimHex
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect((c + 0.18) * fw, H - (f + 0.82) * fh, fw * 0.64, fh * 0.58)
    }
  }
  // Window glass (inset inside trim)
  ctx.fillStyle = glassHex
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect((c + 0.24) * fw, H - (f + 0.76) * fh, fw * 0.52, fh * 0.46)
    }
  }
  tex.update()
  return tex
}

// ── Geometry builders ────────────────────────────────────────────────────────

/** Single-family house: hip roof + chimney + porch step + canopy */
function buildSmallHouse(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const wallH = 0.82, roofH = 0.48

  const walls = MeshBuilder.CreateBox(`${name}_w`, { width: fp, height: wallH, depth: fp }, scene)
  walls.position.y = wallH / 2
  walls.bakeCurrentTransformIntoVertices()

  const roof = MeshBuilder.CreateCylinder(`${name}_r`, {
    tessellation: 4, diameterTop: 0, diameterBottom: fp * 1.18, height: roofH,
  }, scene)
  roof.position.y = wallH + roofH / 2
  roof.rotation.y = Math.PI / 4
  roof.bakeCurrentTransformIntoVertices()

  const chimH = 0.36
  const chimney = MeshBuilder.CreateBox(`${name}_ch`, { width: 0.08, height: chimH, depth: 0.08 }, scene)
  chimney.position.x = fp * 0.22
  chimney.position.y = wallH + roofH * 0.42 + chimH / 2
  chimney.bakeCurrentTransformIntoVertices()

  const cap = MeshBuilder.CreateBox(`${name}_cap`, { width: 0.13, height: 0.04, depth: 0.13 }, scene)
  cap.position.x = fp * 0.22
  cap.position.y = wallH + roofH * 0.42 + chimH + 0.02
  cap.bakeCurrentTransformIntoVertices()

  const step = MeshBuilder.CreateBox(`${name}_step`, { width: fp * 0.30, height: 0.06, depth: 0.10 }, scene)
  step.position.y = 0.03
  step.position.z = -(fp / 2 + 0.05)
  step.bakeCurrentTransformIntoVertices()

  const porch = MeshBuilder.CreateBox(`${name}_porch`, { width: fp * 0.36, height: 0.04, depth: 0.18 }, scene)
  porch.position.y = wallH * 0.58
  porch.position.z = -(fp / 2 + 0.09)
  porch.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([walls, roof, chimney, cap, step, porch], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Townhouse: tall narrow body + bay window protrusion + flat parapet roof */
function buildTownhouse(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const wallH = 1.65, w = fp * 0.68

  const walls = MeshBuilder.CreateBox(`${name}_w`, { width: w, height: wallH, depth: fp }, scene)
  walls.position.y = wallH / 2
  walls.bakeCurrentTransformIntoVertices()

  const parapet = MeshBuilder.CreateBox(`${name}_par`, { width: w + 0.08, height: 0.12, depth: fp + 0.08 }, scene)
  parapet.position.y = wallH + 0.06
  parapet.bakeCurrentTransformIntoVertices()

  const bayW = w * 0.34, bayH = wallH * 0.40
  const bay = MeshBuilder.CreateBox(`${name}_bay`, { width: bayW, height: bayH, depth: 0.09 }, scene)
  bay.position.y = wallH * 0.40
  bay.position.z = -(fp / 2 + 0.045)
  bay.bakeCurrentTransformIntoVertices()

  const bayRoof = MeshBuilder.CreateBox(`${name}_br`, { width: bayW + 0.06, height: 0.05, depth: 0.13 }, scene)
  bayRoof.position.y = wallH * 0.40 + bayH / 2 + 0.025
  bayRoof.position.z = -(fp / 2 + 0.065)
  bayRoof.bakeCurrentTransformIntoVertices()

  const step = MeshBuilder.CreateBox(`${name}_step`, { width: w * 0.28, height: 0.05, depth: 0.09 }, scene)
  step.position.y = 0.025
  step.position.z = -(fp / 2 + 0.045)
  step.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([walls, parapet, bay, bayRoof, step], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Mid-rise apartment block: window grid + rooftop parapet + stairwell tower + entrance canopy */
function buildApartmentBlock(name: string, fp: number, h: number, mat: PBRMaterial, scene: Scene): Mesh {
  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  const parapet = MeshBuilder.CreateBox(`${name}_par`, { width: fp + 0.08, height: 0.14, depth: fp + 0.08 }, scene)
  parapet.position.y = h + 0.07
  parapet.bakeCurrentTransformIntoVertices()

  const tower = MeshBuilder.CreateBox(`${name}_tw`, { width: fp * 0.22, height: 0.34, depth: fp * 0.22 }, scene)
  tower.position.x = fp * 0.22
  tower.position.y = h + 0.17
  tower.bakeCurrentTransformIntoVertices()

  const canopy = MeshBuilder.CreateBox(`${name}_can`, { width: fp * 0.46, height: 0.05, depth: 0.20 }, scene)
  canopy.position.y = h * 0.26
  canopy.position.z = -(fp / 2 + 0.10)
  canopy.bakeCurrentTransformIntoVertices()

  const post = MeshBuilder.CreateBox(`${name}_cp`, { width: 0.05, height: h * 0.26, depth: 0.05 }, scene)
  post.position.y = h * 0.13
  post.position.z = -(fp / 2 + 0.18)
  post.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, parapet, tower, canopy, post], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Ground-floor retail: flat roof overhang + signage panel + awning with support posts */
function buildShopFront(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const h = 1.35

  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  const roofMesh = MeshBuilder.CreateBox(`${name}_rf`, { width: fp + 0.08, height: 0.08, depth: fp + 0.08 }, scene)
  roofMesh.position.y = h + 0.04
  roofMesh.bakeCurrentTransformIntoVertices()

  const sign = MeshBuilder.CreateBox(`${name}_sg`, { width: fp * 0.76, height: h * 0.15, depth: 0.06 }, scene)
  sign.position.y = h * 0.80
  sign.position.z = -(fp / 2 + 0.03)
  sign.bakeCurrentTransformIntoVertices()

  const awD = fp * 0.26
  const awning = MeshBuilder.CreateBox(`${name}_aw`, { width: fp * 0.80, height: 0.05, depth: awD }, scene)
  awning.position.y = h * 0.56
  awning.position.z = -(fp / 2 + awD / 2)
  awning.bakeCurrentTransformIntoVertices()

  const postH = h * 0.54
  const pL = MeshBuilder.CreateBox(`${name}_pL`, { width: 0.04, height: postH, depth: 0.04 }, scene)
  pL.position.x = fp * 0.28
  pL.position.y = postH / 2
  pL.position.z = -(fp / 2 + awD)
  pL.bakeCurrentTransformIntoVertices()

  const pR = MeshBuilder.CreateBox(`${name}_pR`, { width: 0.04, height: postH, depth: 0.04 }, scene)
  pR.position.x = -fp * 0.28
  pR.position.y = postH / 2
  pR.position.z = -(fp / 2 + awD)
  pR.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, roofMesh, sign, awning, pL, pR], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Stepped office tower: lower + upper setback + HVAC + spire + entrance canopy */
function buildOfficeTower(name: string, fp: number, h: number, mat: PBRMaterial, scene: Scene): Mesh {
  const lo = MeshBuilder.CreateBox(`${name}_lo`, { width: fp, height: h * 0.55, depth: fp }, scene)
  lo.position.y = (h * 0.55) / 2
  lo.bakeCurrentTransformIntoVertices()

  const up = MeshBuilder.CreateBox(`${name}_up`, { width: fp * 0.72, height: h * 0.45, depth: fp * 0.72 }, scene)
  up.position.y = h * 0.55 + (h * 0.45) / 2
  up.bakeCurrentTransformIntoVertices()

  const hvac = MeshBuilder.CreateBox(`${name}_hvac`, { width: fp * 0.26, height: 0.18, depth: fp * 0.20 }, scene)
  hvac.position.x = -fp * 0.15
  hvac.position.y = h + 0.09
  hvac.bakeCurrentTransformIntoVertices()

  const hvac2 = MeshBuilder.CreateBox(`${name}_hv2`, { width: fp * 0.18, height: 0.14, depth: fp * 0.16 }, scene)
  hvac2.position.x = fp * 0.17
  hvac2.position.y = h + 0.07
  hvac2.bakeCurrentTransformIntoVertices()

  const spire = MeshBuilder.CreateCylinder(`${name}_sp`, {
    tessellation: 6, diameterTop: 0.01, diameterBottom: 0.05, height: 0.38,
  }, scene)
  spire.position.y = h + 0.19
  spire.bakeCurrentTransformIntoVertices()

  const canopy = MeshBuilder.CreateBox(`${name}_can`, { width: fp * 0.52, height: 0.05, depth: 0.20 }, scene)
  canopy.position.y = h * 0.17
  canopy.position.z = -(fp / 2 + 0.10)
  canopy.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([lo, up, hvac, hvac2, spire, canopy], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Restaurant: hip-roofed main body + outdoor patio platform + railing */
function buildRestaurant(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const h = 1.12, roofH = 0.40

  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp * 0.80, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  const roof = MeshBuilder.CreateCylinder(`${name}_r`, {
    tessellation: 4, diameterTop: 0, diameterBottom: fp * 0.94, height: roofH,
  }, scene)
  roof.position.y = h + roofH / 2
  roof.rotation.y = Math.PI / 4
  roof.bakeCurrentTransformIntoVertices()

  const patio = MeshBuilder.CreateBox(`${name}_pt`, { width: fp * 0.58, height: 0.05, depth: fp * 0.42 }, scene)
  patio.position.z = -(fp / 2 + fp * 0.21)
  patio.position.y = 0.025
  patio.bakeCurrentTransformIntoVertices()

  const railBack = MeshBuilder.CreateBox(`${name}_rb`, { width: fp * 0.56, height: 0.04, depth: 0.03 }, scene)
  railBack.position.z = -(fp / 2 + fp * 0.41)
  railBack.position.y = 0.27
  railBack.bakeCurrentTransformIntoVertices()

  const railL = MeshBuilder.CreateBox(`${name}_rl`, { width: 0.03, height: 0.04, depth: fp * 0.42 }, scene)
  railL.position.x = fp * 0.27
  railL.position.z = -(fp / 2 + fp * 0.21)
  railL.position.y = 0.27
  railL.bakeCurrentTransformIntoVertices()

  const railR = MeshBuilder.CreateBox(`${name}_rr`, { width: 0.03, height: 0.04, depth: fp * 0.42 }, scene)
  railR.position.x = -fp * 0.27
  railR.position.z = -(fp / 2 + fp * 0.21)
  railR.position.y = 0.27
  railR.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, roof, patio, railBack, railL, railR], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Low warehouse: flat body + loading dock + dock canopy + roof skylights */
function buildWarehouse(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const h = 0.80

  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  const dockD = fp * 0.26
  const dock = MeshBuilder.CreateBox(`${name}_dk`, { width: fp * 0.50, height: 0.20, depth: dockD }, scene)
  dock.position.z = -(fp / 2 + dockD / 2)
  dock.position.y = 0.10
  dock.bakeCurrentTransformIntoVertices()

  const dkCan = MeshBuilder.CreateBox(`${name}_dkc`, { width: fp * 0.54, height: 0.05, depth: dockD + 0.08 }, scene)
  dkCan.position.z = -(fp / 2 + (dockD + 0.08) / 2)
  dkCan.position.y = h * 0.70
  dkCan.bakeCurrentTransformIntoVertices()

  const sky1 = MeshBuilder.CreateBox(`${name}_s1`, { width: fp * 0.22, height: 0.06, depth: fp * 0.46 }, scene)
  sky1.position.x = fp * 0.15
  sky1.position.y = h + 0.03
  sky1.bakeCurrentTransformIntoVertices()

  const sky2 = MeshBuilder.CreateBox(`${name}_s2`, { width: fp * 0.22, height: 0.06, depth: fp * 0.46 }, scene)
  sky2.position.x = -fp * 0.15
  sky2.position.y = h + 0.03
  sky2.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, dock, dkCan, sky1, sky2], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Factory: main hall + office annex + tall chimney stack + rooftop sawtooth */
function buildFactory(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const mainH = 1.05, annexW = fp * 0.36

  const main = MeshBuilder.CreateBox(`${name}_m`, { width: fp, height: mainH, depth: fp }, scene)
  main.position.y = mainH / 2
  main.bakeCurrentTransformIntoVertices()

  const annex = MeshBuilder.CreateBox(`${name}_ann`, {
    width: annexW, height: mainH * 0.68, depth: fp * 0.54,
  }, scene)
  annex.position.x = -(fp / 2 + annexW / 2)
  annex.position.y = (mainH * 0.68) / 2
  annex.bakeCurrentTransformIntoVertices()

  const chH = mainH * 1.88
  const chimney = MeshBuilder.CreateCylinder(`${name}_ch`, {
    tessellation: 8, diameterTop: 0.09, diameterBottom: 0.14, height: chH,
  }, scene)
  chimney.position.x = fp * 0.27
  chimney.position.y = mainH + chH / 2
  chimney.bakeCurrentTransformIntoVertices()

  const ring = MeshBuilder.CreateCylinder(`${name}_ring`, {
    tessellation: 8, diameterTop: 0.19, diameterBottom: 0.12, height: 0.07,
  }, scene)
  ring.position.x = fp * 0.27
  ring.position.y = mainH + chH + 0.035
  ring.bakeCurrentTransformIntoVertices()

  const saw = MeshBuilder.CreateBox(`${name}_saw`, {
    width: fp * 0.36, height: 0.20, depth: fp * 0.40,
  }, scene)
  saw.position.x = -fp * 0.10
  saw.position.y = mainH + 0.10
  saw.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([main, annex, chimney, ring, saw], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

/** Depot: wide flat building + covered loading overhang + support pillars + flat roof */
function buildDepot(name: string, fp: number, mat: PBRMaterial, scene: Scene): Mesh {
  const h = 0.68

  const body = MeshBuilder.CreateBox(`${name}_b`, { width: fp, height: h, depth: fp }, scene)
  body.position.y = h / 2
  body.bakeCurrentTransformIntoVertices()

  const ovD = fp * 0.38
  const overhang = MeshBuilder.CreateBox(`${name}_ov`, { width: fp, height: 0.05, depth: ovD }, scene)
  overhang.position.z = -(fp / 2 + ovD / 2)
  overhang.position.y = h * 0.72
  overhang.bakeCurrentTransformIntoVertices()

  const pilH = h * 0.72
  const pilL = MeshBuilder.CreateBox(`${name}_plL`, { width: 0.07, height: pilH, depth: 0.07 }, scene)
  pilL.position.x = fp * 0.34
  pilL.position.y = pilH / 2
  pilL.position.z = -(fp / 2 + ovD)
  pilL.bakeCurrentTransformIntoVertices()

  const pilC = MeshBuilder.CreateBox(`${name}_plC`, { width: 0.07, height: pilH, depth: 0.07 }, scene)
  pilC.position.y = pilH / 2
  pilC.position.z = -(fp / 2 + ovD)
  pilC.bakeCurrentTransformIntoVertices()

  const pilR = MeshBuilder.CreateBox(`${name}_plR`, { width: 0.07, height: pilH, depth: 0.07 }, scene)
  pilR.position.x = -fp * 0.34
  pilR.position.y = pilH / 2
  pilR.position.z = -(fp / 2 + ovD)
  pilR.bakeCurrentTransformIntoVertices()

  const roof = MeshBuilder.CreateBox(`${name}_rf`, { width: fp + 0.08, height: 0.06, depth: fp + 0.08 }, scene)
  roof.position.y = h + 0.03
  roof.bakeCurrentTransformIntoVertices()

  const merged = Mesh.MergeMeshes([body, overhang, pilL, pilC, pilR, roof], true, true)!
  merged.name = name
  merged.material = mat
  merged.isVisible = false
  merged.receiveShadows = true
  return merged
}

// ── BuildingSystem ───────────────────────────────────────────────────────────

export class BuildingSystem {
  private templatesByZone: Map<ZoneType, Mesh[]> = new Map()
  private materials: PBRMaterial[] = []
  private textures: DynamicTexture[] = []
  private shadowGenerator: ShadowGenerator | null = null

  constructor(scene: Scene) {
    // Attach to scene's directional light for shadow casting
    const dirLight = scene.lights.find(
      (l): l is DirectionalLight => l instanceof DirectionalLight,
    )
    if (dirLight) {
      this.shadowGenerator = new ShadowGenerator(1024, dirLight)
      this.shadowGenerator.useBlurExponentialShadowMap = true
      this.shadowGenerator.blurScale = 2
    }

    // ── Materials ──────────────────────────────────────────────────────────────

    // Residential — warm brick red
    const houseMat = new PBRMaterial('mat_house', scene)
    houseMat.albedoColor = new Color3(0.72, 0.38, 0.22)
    houseMat.metallic = 0.0
    houseMat.roughness = 0.85

    // Residential — buff/beige brick
    const townMat = new PBRMaterial('mat_town', scene)
    townMat.albedoColor = new Color3(0.84, 0.74, 0.57)
    townMat.metallic = 0.0
    townMat.roughness = 0.82

    // Residential apartment A — blue-grey concrete with window grid
    const aptTexA = buildWindowTexture('tex_apt_a', 5, 7, '#7a8a9a', '#4a5f70', '#c8e4ff', scene)
    const aptMatA = new PBRMaterial('mat_apt_a', scene)
    aptMatA.albedoTexture = aptTexA
    aptMatA.metallic = 0.0
    aptMatA.roughness = 0.76

    // Commercial — warm cream shopfront
    const shopMat = new PBRMaterial('mat_shop', scene)
    shopMat.albedoColor = new Color3(0.90, 0.84, 0.68)
    shopMat.metallic = 0.0
    shopMat.roughness = 0.72

    // Commercial tower A — deep blue glass curtain wall
    const towerTexA = buildWindowTexture('tex_tower_a', 9, 6, '#3a5878', '#2a4260', '#a0c8e8', scene)
    const towerMatA = new PBRMaterial('mat_tower_a', scene)
    towerMatA.albedoTexture = towerTexA
    towerMatA.metallic = 0.42
    towerMatA.roughness = 0.20

    // Commercial tower B — teal-grey glass curtain wall
    const towerTexB = buildWindowTexture('tex_tower_b', 12, 8, '#486070', '#354858', '#88d0f0', scene)
    const towerMatB = new PBRMaterial('mat_tower_b', scene)
    towerMatB.albedoTexture = towerTexB
    towerMatB.metallic = 0.46
    towerMatB.roughness = 0.18

    // Commercial — terracotta restaurant
    const restMat = new PBRMaterial('mat_restaurant', scene)
    restMat.albedoColor = new Color3(0.76, 0.40, 0.28)
    restMat.metallic = 0.0
    restMat.roughness = 0.80

    // Industrial — mid steel grey warehouse
    const whMat = new PBRMaterial('mat_warehouse', scene)
    whMat.albedoColor = new Color3(0.62, 0.64, 0.65)
    whMat.metallic = 0.30
    whMat.roughness = 0.62

    // Industrial — dark grey factory
    const factMat = new PBRMaterial('mat_factory', scene)
    factMat.albedoColor = new Color3(0.44, 0.46, 0.48)
    factMat.metallic = 0.22
    factMat.roughness = 0.76

    // Industrial — blue-grey depot
    const depotMat = new PBRMaterial('mat_depot', scene)
    depotMat.albedoColor = new Color3(0.50, 0.56, 0.65)
    depotMat.metallic = 0.26
    depotMat.roughness = 0.68

    this.materials = [
      houseMat, townMat, aptMatA,
      shopMat, towerMatA, towerMatB, restMat,
      whMat, factMat, depotMat,
    ]
    this.textures = [aptTexA, towerTexA, towerTexB]

    // ── Templates (3 per zone) ─────────────────────────────────────────────────

    const resTmpl = [
      buildSmallHouse('res_house', 0.60, houseMat, scene),
      buildTownhouse('res_town', 0.62, townMat, scene),
      buildApartmentBlock('res_apt', 0.60, 2.20, aptMatA, scene),
    ]

    const comTmpl = [
      buildShopFront('com_shop', 0.65, shopMat, scene),
      buildOfficeTower('com_tower_a', 0.46, 3.60, towerMatA, scene),
      buildOfficeTower('com_tower_b', 0.48, 5.20, towerMatB, scene),
      buildRestaurant('com_rest', 0.66, restMat, scene),
    ]

    const indTmpl = [
      buildWarehouse('ind_wh', 0.76, whMat, scene),
      buildFactory('ind_fact', 0.74, factMat, scene),
      buildDepot('ind_depot', 0.78, depotMat, scene),
    ]

    // Register all templates as shadow casters (instances inherit automatically)
    const renderList = this.shadowGenerator?.getShadowMap()?.renderList
    if (renderList) {
      for (const t of [...resTmpl, ...comTmpl, ...indTmpl]) {
        renderList.push(t)
      }
    }

    this.templatesByZone.set(ZoneType.Residential, resTmpl)
    this.templatesByZone.set(ZoneType.Commercial, comTmpl)
    this.templatesByZone.set(ZoneType.Industrial, indTmpl)
  }

  /** Spawn a building instance at worldX/worldZ. Geometry and scale are deterministic via cell coords. */
  spawnAt(cx: number, cz: number, zone: ZoneType, worldX: number, worldZ: number): InstancedMesh {
    const seed = (cx * 31337 + cz * 7919) >>> 0
    const rng = lcg(seed)
    const templates = this.templatesByZone.get(zone)!

    const r = rng()
    let idx: number
    if (zone === ZoneType.Residential) {
      // 40% house, 35% townhouse, 25% apartment
      idx = r < 0.40 ? 0 : r < 0.75 ? 1 : 2
    } else if (zone === ZoneType.Commercial) {
      // 28% shop, 34% tower A, 26% tower B, 12% restaurant
      idx = r < 0.28 ? 0 : r < 0.62 ? 1 : r < 0.88 ? 2 : 3
    } else {
      // 40% warehouse, 35% factory, 25% depot
      idx = r < 0.40 ? 0 : r < 0.75 ? 1 : 2
    }

    const scaleFactor = lerp(0.88, 1.12, rng())
    const inst = templates[idx].createInstance(`bld_${cx}_${cz}`)
    inst.position = new Vector3(worldX, 0, worldZ)
    inst.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor)
    inst.receiveShadows = true
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
    this.shadowGenerator?.dispose()
    this.shadowGenerator = null
  }
}
