import { DEFAULT_DEFAMATION_QUOTA_PERCENT, STAR_VALUES, areWeightsValid } from './settings'
import type { EstimateResult, HistogramBin, PlaceReviewData, StarBreakdown, StarValue, StarWeights } from './types'

export const DEFAULT_SIMULATION_COUNT = 10_000
export const DEFAULT_HISTOGRAM_BINS = 18

type EstimateOptions = {
  simulationCount?: number
  histogramBins?: number
  random?: () => number
  defamationQuotaPercent?: number
  noRemovedReviewsLabel?: string
}

const quantile = (sortedValues: number[], percentile: number): number => {
  if (sortedValues.length === 0) {
    return 0
  }

  const index = (sortedValues.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower

  if (upper >= sortedValues.length) {
    return sortedValues[lower]
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

const drawRemovedCount = (min: number, max: number, random: () => number): number => {
  if (min === max) {
    return min
  }

  return min + Math.floor(random() * (max - min + 1))
}

const drawStar = (weights: StarWeights, random: () => number): StarValue => {
  const ticket = random() * 100
  let accumulated = 0

  for (const star of STAR_VALUES) {
    accumulated += weights[star]
    if (ticket < accumulated) {
      return star
    }
  }

  return 5
}

const buildHistogram = (values: number[], binCount: number): HistogramBin[] => {
  const min = Math.min(...values)
  const max = Math.max(...values)

  if (min === max) {
    return [{ min, max, count: values.length }]
  }

  const width = (max - min) / binCount
  const bins = Array.from({ length: binCount }, (_, index) => ({
    min: min + index * width,
    max: index === binCount - 1 ? max : min + (index + 1) * width,
    count: 0,
  }))

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / width), binCount - 1)
    bins[index].count += 1
  }

  return bins
}

const emptyBreakdown = (): StarBreakdown => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
})

export type NoRemovedReviewsPlaceData = Pick<PlaceReviewData, 'rating' | 'displayedRating' | 'reviewCount'> & {
  starBreakdown?: StarBreakdown
}

/** Kurzinfo für Badge, Popup und gespeicherte Range-Beschreibung */
export const NO_REMOVED_REVIEWS_MESSAGE = 'Dieses Geschäft hat in den letzten 365 Tagen keine Bewertungen entfernen lassen.'

/** Keine Monte-Carlo-Simulation: Median und Konfidenzintervall entsprechen der Google-Rechnungsgrundlage (ungerundetes Rating). */
export const buildNoRemovedReviewsEstimate = (
  data: NoRemovedReviewsPlaceData,
  weights: StarWeights,
  options: Pick<EstimateOptions, 'defamationQuotaPercent' | 'noRemovedReviewsLabel'> = {},
): EstimateResult => {
  if (!areWeightsValid(weights)) {
    throw new Error('Die Gewichtung muss in Summe 100% ergeben.')
  }

  const defamationQuotaPercent = options.defamationQuotaPercent ?? DEFAULT_DEFAMATION_QUOTA_PERCENT
  const removedRange = { min: 0, max: 0, label: options.noRemovedReviewsLabel ?? NO_REMOVED_REVIEWS_MESSAGE }

  return {
    noRemovedReviews: true,
    originalRating: data.rating,
    displayedRating: data.displayedRating,
    reviewCount: data.reviewCount,
    removedRange,
    adjustedRemovedRange: { ...removedRange },
    assumedTrueDefamationCount: 0,
    defamationQuotaPercent,
    weights,
    googleStarBreakdown: data.starBreakdown,
    estimatedAddedStarBreakdown: emptyBreakdown(),
    averageAddedReviewCount: 0,
    median: data.rating,
    intervalLow: data.rating,
    intervalHigh: data.rating,
    histogram: [],
    simulationCount: 0,
    smallSampleWarning: data.reviewCount < 20,
    openEndedRangeNote: false,
  }
}

export const calculateEstimate = (
  data: PlaceReviewData,
  weights: StarWeights,
  options: EstimateOptions = {},
): EstimateResult => {
  if (!areWeightsValid(weights)) {
    throw new Error('Die Gewichtung muss in Summe 100% ergeben.')
  }

  const simulationCount = options.simulationCount ?? DEFAULT_SIMULATION_COUNT
  const histogramBins = options.histogramBins ?? DEFAULT_HISTOGRAM_BINS
  const random = options.random ?? Math.random
  const defamationQuotaPercent = options.defamationQuotaPercent ?? DEFAULT_DEFAMATION_QUOTA_PERCENT
  const assumedTrueDefamationCount = Math.round(data.reviewCount * (defamationQuotaPercent / 100))
  const adjustedRemovedRange = {
    ...data.removedRange,
    min: Math.max(0, data.removedRange.min - assumedTrueDefamationCount),
    max: Math.max(0, data.removedRange.max - assumedTrueDefamationCount),
  }
  const currentStars = data.rating * data.reviewCount
  const values: number[] = []
  const estimatedAddedStarBreakdown = emptyBreakdown()
  let addedReviewCountTotal = 0

  for (let simulationIndex = 0; simulationIndex < simulationCount; simulationIndex += 1) {
    const removedCount = drawRemovedCount(adjustedRemovedRange.min, adjustedRemovedRange.max, random)
    let removedStars = 0
    addedReviewCountTotal += removedCount

    for (let reviewIndex = 0; reviewIndex < removedCount; reviewIndex += 1) {
      const star = drawStar(weights, random)
      removedStars += star
      estimatedAddedStarBreakdown[star] += 1 / simulationCount
    }

    values.push((currentStars + removedStars) / (data.reviewCount + removedCount))
  }

  const sorted = values.toSorted((a, b) => a - b)

  return {
    originalRating: data.rating,
    displayedRating: data.displayedRating,
    reviewCount: data.reviewCount,
    removedRange: data.removedRange,
    adjustedRemovedRange,
    assumedTrueDefamationCount,
    defamationQuotaPercent,
    weights,
    googleStarBreakdown: data.starBreakdown,
    estimatedAddedStarBreakdown,
    averageAddedReviewCount: addedReviewCountTotal / simulationCount,
    median: quantile(sorted, 0.5),
    intervalLow: quantile(sorted, 0.05),
    intervalHigh: quantile(sorted, 0.95),
    histogram: buildHistogram(values, histogramBins),
    simulationCount,
    smallSampleWarning: data.reviewCount < 20,
    openEndedRangeNote: Boolean(data.removedRange.isOpenEnded),
  }
}
