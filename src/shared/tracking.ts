import { browser, hasBrowserLocalStorage } from './browserApi'
import type { EstimateResult, RemovedReviewRange, StarBreakdown } from './types'

export const TRACKING_ENABLED_BY_DEFAULT = true
export const TRACKING_ENDPOINT = 'https://echtstern.de/api/observations'
export const OBSERVATION_THROTTLE_MS = 6 * 60 * 60 * 1000

export const INSTALL_ID_STORAGE_KEY = 'echtstern:installId'
export const OBSERVATION_THROTTLE_STORAGE_KEY = 'echtstern:observationThrottle'

export type ObservationPayload = {
  placeKey: string
  placeName?: string
  businessCategory?: string
  sourceUrl: string
  rating: number
  displayedRating: number
  reviewCount: number
  latitude?: number
  longitude?: number
  starBreakdown?: Partial<StarBreakdown>
  removedRange?: Pick<RemovedReviewRange, 'min' | 'max' | 'isOpenEnded'>
  locale: string
  installId: string
  schemaVersion: 1
}

type ObservationThrottleState = Record<string, string>

const isExtensionContextInvalidatedError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('Extension context invalidated')

export const logTracking = (...args: unknown[]) => {
  void args
}

export const ensureInstallId = async (): Promise<string | null> => {
  if (!hasBrowserLocalStorage() || !browser) {
    return null
  }

  try {
    const stored = await browser.storage.local.get(INSTALL_ID_STORAGE_KEY)
    const existing = stored[INSTALL_ID_STORAGE_KEY]

    if (typeof existing === 'string' && existing) {
      return existing
    }

    const installId = crypto.randomUUID()
    await browser.storage.local.set({ [INSTALL_ID_STORAGE_KEY]: installId })
    return installId
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logTracking('Install ID storage failed', error)
    }
    return null
  }
}

export const shouldSendObservation = async (
  placeKey: string,
  now = new Date(),
): Promise<boolean> => {
  if (!hasBrowserLocalStorage() || !browser) {
    return false
  }

  try {
    const stored = await browser.storage.local.get(OBSERVATION_THROTTLE_STORAGE_KEY)
    const state = (stored[OBSERVATION_THROTTLE_STORAGE_KEY] ?? {}) as ObservationThrottleState
    const lastSentAt = state[placeKey]

    if (!lastSentAt) {
      return true
    }

    const elapsed = now.getTime() - new Date(lastSentAt).getTime()
    return !Number.isFinite(elapsed) || elapsed >= OBSERVATION_THROTTLE_MS
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logTracking('Observation throttle read failed', error)
    }
    return false
  }
}

export const markObservationSent = async (placeKey: string, now = new Date()): Promise<void> => {
  if (!hasBrowserLocalStorage() || !browser) {
    return
  }

  try {
    const stored = await browser.storage.local.get(OBSERVATION_THROTTLE_STORAGE_KEY)
    const state = (stored[OBSERVATION_THROTTLE_STORAGE_KEY] ?? {}) as ObservationThrottleState
    const cutoff = now.getTime() - OBSERVATION_THROTTLE_MS * 4

    const nextState = Object.fromEntries(
      Object.entries(state).filter(([, value]) => new Date(value).getTime() >= cutoff),
    )
    nextState[placeKey] = now.toISOString()

    await browser.storage.local.set({ [OBSERVATION_THROTTLE_STORAGE_KEY]: nextState })
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logTracking('Observation throttle write failed', error)
    }
  }
}

export const buildObservationPayload = ({
  result,
  placeKey,
  placeName,
  businessCategory,
  sourceUrl,
  latitude,
  longitude,
  locale,
  installId,
}: {
  result: EstimateResult
  placeKey: string
  placeName?: string
  businessCategory?: string
  sourceUrl: string
  latitude?: number
  longitude?: number
  locale: string
  installId: string
}): ObservationPayload => ({
  placeKey,
  placeName,
  businessCategory,
  sourceUrl,
  rating: result.originalRating,
  displayedRating: result.displayedRating ?? result.originalRating,
  reviewCount: result.reviewCount,
  latitude,
  longitude,
  starBreakdown: result.googleStarBreakdown,
  removedRange: result.noRemovedReviews
    ? undefined
    : {
        min: result.removedRange.min,
        max: result.removedRange.max,
        isOpenEnded: result.removedRange.isOpenEnded,
      },
  locale,
  installId,
  schemaVersion: 1,
})

export const postObservation = async (payload: ObservationPayload): Promise<boolean> => {
  logTracking('Posting observation', {
    endpoint: TRACKING_ENDPOINT,
    placeKey: payload.placeKey,
    sourceUrl: payload.sourceUrl,
  })

  const response = await fetch(TRACKING_ENDPOINT, {
    body: JSON.stringify(payload),
    headers: {
      'content-type': 'application/json',
    },
    keepalive: true,
    method: 'POST',
  })

  logTracking('Observation response', {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  })

  return response.ok
}
