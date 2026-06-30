import { browser, hasBrowserLocalStorage } from './browserApi'
import type { PopupCandidate, PopupMatch, PopupMatchResponse } from './popup'
import type { EstimateResult, RemovedReviewRange, StarBreakdown } from './types'

export const TRACKING_ENABLED_BY_DEFAULT = true

const DEFAULT_API_BASE_URL = 'https://echtstern.de'

/**
 * Base URL for the ECHTSTERN API. Override for local end-to-end testing by
 * building the extension with `VITE_ECHTSTERN_API_BASE_URL`, e.g.
 * `VITE_ECHTSTERN_API_BASE_URL=http://localhost:3000 pnpm build`. The dev build
 * also injects the matching host permission (see `vite.config.ts`).
 */
export const API_BASE_URL =
  (import.meta.env.VITE_ECHTSTERN_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  DEFAULT_API_BASE_URL

export const TRACKING_ENDPOINT = `${API_BASE_URL}/api/observations`
export const MATCH_ENDPOINT = `${API_BASE_URL}/api/place-matches`
export const OBSERVATION_THROTTLE_MS = 6 * 60 * 60 * 1000

export const INSTALL_ID_STORAGE_KEY = 'echtstern:installId'
export const OBSERVATION_THROTTLE_STORAGE_KEY = 'echtstern:observationThrottle'

export type ObservationPayload = {
  placeKey: string
  placeName?: string
  businessCategory?: string
  websiteUrl?: string
  websiteChecked?: boolean
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

type ObservationThrottleEntry =
  | string
  | {
      hasRemovedRange?: boolean
      sentAt: string
    }
type ObservationThrottleState = Record<string, ObservationThrottleEntry>

type ObservationThrottleOptions = {
  hasRemovedRange?: boolean
}

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
  options: ObservationThrottleOptions = {},
  now = new Date(),
): Promise<boolean> => {
  if (!hasBrowserLocalStorage() || !browser) {
    return false
  }

  try {
    const stored = await browser.storage.local.get(OBSERVATION_THROTTLE_STORAGE_KEY)
    const state = (stored[OBSERVATION_THROTTLE_STORAGE_KEY] ?? {}) as ObservationThrottleState
    const lastEntry = state[placeKey]
    const lastSentAt = typeof lastEntry === 'string' ? lastEntry : lastEntry?.sentAt

    if (!lastSentAt) {
      return true
    }

    const elapsed = now.getTime() - new Date(lastSentAt).getTime()
    if (!Number.isFinite(elapsed) || elapsed >= OBSERVATION_THROTTLE_MS) {
      return true
    }

    const lastHadRemovedRange = typeof lastEntry === 'string' ? false : lastEntry?.hasRemovedRange === true
    return options.hasRemovedRange === true && !lastHadRemovedRange
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      logTracking('Observation throttle read failed', error)
    }
    return false
  }
}

export const markObservationSent = async (
  placeKey: string,
  options: ObservationThrottleOptions = {},
  now = new Date(),
): Promise<void> => {
  if (!hasBrowserLocalStorage() || !browser) {
    return
  }

  try {
    const stored = await browser.storage.local.get(OBSERVATION_THROTTLE_STORAGE_KEY)
    const state = (stored[OBSERVATION_THROTTLE_STORAGE_KEY] ?? {}) as ObservationThrottleState
    const cutoff = now.getTime() - OBSERVATION_THROTTLE_MS * 4

    const nextState = Object.fromEntries(
      Object.entries(state).filter(([, value]) => {
        const sentAt = typeof value === 'string' ? value : value.sentAt
        return new Date(sentAt).getTime() >= cutoff
      }),
    )
    nextState[placeKey] = {
      hasRemovedRange: options.hasRemovedRange === true,
      sentAt: now.toISOString(),
    }

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
  websiteUrl,
  websiteChecked,
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
  websiteUrl?: string
  websiteChecked?: boolean
  sourceUrl: string
  latitude?: number
  longitude?: number
  locale: string
  installId: string
}): ObservationPayload => ({
  placeKey,
  placeName,
  businessCategory,
  websiteUrl,
  websiteChecked,
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

export const fetchPlaceMatches = async (candidates: PopupCandidate[]): Promise<PopupMatch[] | null> => {
  if (candidates.length === 0) {
    return []
  }

  try {
    const response = await fetch(MATCH_ENDPOINT, {
      body: JSON.stringify({
        candidates: candidates.map((candidate) => ({
          name: candidate.name,
          reviewCount: candidate.reviewCount,
          businessCategory: candidate.businessCategory,
          cid: candidate.cid,
        })),
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    if (!response.ok) {
      logTracking('Place match request failed', { status: response.status })
      return null
    }

    const data = (await response.json()) as PopupMatchResponse
    return Array.isArray(data.matches) ? data.matches : null
  } catch (error) {
    logTracking('Place match request error', error)
    return null
  }
}

export type PostObservationResult = {
  ok: boolean
  // The server accepted the request but could not persist it yet and wants the
  // client to retry (e.g. a bare ?cid= URL without coordinates). When true the
  // client must NOT mark the place as sent, so the next scan can re-send.
  retryable: boolean
}

export const postObservation = async (payload: ObservationPayload): Promise<PostObservationResult> => {
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

  let retryable = false
  try {
    const data = (await response.json()) as { retryable?: boolean } | null
    retryable = data?.retryable === true
  } catch {
    // Response body was not JSON (e.g. an error page); treat as non-retryable.
  }

  logTracking('Observation response', {
    ok: response.ok,
    retryable,
    status: response.status,
    statusText: response.statusText,
  })

  return { ok: response.ok, retryable }
}
