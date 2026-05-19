import { STAR_VALUES } from './settings'
import type { PlaceReviewData, RemovedReviewRange, StarBreakdown, StarValue } from './types'

const WORD_NUMBERS: Record<string, number> = {
  eine: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

const OPEN_ENDED_MAX = 300

type RemovedReviewRangeParseOptions = {
  requireReason?: boolean
}

export const parseRating = (text: string | null | undefined): number | null => {
  if (!text) {
    return null
  }

  const match = text.replace(/\u00a0/g, ' ').match(/(\d+[,.]\d+|\d+)/)
  if (!match) {
    return null
  }

  const rating = Number.parseFloat(match[1].replace(',', '.'))
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null
}

export const parseReviewCount = (text: string | null | undefined): number | null => {
  if (!text) {
    return null
  }

  const normalized = text.replace(/\u00a0/g, ' ')
  const match = normalized.match(/([\d.,\s]+)\s*(bewertungen|rezensionen|berichte|reviews?)/i)
  if (!match) {
    return null
  }

  const count = Number.parseInt(match[1].replace(/[^\d]/g, ''), 10)
  return Number.isFinite(count) && count >= 0 ? count : null
}

const wordOrNumber = (value: string): number | null => {
  const lower = value.toLowerCase()
  if (WORD_NUMBERS[lower]) {
    return WORD_NUMBERS[lower]
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseRemovedReviewRange = (
  text: string | null | undefined,
  options: RemovedReviewRangeParseOptions = {},
): RemovedReviewRange | null => {
  if (!text) {
    return null
  }

  const requireReason = options.requireReason ?? true
  const normalized = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  const lower = normalized.toLowerCase()

  if (requireReason && !/(diffamierung|defamation)/i.test(normalized)) {
    return null
  }

  const overMatch = lower.match(/(?:^|[\s([{])(over|more than|mehr als|über)\s+(\d+)|(?:^|[\s([{])(\d+)\s*\+/)
  if (overMatch) {
    const threshold = Number.parseInt(overMatch[2] ?? overMatch[3], 10)
    const min = threshold + 1
    return {
      min,
      max: OPEN_ENDED_MAX,
      label: normalized,
      isOpenEnded: true,
    }
  }

  const singleMatch = lower.match(/\b(one|eine|ein|1)\s+(review|bewertung|rezension)/)
  if (singleMatch) {
    return { min: 1, max: 1, label: normalized }
  }

  const wordRangeMatch = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eine|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|\d+)\s+(?:to|bis)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eine|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|\d+)/)
  if (wordRangeMatch) {
    const min = wordOrNumber(wordRangeMatch[1])
    const max = wordOrNumber(wordRangeMatch[2])
    if (min !== null && max !== null) {
      return { min, max, label: normalized }
    }
  }

  const numericRangeMatch = lower.match(/(\d+)\s*(?:bis|to|-|–)\s*(\d+)/)
  if (numericRangeMatch) {
    return {
      min: Number.parseInt(numericRangeMatch[1], 10),
      max: Number.parseInt(numericRangeMatch[2], 10),
      label: normalized,
    }
  }

  const numericSingleMatch = lower.match(/\b(\d+)\s+(?:bewertungen|rezensionen|reviews?)\b/)
  if (numericSingleMatch) {
    const value = Number.parseInt(numericSingleMatch[1], 10)
    return { min: value, max: value, label: normalized }
  }

  return null
}

export const parseRemovedReviewRangeFromTrustedText = (text: string | null | undefined): RemovedReviewRange | null =>
  parseRemovedReviewRange(text, { requireReason: false })

export const emptyStarBreakdown = (): StarBreakdown => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
})

export const parseStarBreakdownLabel = (text: string | null | undefined): { star: StarValue; count: number } | null => {
  if (!text) {
    return null
  }

  const normalized = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  const match = normalized.match(/\b([1-5])\s*(?:stern(?:e)?|stars?)\s*,\s*([\d.,\s]+)\s*(?:bewertungen?|rezension(?:en)?|reviews?)\b/i)
  if (!match) {
    return null
  }

  const star = Number.parseInt(match[1], 10) as StarValue
  const count = Number.parseInt(match[2].replace(/[^\d]/g, ''), 10)

  return Number.isFinite(count) ? { star, count } : null
}

export const starBreakdownTotal = (breakdown: StarBreakdown): number =>
  STAR_VALUES.reduce((total, star) => total + breakdown[star], 0)

export const ratingFromStarBreakdown = (breakdown: StarBreakdown): number | null => {
  const total = starBreakdownTotal(breakdown)
  if (total === 0) {
    return null
  }

  return STAR_VALUES.reduce((sum, star) => sum + star * breakdown[star], 0) / total
}

export const parsePlaceReviewData = (
  ratingText: string | null | undefined,
  reviewCountText: string | null | undefined,
  removedRangeText: string | null | undefined,
): PlaceReviewData | null => {
  const rating = parseRating(ratingText)
  const reviewCount = parseReviewCount(reviewCountText)
  const removedRange = parseRemovedReviewRange(removedRangeText)

  if (rating === null || reviewCount === null || removedRange === null) {
    return null
  }

  return { rating, displayedRating: rating, reviewCount, removedRange }
}
