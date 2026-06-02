export type StarValue = 1 | 2 | 3 | 4 | 5

export type InlineDisplayMode = 'button' | 'card'

export type StarWeights = Record<StarValue, number>

export type StarBreakdown = Record<StarValue, number>

/** Sternendifferenz Google-Anzeige − Schätzung (Median). Reihenfolge: boundary < gelbes ? < rotes ! */
export type WarningThresholds = {
  /** Unterhalb: grüner ✓; ab diesem Wert (einschließlich) bis gelbes ?: gelber ✓ */
  yellowGreenBoundary: number
  yellowQuestionAbove: number
  redExclamationAbove: number
}

export type RemovedReviewRange = {
  min: number
  max: number
  label: string
  isOpenEnded?: boolean
}

export type PlaceReviewData = {
  rating: number
  displayedRating: number
  reviewCount: number
  removedRange: RemovedReviewRange
  starBreakdown?: StarBreakdown
}

export type HistogramBin = {
  min: number
  max: number
  count: number
}

export type EstimateResult = {
  /** Keine gemeldeten entfernten Bewertungen: Schätzung = Google, keine Simulation */
  noRemovedReviews?: boolean
  originalRating: number
  displayedRating: number
  reviewCount: number
  removedRange: RemovedReviewRange
  adjustedRemovedRange: RemovedReviewRange
  assumedTrueDefamationCount: number
  defamationQuotaPercent: number
  weights: StarWeights
  googleStarBreakdown?: StarBreakdown
  estimatedAddedStarBreakdown: StarBreakdown
  averageAddedReviewCount: number
  median: number
  intervalLow: number
  intervalHigh: number
  histogram: HistogramBin[]
  simulationCount: number
  smallSampleWarning: boolean
  openEndedRangeNote: boolean
}

export type StoredLatestEstimate = {
  placeName?: string
  sourceUrl: string
  calculatedAt: string
  result: EstimateResult
}

export type StoredLatestContext = {
  placeName?: string
  sourceUrl: string
  calculatedAt: string
  status: 'outsideGermany'
}
