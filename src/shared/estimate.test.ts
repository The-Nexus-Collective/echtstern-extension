import { describe, expect, it } from 'vitest'
import { NO_REMOVED_REVIEWS_MESSAGE, buildNoRemovedReviewsEstimate, calculateEstimate } from './estimate'
import { DEFAULT_WEIGHTS, areWeightsValid, averageStars, normalizeWeights, weightsTotal } from './settings'
import type { PlaceReviewData } from './types'

const data: PlaceReviewData = {
  rating: 4.4,
  displayedRating: 4.4,
  reviewCount: 210,
  removedRange: {
    min: 21,
    max: 50,
    label: '21 bis 50 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.',
  },
}

const seededRandom = () => {
  let seed = 42
  return () => {
    seed = (seed * 16_807) % 2_147_483_647
    return (seed - 1) / 2_147_483_646
  }
}

describe('settings', () => {
  it('validates the default weighting', () => {
    expect(weightsTotal(DEFAULT_WEIGHTS)).toBe(100)
    expect(areWeightsValid(DEFAULT_WEIGHTS)).toBe(true)
    expect(averageStars(DEFAULT_WEIGHTS)).toBeCloseTo(1.4)
  })

  it('normalizes partial weights', () => {
    expect(normalizeWeights({ 1: 60 })).toEqual({ 1: 60, 2: 20, 3: 10, 4: 0, 5: 0 })
  })
})

describe('buildNoRemovedReviewsEstimate', () => {
  it('übernimmt das Google-Rating ohne Simulation', () => {
    const result = buildNoRemovedReviewsEstimate(
      {
        rating: 4.6,
        displayedRating: 4.6,
        reviewCount: 100,
      },
      DEFAULT_WEIGHTS,
    )

    expect(result.noRemovedReviews).toBe(true)
    expect(result.median).toBe(4.6)
    expect(result.intervalLow).toBe(4.6)
    expect(result.intervalHigh).toBe(4.6)
    expect(result.histogram).toHaveLength(0)
    expect(result.simulationCount).toBe(0)
    expect(result.removedRange.label).toBe(NO_REMOVED_REVIEWS_MESSAGE)
    expect(result.estimatedAddedStarBreakdown).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  })
})

describe('calculateEstimate', () => {
  it('returns median, interval, and histogram', () => {
    const result = calculateEstimate(data, DEFAULT_WEIGHTS, {
      simulationCount: 250,
      histogramBins: 8,
      random: seededRandom(),
      defamationQuotaPercent: 0,
    })

    expect(result.median).toBeGreaterThan(3.7)
    expect(result.median).toBeLessThan(4.2)
    expect(result.intervalLow).toBeLessThanOrEqual(result.median)
    expect(result.intervalHigh).toBeGreaterThanOrEqual(result.median)
    expect(result.histogram).toHaveLength(8)
    expect(result.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(250)
  })

  it('marks small visible review counts as uncertain', () => {
    const result = calculateEstimate({ ...data, reviewCount: 12 }, DEFAULT_WEIGHTS, {
      simulationCount: 10,
      random: seededRandom(),
    })

    expect(result.smallSampleWarning).toBe(true)
  })

  it('subtracts assumed true defamations from the removed range before simulation', () => {
    const result = calculateEstimate(
      {
        ...data,
        reviewCount: 1000,
      },
      DEFAULT_WEIGHTS,
      {
        simulationCount: 10,
        random: seededRandom(),
        defamationQuotaPercent: 2,
      },
    )

    expect(result.assumedTrueDefamationCount).toBe(20)
    expect(result.adjustedRemovedRange).toMatchObject({ min: 1, max: 30 })
  })

  it('uses a zero adjusted range when assumed true defamations exceed the displayed range', () => {
    const result = calculateEstimate(
      {
        rating: 4.4,
        displayedRating: 4.4,
        reviewCount: 1000,
        removedRange: {
          min: 6,
          max: 10,
          label: '6 bis 10 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.',
        },
      },
      DEFAULT_WEIGHTS,
      {
        simulationCount: 10,
        random: seededRandom(),
        defamationQuotaPercent: 2,
      },
    )

    expect(result.adjustedRemovedRange).toMatchObject({ min: 0, max: 0 })
    expect(result.median).toBe(4.4)
  })

  it('uses the unrounded rating as the calculation basis while preserving the displayed rating', () => {
    const result = calculateEstimate(
      {
        ...data,
        rating: 4.76,
        displayedRating: 4.8,
      },
      DEFAULT_WEIGHTS,
      {
        simulationCount: 10,
        random: seededRandom(),
        defamationQuotaPercent: 100,
      },
    )

    expect(result.originalRating).toBe(4.76)
    expect(result.displayedRating).toBe(4.8)
    expect(result.median).toBe(4.76)
  })
})
