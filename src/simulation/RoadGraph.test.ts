import { describe, it, expect } from 'vitest'
import { GridMap, CellType } from './GridMap'
import { RoadGraph } from './RoadGraph'

function makeGraph(roads: [number, number][]): { graph: RoadGraph; gridMap: GridMap } {
  const gridMap = new GridMap()
  const graph = new RoadGraph(gridMap)
  for (const [x, z] of roads) gridMap.set(x, z, CellType.ROAD)
  return { graph, gridMap }
}

describe('RoadGraph.findPath', () => {
  it('returns single-node path when start equals end', () => {
    const { graph } = makeGraph([[5, 5]])
    const path = graph.findPath(5, 5, 5, 5)
    expect(path).toEqual([{ x: 5, z: 5 }])
  })

  it('returns null when start is not a road', () => {
    const { graph } = makeGraph([[5, 5]])
    expect(graph.findPath(0, 0, 5, 5)).toBeNull()
  })

  it('returns null when end is not a road', () => {
    const { graph } = makeGraph([[5, 5]])
    expect(graph.findPath(5, 5, 0, 0)).toBeNull()
  })

  it('returns null for disconnected graph', () => {
    const { graph } = makeGraph([
      [0, 0],
      [5, 5], // not connected to (0,0)
    ])
    expect(graph.findPath(0, 0, 5, 5)).toBeNull()
  })

  it('finds straight horizontal path', () => {
    // road along z=0, x=0..4
    const { graph } = makeGraph([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])
    const path = graph.findPath(0, 0, 4, 0)
    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 0, z: 0 })
    expect(path![path!.length - 1]).toEqual({ x: 4, z: 0 })
    expect(path!.length).toBe(5)
  })

  it('finds shortest path around obstacle', () => {
    // L-shaped road: (0,0)→(2,0) then (2,0)→(2,2)
    const roads: [number, number][] = [
      [0, 0], [1, 0], [2, 0],
      [2, 1], [2, 2],
    ]
    const { graph } = makeGraph(roads)
    const path = graph.findPath(0, 0, 2, 2)
    expect(path).not.toBeNull()
    expect(path!.length).toBe(5)
    expect(path![0]).toEqual({ x: 0, z: 0 })
    expect(path![path!.length - 1]).toEqual({ x: 2, z: 2 })
  })

  it('is optimal — picks shorter of two routes', () => {
    // Two routes from (0,0) to (4,0):
    //   Short: straight x=0..4, z=0  (length 5)
    //   Long:  go z=1 detour         (length 7)
    const roads: [number, number][] = [
      // straight
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
      // detour via z=1
      [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
      // connections
      [0, 0], // already added
      [4, 0], // already added
    ]
    const { graph } = makeGraph(roads)
    const path = graph.findPath(0, 0, 4, 0)
    expect(path).not.toBeNull()
    expect(path!.length).toBe(5) // optimal = 5 steps
  })

  it('handles 10×10 fully-connected grid in < 10ms', () => {
    const roads: [number, number][] = []
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        roads.push([x, z])
      }
    }
    const { graph } = makeGraph(roads)

    const t0 = performance.now()
    const path = graph.findPath(0, 0, 9, 9)
    const elapsed = performance.now() - t0

    expect(path).not.toBeNull()
    expect(path!.length).toBe(19) // Manhattan: 9+9+1=19
    expect(elapsed).toBeLessThan(10)
  })

  it('path only visits road cells', () => {
    const roads: [number, number][] = [
      [0, 0], [1, 0], [2, 0], [2, 1], [2, 2],
    ]
    const { graph } = makeGraph(roads)
    const path = graph.findPath(0, 0, 2, 2)
    expect(path).not.toBeNull()
    for (const { x, z } of path!) {
      const found = roads.some(([rx, rz]) => rx === x && rz === z)
      expect(found).toBe(true)
    }
  })
})

describe('RoadGraph.addRoad / removeRoad', () => {
  it('addRoad enables previously unreachable path', () => {
    const { graph } = makeGraph([[0, 0], [2, 0]])
    expect(graph.findPath(0, 0, 2, 0)).toBeNull()
    graph.addRoad(1, 0)
    const path = graph.findPath(0, 0, 2, 0)
    expect(path).not.toBeNull()
    expect(path!.length).toBe(3)
  })

  it('removeRoad breaks a path', () => {
    const { graph } = makeGraph([[0, 0], [1, 0], [2, 0]])
    expect(graph.findPath(0, 0, 2, 0)).not.toBeNull()
    graph.removeRoad(1, 0)
    expect(graph.findPath(0, 0, 2, 0)).toBeNull()
  })
})
