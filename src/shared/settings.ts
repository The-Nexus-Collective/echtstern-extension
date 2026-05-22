import { DEFAULT_LOCALE_SETTING, normalizeLocaleSetting, type LocaleSetting } from './i18n'
import { browser, hasBrowserSyncStorage } from './browserApi'
import type { InlineDisplayMode, StarValue, StarWeights, WarningThresholds } from './types'

export const DEFAULT_WEIGHTS: StarWeights = {
  1: 70,
  2: 20,
  3: 10,
  4: 0,
  5: 0,
}

export const DEFAULT_DEFAMATION_QUOTA_PERCENT = 2

export const WARNING_THRESHOLD_STEP = 0.01

export const DEFAULT_WARNING_THRESHOLDS: WarningThresholds = {
  yellowGreenBoundary: 0.05,
  yellowQuestionAbove: 0.15,
  redExclamationAbove: 0.3,
}

export const DEFAULT_INLINE_DISPLAY_MODE: InlineDisplayMode = 'card'
export const DEFAULT_SHARE_ANONYMOUS_STATS = true

export const normalizeInlineDisplayMode = (value: unknown): InlineDisplayMode =>
  value === 'button' || value === 'card' ? value : DEFAULT_INLINE_DISPLAY_MODE

export const normalizeShareAnonymousStats = (value: unknown): boolean =>
  typeof value === 'boolean' ? value : DEFAULT_SHARE_ANONYMOUS_STATS

/** Legacy gespeicherte Keys (vor Kopplung Grün/Gelb ✓) */
type LegacyWarningThresholds = {
  yellowCheckFrom?: number
  greenCheckBelow?: number
}

export const SETTINGS_STORAGE_KEY = 'echtstern:settings'
export const LATEST_ESTIMATE_STORAGE_KEY = 'echtstern:latestEstimate'

export type ECHTSTERNSettings = {
  weights: StarWeights
  defamationQuotaPercent: number
  warningThresholds: WarningThresholds
  locale: LocaleSetting
  inlineDisplay: InlineDisplayMode
  shareAnonymousStats: boolean
}

export const STAR_VALUES: StarValue[] = [1, 2, 3, 4, 5]

const hasChromeStorage = hasBrowserSyncStorage

export const normalizeWeights = (weights: Partial<StarWeights> | undefined): StarWeights => {
  const normalized = { ...DEFAULT_WEIGHTS, ...weights }
  return STAR_VALUES.reduce((result, star) => {
    const value = Number(normalized[star])
    result[star] = Number.isFinite(value) ? Math.max(0, Math.round(value)) : DEFAULT_WEIGHTS[star]
    return result
  }, {} as StarWeights)
}

export const normalizeDefamationQuotaPercent = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : DEFAULT_DEFAMATION_QUOTA_PERCENT
}

const normalizeWarnStarDiff = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback
}

const roundWarn = (value: number): number => Math.round(value * 100) / 100

/** Erzwingt gelbeGrün-Grenze < gelbes ? < rotes ! mit je mindestens einem Schritt Abstand (0–1 Sterne). */
export const enforceOrderedWarningThresholds = (input: WarningThresholds): WarningThresholds => {
  const step = WARNING_THRESHOLD_STEP
  const max = 1

  let g = normalizeWarnStarDiff(input.yellowGreenBoundary, DEFAULT_WARNING_THRESHOLDS.yellowGreenBoundary)
  let q = normalizeWarnStarDiff(input.yellowQuestionAbove, DEFAULT_WARNING_THRESHOLDS.yellowQuestionAbove)
  let r = normalizeWarnStarDiff(input.redExclamationAbove, DEFAULT_WARNING_THRESHOLDS.redExclamationAbove)

  q = Math.max(q, roundWarn(g + step))
  r = Math.max(r, roundWarn(q + step))

  if (r > max) {
    r = max
    q = Math.min(q, roundWarn(r - step))
    g = Math.min(g, roundWarn(q - step))
  }

  g = Math.max(0, g)
  q = Math.max(q, roundWarn(g + step))
  r = Math.max(r, roundWarn(q + step))

  if (r > max) {
    r = max
    q = Math.min(q, roundWarn(r - step))
    g = Math.min(g, roundWarn(q - step))
    g = Math.max(0, g)
    q = Math.max(q, roundWarn(g + step))
    r = Math.max(r, roundWarn(q + step))
    if (r > max) r = max
  }

  return {
    yellowGreenBoundary: roundWarn(g),
    yellowQuestionAbove: roundWarn(q),
    redExclamationAbove: roundWarn(r),
  }
}

export const adjustWarningThresholds = (
  current: WarningThresholds,
  key: keyof WarningThresholds,
  rawValue: number,
): WarningThresholds =>
  enforceOrderedWarningThresholds({
    ...current,
    [key]: normalizeWarnStarDiff(rawValue, current[key]),
  })

export const normalizeWarningThresholds = (
  thresholds: (Partial<WarningThresholds> & LegacyWarningThresholds) | undefined,
): WarningThresholds => {
  const legacy = thresholds as LegacyWarningThresholds | undefined

  let boundary = normalizeWarnStarDiff(
    thresholds?.yellowGreenBoundary,
    DEFAULT_WARNING_THRESHOLDS.yellowGreenBoundary,
  )
  if (thresholds?.yellowGreenBoundary === undefined && legacy) {
    const yFrom = normalizeWarnStarDiff(legacy.yellowCheckFrom, boundary)
    const gBelow = normalizeWarnStarDiff(legacy.greenCheckBelow, boundary)
    if (legacy.yellowCheckFrom !== undefined || legacy.greenCheckBelow !== undefined) {
      boundary = Math.min(yFrom, gBelow)
    }
  }

  const raw: WarningThresholds = {
    yellowGreenBoundary: boundary,
    yellowQuestionAbove: normalizeWarnStarDiff(
      thresholds?.yellowQuestionAbove,
      DEFAULT_WARNING_THRESHOLDS.yellowQuestionAbove,
    ),
    redExclamationAbove: normalizeWarnStarDiff(
      thresholds?.redExclamationAbove,
      DEFAULT_WARNING_THRESHOLDS.redExclamationAbove,
    ),
  }

  return enforceOrderedWarningThresholds(raw)
}

export const weightsTotal = (weights: StarWeights): number =>
  STAR_VALUES.reduce((total, star) => total + weights[star], 0)

export const areWeightsValid = (weights: StarWeights): boolean => weightsTotal(weights) === 100

export const averageStars = (weights: StarWeights): number =>
  STAR_VALUES.reduce((total, star) => total + star * (weights[star] / 100), 0)

export const loadSettings = async (): Promise<ECHTSTERNSettings> => {
  if (!hasChromeStorage() || !browser) {
    return {
      weights: DEFAULT_WEIGHTS,
      defamationQuotaPercent: DEFAULT_DEFAMATION_QUOTA_PERCENT,
      warningThresholds: enforceOrderedWarningThresholds(DEFAULT_WARNING_THRESHOLDS),
      locale: DEFAULT_LOCALE_SETTING,
      inlineDisplay: DEFAULT_INLINE_DISPLAY_MODE,
      shareAnonymousStats: DEFAULT_SHARE_ANONYMOUS_STATS,
    }
  }

  const data = await browser.storage.sync.get(SETTINGS_STORAGE_KEY)
  const saved = data[SETTINGS_STORAGE_KEY] as Partial<ECHTSTERNSettings> | undefined
  const weights = normalizeWeights(saved?.weights)
  return {
    weights: areWeightsValid(weights) ? weights : DEFAULT_WEIGHTS,
    defamationQuotaPercent: normalizeDefamationQuotaPercent(saved?.defamationQuotaPercent),
    warningThresholds: normalizeWarningThresholds(saved?.warningThresholds),
    locale: normalizeLocaleSetting(saved?.locale),
    inlineDisplay: normalizeInlineDisplayMode(saved?.inlineDisplay),
    shareAnonymousStats: normalizeShareAnonymousStats(saved?.shareAnonymousStats),
  }
}

export const saveSettings = async (settings: ECHTSTERNSettings): Promise<void> => {
  if (!areWeightsValid(settings.weights)) {
    throw new Error('Die Gewichtung muss in Summe 100% ergeben.')
  }

  const normalizedSettings: ECHTSTERNSettings = {
    weights: normalizeWeights(settings.weights),
    defamationQuotaPercent: normalizeDefamationQuotaPercent(settings.defamationQuotaPercent),
    warningThresholds: normalizeWarningThresholds(settings.warningThresholds),
    locale: normalizeLocaleSetting(settings.locale),
    inlineDisplay: normalizeInlineDisplayMode(settings.inlineDisplay),
    shareAnonymousStats: normalizeShareAnonymousStats(settings.shareAnonymousStats),
  }

  if (!hasChromeStorage() || !browser) {
    return
  }

  await browser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: normalizedSettings })
}
