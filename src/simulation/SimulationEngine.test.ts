import { describe, it, expect, vi } from 'vitest'
import { SimulationEngine } from './SimulationEngine'
import type { SimTimeState, SimSpeed } from './SimulationEngine'

function makeEngine(): SimulationEngine {
  return new SimulationEngine()
}

describe('SimulationEngine', () => {
  describe('initial state', () => {
    it('starts unpaused at 1× speed on day 1 hour 6', () => {
      const sim = makeEngine()
      expect(sim.isPaused).toBe(false)
      expect(sim.speed).toBe(1)
      expect(sim.gameDay).toBe(1)
      expect(sim.gameHour).toBe(6)
    })
  })

  describe('pause / resume', () => {
    it('pause() stops tick dispatch', () => {
      const sim = makeEngine()
      const fn = vi.fn()
      sim.onTick(fn)
      sim.pause()
      sim.tick(1.0)
      expect(fn).not.toHaveBeenCalled()
    })

    it('resume() restarts tick dispatch', () => {
      const sim = makeEngine()
      const fn = vi.fn()
      sim.onTick(fn)
      sim.pause()
      sim.resume()
      sim.tick(1.0)
      expect(fn).toHaveBeenCalledOnce()
    })

    it('togglePause() alternates state', () => {
      const sim = makeEngine()
      expect(sim.isPaused).toBe(false)
      sim.togglePause()
      expect(sim.isPaused).toBe(true)
      sim.togglePause()
      expect(sim.isPaused).toBe(false)
    })

    it('pause() when already paused is a no-op', () => {
      const sim = makeEngine()
      const fn = vi.fn()
      sim.onStateChange(fn)
      sim.pause()
      sim.pause()
      expect(fn).toHaveBeenCalledOnce()
    })

    it('resume() when already running is a no-op', () => {
      const sim = makeEngine()
      const fn = vi.fn()
      sim.onStateChange(fn)
      sim.resume()
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('speed control', () => {
    it('1× passes realDelta unchanged to tick subscribers', () => {
      const sim = makeEngine()
      let received = 0
      sim.onTick(d => { received = d })
      sim.tick(0.05)
      expect(received).toBeCloseTo(0.05, 6)
    })

    it('2× doubles the scaled delta', () => {
      const sim = makeEngine()
      let received = 0
      sim.onTick(d => { received = d })
      sim.setSpeed(2)
      sim.tick(0.05)
      expect(received).toBeCloseTo(0.1, 6)
    })

    it('4× quadruples the scaled delta', () => {
      const sim = makeEngine()
      let received = 0
      sim.onTick(d => { received = d })
      sim.setSpeed(4)
      sim.tick(0.05)
      expect(received).toBeCloseTo(0.2, 6)
    })

    it('setSpeed() resumes a paused simulation', () => {
      const sim = makeEngine()
      const fn = vi.fn()
      sim.onTick(fn)
      sim.pause()
      sim.setSpeed(2)
      expect(sim.isPaused).toBe(false)
      sim.tick(0.05)
      expect(fn).toHaveBeenCalledOnce()
    })
  })

  describe('game time advancement', () => {
    it('advances one hour after 1 scaled second at 1×', () => {
      const sim = makeEngine()
      sim.tick(1.0)
      expect(sim.gameHour).toBe(7) // started at 6
    })

    it('advances by speed multiple hours per real second at 2×', () => {
      const sim = makeEngine()
      sim.setSpeed(2)
      sim.tick(1.0) // 2 scaled seconds → 2 hours
      expect(sim.gameHour).toBe(8) // 6 + 2
    })

    it('advances by 4 hours per real second at 4×', () => {
      const sim = makeEngine()
      sim.setSpeed(4)
      sim.tick(1.0) // 4 scaled seconds → 4 hours
      expect(sim.gameHour).toBe(10) // 6 + 4
    })

    it('rolls hour over 23 → 0 and increments day', () => {
      const sim = makeEngine()
      // Tick 18 hours to reach hour 23 (started at 6, need 17 hours)
      sim.tick(17.0) // 17 hours → hour 23
      expect(sim.gameHour).toBe(23)
      sim.tick(1.0)  // one more → day rollover
      expect(sim.gameHour).toBe(0)
      expect(sim.gameDay).toBe(2)
    })

    it('does not advance time while paused', () => {
      const sim = makeEngine()
      sim.pause()
      sim.tick(10.0)
      expect(sim.gameHour).toBe(6)
      expect(sim.gameDay).toBe(1)
    })
  })

  describe('onHour callback', () => {
    it('fires once when exactly one hour elapses', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onHour(cb)
      sim.tick(1.0)
      expect(cb).toHaveBeenCalledOnce()
    })

    it('fires multiple times when multiple hours elapse in one tick', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onHour(cb)
      sim.tick(3.0)
      expect(cb).toHaveBeenCalledTimes(3)
    })

    it('does not fire before a full hour accumulates', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onHour(cb)
      sim.tick(0.5)
      sim.tick(0.4)
      expect(cb).not.toHaveBeenCalled()
      sim.tick(0.1) // total = 1.0 → fires
      expect(cb).toHaveBeenCalledOnce()
    })

    it('callback receives current state with updated hour', () => {
      const sim = makeEngine()
      const states: SimTimeState[] = []
      sim.onHour(s => states.push(s))
      sim.tick(2.0)
      expect(states).toHaveLength(2)
      expect(states[0].gameHour).toBe(7)
      expect(states[1].gameHour).toBe(8)
    })

    it('does not fire while paused', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onHour(cb)
      sim.pause()
      sim.tick(5.0)
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('onStateChange callback', () => {
    it('fires when pause() is called', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onStateChange(cb)
      sim.pause()
      expect(cb).toHaveBeenCalledOnce()
      const s = cb.mock.calls[0][0] as SimTimeState
      expect(s.isPaused).toBe(true)
    })

    it('fires when resume() is called', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.pause()
      sim.onStateChange(cb)
      sim.resume()
      expect(cb).toHaveBeenCalledOnce()
      expect((cb.mock.calls[0][0] as SimTimeState).isPaused).toBe(false)
    })

    it('fires when setSpeed() is called', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onStateChange(cb)
      sim.setSpeed(4)
      expect(cb).toHaveBeenCalledOnce()
      expect((cb.mock.calls[0][0] as SimTimeState).speed).toBe(4 as SimSpeed)
    })
  })

  describe('zero and negative delta', () => {
    it('tick(0) is a no-op', () => {
      const sim = makeEngine()
      const cb = vi.fn()
      sim.onTick(cb)
      sim.tick(0)
      expect(cb).not.toHaveBeenCalled()
    })
  })
})
