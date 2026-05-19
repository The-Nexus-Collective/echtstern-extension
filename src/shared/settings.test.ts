import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARE_ANONYMOUS_STATS,
  DEFAULT_WARNING_THRESHOLDS,
  adjustWarningThresholds,
  enforceOrderedWarningThresholds,
  normalizeShareAnonymousStats,
  normalizeWarningThresholds,
} from './settings'

describe('enforceOrderedWarningThresholds', () => {
  it('lässt gültige Defaults unverändert', () => {
    expect(enforceOrderedWarningThresholds(DEFAULT_WARNING_THRESHOLDS)).toEqual(DEFAULT_WARNING_THRESHOLDS)
  })

  it('sortiert Grenzen bei Konflikt und erzwingt Abstände', () => {
    const t = enforceOrderedWarningThresholds({
      yellowGreenBoundary: 0.2,
      yellowQuestionAbove: 0.15,
      redExclamationAbove: 0.3,
    })
    expect(t.yellowGreenBoundary).toBe(0.2)
    expect(t.yellowQuestionAbove).toBeGreaterThan(t.yellowGreenBoundary)
    expect(t.redExclamationAbove).toBeGreaterThan(t.yellowQuestionAbove)
    expect(t.redExclamationAbove).toBeLessThanOrEqual(1)
  })
})

describe('normalizeWarningThresholds', () => {
  it('übernimmt gelbeGrün-Grenze aus Legacy yellowCheckFrom und greenCheckBelow (Minimum)', () => {
    const t = normalizeWarningThresholds({
      yellowCheckFrom: 0.08,
      greenCheckBelow: 0.06,
      yellowQuestionAbove: 0.2,
      redExclamationAbove: 0.35,
    })
    expect(t.yellowGreenBoundary).toBe(0.06)
    expect(t.yellowQuestionAbove).toBeGreaterThan(t.yellowGreenBoundary)
    expect(t.redExclamationAbove).toBeGreaterThan(t.yellowQuestionAbove)
  })
})

describe('adjustWarningThresholds', () => {
  it('passt nach einer Änderung alle höheren Schwellen bei Bedarf an', () => {
    let t = DEFAULT_WARNING_THRESHOLDS
    t = adjustWarningThresholds(t, 'yellowGreenBoundary', 0.12)
    expect(t.yellowGreenBoundary).toBe(0.12)
    expect(t.yellowQuestionAbove).toBeGreaterThan(0.12)
    expect(t.redExclamationAbove).toBeGreaterThan(t.yellowQuestionAbove)
  })
})

describe('normalizeShareAnonymousStats', () => {
  it('aktiviert anonyme Statistik standardmäßig', () => {
    expect(normalizeShareAnonymousStats(undefined)).toBe(DEFAULT_SHARE_ANONYMOUS_STATS)
    expect(DEFAULT_SHARE_ANONYMOUS_STATS).toBe(true)
  })

  it('respektiert expliziten Opt-out', () => {
    expect(normalizeShareAnonymousStats(false)).toBe(false)
  })
})
