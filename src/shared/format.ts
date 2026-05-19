import { averageStars } from './settings'
import { localeToIntl, type Locale } from './i18n'
import type { EstimateResult, StarWeights } from './types'

export const formatRating = (value: number, locale: Locale = 'de'): string =>
  new Intl.NumberFormat(localeToIntl(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

export const formatOriginalRating = (value: number, locale: Locale = 'de'): string =>
  new Intl.NumberFormat(localeToIntl(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)

export const formatWeights = (weights: StarWeights): string =>
  `${weights[5]}%/${weights[4]}%/${weights[3]}%/${weights[2]}%/${weights[1]}%`

export const formatAverageStars = (weights: StarWeights, locale: Locale = 'de'): string =>
  formatOriginalRating(averageStars(weights), locale)

export const estimateSummary = (result: EstimateResult): string =>
  `ECHTSTERN-Schätzung: ${formatRating(result.median)} ★ (90% KI: ${formatRating(result.intervalLow)} - ${formatRating(result.intervalHigh)})`
