import { browser, hasBrowserLocalStorage } from '../shared/browserApi'
import { buildNoRemovedReviewsEstimate, calculateEstimate } from '../shared/estimate'
import { formatRating } from '../shared/format'
import { getMessages, localeToIntl, resolveLocaleSetting, type Locale, type Messages } from '../shared/i18n'
import { LATEST_CONTEXT_STORAGE_KEY, LATEST_ESTIMATE_STORAGE_KEY, loadSettings, SETTINGS_STORAGE_KEY } from '../shared/settings'
import {
  TRACKING_ENABLED_BY_DEFAULT,
  type ObservationPayload,
  buildObservationPayload,
  ensureInstallId,
  logTracking,
  markObservationSent,
  shouldSendObservation,
} from '../shared/tracking'
import {
  parseRating,
  parseRemovedReviewRange,
  parseRemovedReviewRangeFromTrustedText,
  parseReviewCount,
  emptyStarBreakdown,
  parseStarBreakdownLabel,
  ratingFromStarBreakdown,
  starBreakdownTotal,
} from '../shared/parsing'
import type {
  EstimateResult,
  InlineDisplayMode,
  StarBreakdown,
  StarValue,
  StoredLatestContext,
  StoredLatestEstimate,
  WarningThresholds,
} from '../shared/types'
import {
  GOOGLE_MAPS_SELECTORS,
  REMOVED_NOTICE_TEXT_PATTERN,
  REVIEW_COUNT_TEXT_PATTERN,
} from './selectors'

const LEGACY_BANNER_ID = 'echtstern-estimate-banner'
const TRIGGER_ID = 'echtstern-popup-trigger'
const TRIGGER_SPACER_BEFORE_ID = 'echtstern-popup-trigger-spacer-before'
const INLINE_CARD_ID = 'echtstern-inline-card'
const INLINE_CARD_SPACER_BEFORE_ID = 'echtstern-inline-card-spacer-before'
const OUTSIDE_GERMANY_CARD_ID = 'echtstern-outside-germany-card'
const OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID = 'echtstern-outside-germany-card-spacer-before'
const STATUS_BADGE_ID = 'echtstern-rating-status'
const STYLE_ID = 'echtstern-content-style'

const STAR_VALUES_DESC: StarValue[] = [5, 4, 3, 2, 1]
const OUTSIDE_GERMANY_SIGNATURE = 'outside-germany'
const NO_REMOVALS_TRACKING_STABILIZATION_MS = 3_000

type PreparedObservation = {
  hasRemovedRange: boolean
  payload: ObservationPayload
  placeKey: string
}

type NoRemovalsTrackingCandidate = {
  firstSeenAt: number
  preparedObservation: PreparedObservation
  signature: string
}

const GERMANY_BOUNDS = {
  maxLatitude: 55.2,
  maxLongitude: 15.1,
  minLatitude: 47.2,
  minLongitude: 5.8,
} as const

const formatWholeCount = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(localeToIntl(locale), {
    maximumFractionDigits: 0,
  }).format(Math.round(value))

let latestSignature = ''
let latestResult: EstimateResult | null = null
let latestPlaceKey = ''
let latestPlaceName: string | undefined
let latestBusinessCategoryPlaceKey = ''
let latestBusinessCategory: string | undefined
let debounceTimer: number | undefined
let noRemovalsTrackingTimer: number | undefined
let noRemovalsTrackingCandidate: NoRemovalsTrackingCandidate | undefined
let lastScanStartedAt = 0
let lastObservedUrl = location.href
let lastNavigationPlaceKey: string | undefined
let observer: MutationObserver | null = null

const MIN_SCAN_INTERVAL_MS = 1_500

const isExtensionContextInvalidatedError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('Extension context invalidated')

const logUnexpectedExtensionError = (message: string, error: unknown) => {
  if (!isExtensionContextInvalidatedError(error)) {
    logTracking(message, error)
  }
}

const isOwnNode = (node: Node): boolean => {
  const element = node instanceof Element ? node : node.parentElement
  return Boolean(
    element?.closest(
      `#${LEGACY_BANNER_ID}, #${TRIGGER_ID}, #${TRIGGER_SPACER_BEFORE_ID}, #${INLINE_CARD_ID}, #${INLINE_CARD_SPACER_BEFORE_ID}, #${OUTSIDE_GERMANY_CARD_ID}, #${OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID}, #${STATUS_BADGE_ID}, #${STYLE_ID}`,
    ),
  )
}

const injectStyles = () => {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${TRIGGER_ID} {
      align-items: center;
      border: 1px solid #202124;
      border-radius: 999px;
      background: #f7fbff;
      box-shadow: none;
      color: #202124;
      cursor: pointer;
      display: flex;
      font-family: Roboto, Arial, sans-serif;
      font-size: 12px;
      font-weight: 700;
      justify-content: center;
      line-height: 16px;
      margin-left: auto;
      margin-right: auto;
      margin-top: 4px;
      min-height: 32px;
      padding: 6px 10px;
      text-align: center;
      width: 50%;
    }

    #${TRIGGER_ID}:hover {
      background: #eef3f8;
    }

    #${STATUS_BADGE_ID} {
      align-items: center;
      border-radius: 999px;
      display: inline-flex;
      font-family: Roboto, Arial, sans-serif;
      font-size: 16px;
      font-weight: 800;
      height: 22px;
      justify-content: center;
      line-height: 1;
      margin-left: 8px;
      position: relative;
      top: -4px;
      vertical-align: middle;
      width: 22px;
    }

    #${STATUS_BADGE_ID}[data-tone="red"] {
      background: #fce8e6;
      border: 1px solid #d93025;
      color: #d93025;
    }

    #${STATUS_BADGE_ID}[data-tone="yellow"] {
      background: #fef7e0;
      border: 1px solid #fbbc04;
      color: #b06000;
    }

    #${STATUS_BADGE_ID}[data-tone="green"] {
      background: #e6f4ea;
      border: 1px solid #188038;
      color: #188038;
    }

    #${INLINE_CARD_ID} {
      background: #f7fbff;
      border: 1px solid #202124;
      border-radius: 12px;
      box-shadow: none;
      color: #202124;
      cursor: pointer;
      display: block;
      font-family: Roboto, Arial, sans-serif;
      margin: 12px;
      padding: 12px;
      text-align: left;
      width: stretch;
      width: -webkit-fill-available;
    }

    #${INLINE_CARD_ID}:hover {
      background: #eef3f8;
    }

    #${INLINE_CARD_ID}:focus-visible {
      outline: 2px solid #1a73e8;
      outline-offset: 2px;
    }

    #${OUTSIDE_GERMANY_CARD_ID} {
      background: #f8fafd;
      border: 1px solid #dadce0;
      border-radius: 12px;
      color: #3c4043;
      display: block;
      font-family: Roboto, Arial, sans-serif;
      margin: 12px;
      padding: 12px;
      text-align: left;
      width: stretch;
      width: -webkit-fill-available;
    }

    #${INLINE_CARD_ID} .ec-card-header,
    #${OUTSIDE_GERMANY_CARD_ID} .ec-card-header {
      color: #202124;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      margin: 0 0 8px;
      text-align: center;
      text-transform: uppercase;
    }

    #${OUTSIDE_GERMANY_CARD_ID} .ec-notice {
      color: #5f6368;
      font-size: 13px;
      line-height: 18px;
      margin: 0;
    }

    #${INLINE_CARD_ID} .ec-card-body {
      align-items: center;
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
    }

    #${INLINE_CARD_ID} .ec-checked-message {
      align-items: center;
      color: #188038;
      display: flex;
      font-size: 13px;
      font-weight: 700;
      gap: 8px;
      line-height: 18px;
      margin: 0;
    }

    #${INLINE_CARD_ID} .ec-checked-message::before {
      align-items: center;
      background: #e6f4ea;
      border: 1px solid #188038;
      border-radius: 999px;
      content: "✓";
      display: inline-flex;
      flex: 0 0 auto;
      font-size: 14px;
      height: 22px;
      justify-content: center;
      width: 22px;
    }

    #${INLINE_CARD_ID} .ec-bars {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    #${INLINE_CARD_ID} .ec-bar-row {
      align-items: center;
      display: grid;
      gap: 6px;
      grid-template-columns: 12px minmax(0, 1fr);
      min-width: 0;
    }

    #${INLINE_CARD_ID} .ec-bar-label {
      color: #5f6368;
      font-size: 11px;
    }

    #${INLINE_CARD_ID} .ec-bar-track {
      background: #f1f3f4;
      border-radius: 999px;
      display: flex;
      height: 7px;
      min-width: 0;
      overflow: hidden;
    }

    #${INLINE_CARD_ID} .ec-bar-current,
    #${INLINE_CARD_ID} .ec-bar-added {
      display: block;
      flex: 0 0 auto;
      height: 100%;
    }

    #${INLINE_CARD_ID} .ec-bar-current { background: #fbbc04; }
    #${INLINE_CARD_ID} .ec-bar-added { background: #d93025; }

    #${INLINE_CARD_ID} .ec-summary {
      align-items: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
    }

    #${INLINE_CARD_ID} .ec-rating {
      color: #202124;
      font-size: 40px;
      font-weight: 500;
      line-height: 36px;
    }

    #${INLINE_CARD_ID} .ec-stars {
      display: inline-block;
      font-size: 14px;
      letter-spacing: 1px;
      line-height: 1;
      margin: 4px 0 6px;
      position: relative;
    }

    #${INLINE_CARD_ID} .ec-stars-track {
      color: #dadce0;
      display: inline-block;
      white-space: nowrap;
    }

    #${INLINE_CARD_ID} .ec-stars-fill {
      color: #fbbc04;
      display: inline-block;
      left: 0;
      overflow: hidden;
      position: absolute;
      top: 0;
      white-space: nowrap;
    }

    #${INLINE_CARD_ID} .ec-confidence {
      color: #5f6368;
      display: block;
      font-size: 12px;
      line-height: 16px;
    }

    #${INLINE_CARD_ID} .ec-reviews {
      color: #5f6368;
      display: block;
      font-size: 12px;
      line-height: 16px;
      margin-top: 2px;
    }

    #${INLINE_CARD_ID} .ec-hint {
      color: #5f6368;
      display: block;
      font-size: 11px;
      margin-top: 8px;
      text-align: right;
    }
  `
  document.documentElement.append(style)
}

const withObserverPaused = (callback: () => void) => {
  observer?.disconnect()
  try {
    callback()
  } finally {
    window.setTimeout(() => {
      observer?.observe(document.documentElement, { childList: true, subtree: true })
    }, 0)
  }
}

const queryFirstText = (selectors: readonly string[]): string | null => {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector)
    const ariaLabel = element?.getAttribute('aria-label')
    const text = ariaLabel || element?.textContent
    if (text?.trim()) {
      return text.trim()
    }
  }

  return null
}

const findRatingText = (): string | null => {
  const direct = queryFirstText(GOOGLE_MAPS_SELECTORS.ratingTextCandidates)
  if (parseRating(direct) !== null) {
    return direct
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[aria-label*="Sterne"], [aria-label*="stars"]'))
  return candidates.map((candidate) => candidate.getAttribute('aria-label')).find((text) => parseRating(text) !== null) ?? null
}

const findReviewCountText = (): string | null => {
  const direct = queryFirstText(GOOGLE_MAPS_SELECTORS.reviewCountCandidates)
  if (parseReviewCount(direct) !== null) {
    return direct
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>('.fontBodySmall, [role="main"] span, [role="main"] div'))
  return candidates.map((candidate) => candidate.textContent?.trim() ?? '').find((text) => REVIEW_COUNT_TEXT_PATTERN.test(text) && parseReviewCount(text) !== null) ?? null
}

const findRemovedNoticeText = (): string | null => {
  for (const selector of GOOGLE_MAPS_SELECTORS.removedNoticeCandidates) {
    const element = document.querySelector<HTMLElement>(selector)
    const text = element?.textContent?.trim()
    if (parseRemovedReviewRange(text) !== null) {
      return text ?? null
    }

    if (parseRemovedReviewRangeFromTrustedText(text) !== null) {
      const surroundingText = element?.closest('div')?.parentElement?.textContent?.trim() ?? text
      return surroundingText || text || null
    }
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="main"] div, [role="main"] span, div, span'))
  return candidates
    .map((candidate) => candidate.textContent?.trim() ?? '')
    .find((text) => REMOVED_NOTICE_TEXT_PATTERN.test(text) && parseRemovedReviewRange(text) !== null) ?? null
}

const findStarBreakdown = (): StarBreakdown | undefined => {
  const breakdown = emptyStarBreakdown()

  for (const selector of GOOGLE_MAPS_SELECTORS.starBreakdownCandidates) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    for (const candidate of candidates) {
      const parsed = parseStarBreakdownLabel(candidate.getAttribute('aria-label') ?? candidate.textContent)
      if (parsed) {
        breakdown[parsed.star] = parsed.count
      }
    }
  }

  return starBreakdownTotal(breakdown) > 0 ? breakdown : undefined
}

const findStarRatingSectionPpcwl = (): HTMLElement | null => {
  const root = document.querySelector<HTMLElement>(GOOGLE_MAPS_SELECTORS.reviewsPanelRoot)
  return (
    root?.querySelector<HTMLElement>(GOOGLE_MAPS_SELECTORS.starRatingSection) ??
    document.querySelector<HTMLElement>(GOOGLE_MAPS_SELECTORS.starRatingSection)
  )
}

const isGoogleMapsPlacePage = (): boolean => {
  try {
    return new URL(location.href).pathname.includes('/maps/place/')
  } catch {
    return false
  }
}

const hasReviewsViewUrlMarker = (): boolean =>
  /(?:!9m1!1b1|\/reviews(?:[/?#]|$))/i.test(location.href)

const hasReviewsPanelEvidence = (): boolean =>
  Boolean(findStarRatingSectionPpcwl()) || parseReviewCount(findReviewCountText()) !== null

const isReviewsTabActive = (): boolean => {
  const reviewsLabelPattern = /\b(rezensionen|bewertungen|berichte|reviews?|ratings?)\b/i

  for (const selector of GOOGLE_MAPS_SELECTORS.activeTabCandidates) {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>(selector))
    if (
      tabs.some((tab) => {
        const label = `${tab.getAttribute('aria-label') ?? ''} ${tab.textContent ?? ''}`
        return reviewsLabelPattern.test(label)
      })
    ) {
      return true
    }
  }

  return isGoogleMapsPlacePage() && (hasReviewsViewUrlMarker() || hasReviewsPanelEvidence())
}

const cloneAyRuiSpacer = (template: HTMLElement | null, id: string): HTMLElement => {
  if (template) {
    const clone = template.cloneNode(true) as HTMLElement
    clone.id = id
    return clone
  }

  const fallback = document.createElement('div')
  fallback.className = 'AyRUI'
  fallback.setAttribute('aria-hidden', 'true')
  fallback.style.height = '16px'
  fallback.innerHTML = '&nbsp;'
  fallback.id = id
  return fallback
}

const findAyRuiTemplate = (afterPpcwl: HTMLElement): HTMLElement | null => {
  const next = afterPpcwl.nextElementSibling
  if (next instanceof HTMLElement && next.classList.contains('AyRUI')) {
    return next
  }

  return (
    document.querySelector<HTMLElement>('.AyRUI[aria-hidden="true"]') ?? document.querySelector<HTMLElement>('.AyRUI')
  )
}

const findRatingStatusAnchor = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.jANrlb > .fontDisplayLarge')

const normalizePlaceName = (value: string | null | undefined): string | undefined => {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

const isGenericGoogleMapsTitle = (value: string | undefined): boolean =>
  /^(ergebnisse|results|suchergebnisse|search results)$/i.test(value ?? '')

const normalizeBusinessCategory = (value: string | null | undefined): string | undefined => {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

const findVisibleBusinessCategory = (): string | undefined => {
  for (const selector of GOOGLE_MAPS_SELECTORS.businessCategoryCandidates) {
    const text = normalizeBusinessCategory(document.querySelector<HTMLElement>(selector)?.textContent)
    if (text) {
      return text
    }
  }

  return undefined
}

const findVisiblePlaceName = (): string | undefined => {
  for (const selector of GOOGLE_MAPS_SELECTORS.placeNameCandidates) {
    const text = normalizePlaceName(document.querySelector<HTMLElement>(selector)?.textContent)
    if (text && !isGenericGoogleMapsTitle(text)) {
      return text
    }
  }

  return undefined
}

const findPlaceNameFromUrl = (): string | undefined => {
  try {
    const path = new URL(location.href).pathname
    const match = path.match(/\/maps\/place\/([^/?#]+)/)
    if (!match) {
      return undefined
    }

    return normalizePlaceName(decodeURIComponent(match[1].replace(/\+/g, ' ')))
  } catch {
    return undefined
  }
}

const findGoogleMapsCidFromUrl = (): string | undefined => {
  try {
    const url = new URL(location.href)
    const existingCid = url.searchParams.get('cid')

    if (existingCid && /^\d+$/.test(existingCid)) {
      return existingCid
    }
  } catch {
    // Fall through to extracting the raw hex CID from Google Maps' data segment.
  }

  const decodedUrl = (() => {
    try {
      return decodeURIComponent(location.href)
    } catch {
      return location.href
    }
  })()
  const matches = [...decodedUrl.matchAll(/0x[0-9a-f]+:0x([0-9a-f]+)/gi)]
  const cidHex = matches.at(-1)?.[1]

  if (!cidHex) {
    return undefined
  }

  try {
    return BigInt(`0x${cidHex}`).toString(10)
  } catch {
    return undefined
  }
}

const findPlaceKeyFromUrl = (): string | undefined => {
  const cid = findGoogleMapsCidFromUrl()

  if (cid) {
    return `google-cid:${cid}`
  }

  try {
    const path = new URL(location.href).pathname
    const match = path.match(/\/maps\/place\/([^/?#]+)/)
    return match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : undefined
  } catch {
    return undefined
  }
}

type PlaceIdentity = {
  key: string
  name?: string
}

const findPlaceIdentity = (): PlaceIdentity | undefined => {
  const key = findPlaceKeyFromUrl()
  const urlPlaceName = findPlaceNameFromUrl()
  const visiblePlaceName = findVisiblePlaceName()
  const name = urlPlaceName ?? visiblePlaceName

  if (key) {
    return { key, name }
  }

  return name ? { key: name, name } : undefined
}

const findCoordinatesFromUrl = (): { latitude: number; longitude: number } | undefined => {
  try {
    const parseCoordinates = (latitudeText: string | undefined, longitudeText: string | undefined) => {
      const latitude = Number(latitudeText)
      const longitude = Number(longitudeText)

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return undefined
      }

      return { latitude, longitude }
    }

    const placeCoordinateMatches = Array.from(
      location.href.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g),
    )
    const placeCoordinateMatch = placeCoordinateMatches[placeCoordinateMatches.length - 1]
    const placeCoordinates = parseCoordinates(placeCoordinateMatch?.[1], placeCoordinateMatch?.[2])

    if (placeCoordinates) {
      return placeCoordinates
    }

    const viewportMatch = location.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/)
    return parseCoordinates(viewportMatch?.[1], viewportMatch?.[2])
  } catch {
    return undefined
  }
}

const isOutsideGermanyBounds = (coordinates: { latitude: number; longitude: number } | undefined): boolean => {
  if (!coordinates) {
    return false
  }

  return (
    coordinates.latitude < GERMANY_BOUNDS.minLatitude ||
    coordinates.latitude > GERMANY_BOUNDS.maxLatitude ||
    coordinates.longitude < GERMANY_BOUNDS.minLongitude ||
    coordinates.longitude > GERMANY_BOUNDS.maxLongitude
  )
}

const rememberPlaceName = (): string | undefined => {
  const identity = findPlaceIdentity()
  const placeKey = identity?.key ?? ''

  if (placeKey && placeKey !== latestPlaceKey) {
    latestPlaceKey = placeKey
    latestPlaceName = undefined
    latestBusinessCategoryPlaceKey = ''
    latestBusinessCategory = undefined
  }

  if (identity?.name) {
    latestPlaceName = identity.name
  }

  return latestPlaceKey === placeKey ? latestPlaceName : identity?.name
}

const findPlaceName = (): string | undefined => rememberPlaceName()

const findPlaceKey = (): string | undefined =>
  findPlaceIdentity()?.key

const rememberBusinessCategory = (placeKey = findPlaceKey()): string | undefined => {
  if (!placeKey) {
    return undefined
  }

  const visibleBusinessCategory = findVisibleBusinessCategory()
  if (visibleBusinessCategory) {
    latestBusinessCategoryPlaceKey = placeKey
    latestBusinessCategory = visibleBusinessCategory
  }

  return latestBusinessCategoryPlaceKey === placeKey ? latestBusinessCategory : undefined
}

const removeLegacyBanner = () => {
  document.getElementById(LEGACY_BANNER_ID)?.remove()
}

const clearInjectedState = () => {
  removeLegacyBanner()
  document.getElementById(TRIGGER_ID)?.remove()
  document.getElementById(TRIGGER_SPACER_BEFORE_ID)?.remove()
  document.getElementById(INLINE_CARD_ID)?.remove()
  document.getElementById(INLINE_CARD_SPACER_BEFORE_ID)?.remove()
  document.getElementById(OUTSIDE_GERMANY_CARD_ID)?.remove()
  document.getElementById(OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID)?.remove()
  document.getElementById(STATUS_BADGE_ID)?.remove()
  latestSignature = ''
  latestResult = null

  if (hasBrowserLocalStorage() && browser) {
    void browser.storage.local
      .remove([LATEST_CONTEXT_STORAGE_KEY, LATEST_ESTIMATE_STORAGE_KEY])
      .catch((error: unknown) => logUnexpectedExtensionError('Latest context clear failed', error))
  }
}

const getStatusBadge = (
  result: EstimateResult,
  thresholds: WarningThresholds,
  copy: Messages,
  locale: Locale,
): { label: string; tone: 'red' | 'yellow' | 'green'; title: string } => {
  if (result.noRemovedReviews) {
    return {
      label: '✓',
      tone: 'green',
      title: copy.estimate.noRemovedReviews,
    }
  }

  const difference = result.originalRating - result.median
  const formattedDifference = formatRating(Math.max(0, difference), locale)

  if (difference > thresholds.redExclamationAbove) {
    return {
      label: '!',
      tone: 'red',
      title: copy.content.lowerThanGoogle(formattedDifference),
    }
  }

  if (difference > thresholds.yellowQuestionAbove) {
    return {
      label: '?',
      tone: 'yellow',
      title: copy.content.lowerThanGoogle(formattedDifference),
    }
  }

  if (difference >= thresholds.yellowGreenBoundary) {
    return {
      label: '✓',
      tone: 'yellow',
      title: copy.content.lowerThanGoogle(formattedDifference),
    }
  }

  return {
    label: '✓',
    tone: 'green',
    title: copy.content.lessThanThreshold(formatRating(thresholds.yellowGreenBoundary, locale)),
  }
}

const renderRatingStatus = (result: EstimateResult, thresholds: WarningThresholds, copy: Messages, locale: Locale) => {
  const anchor = findRatingStatusAnchor()
  if (!anchor) {
    return
  }

  const status = getStatusBadge(result, thresholds, copy, locale)
  const existingBadge = document.getElementById(STATUS_BADGE_ID)
  if (
    existingBadge?.parentElement === anchor &&
    existingBadge.textContent === status.label &&
    existingBadge.dataset.tone === status.tone &&
    existingBadge.title === status.title
  ) {
    return
  }

  withObserverPaused(() => {
    existingBadge?.remove()
    const badge = document.createElement('span')
    badge.id = STATUS_BADGE_ID
    badge.dataset.tone = status.tone
    badge.title = status.title
    badge.setAttribute('aria-label', status.title)
    badge.textContent = status.label
    anchor.append(badge)
  })
}

const removeInlineCard = () => {
  document.getElementById(INLINE_CARD_ID)?.remove()
  document.getElementById(INLINE_CARD_SPACER_BEFORE_ID)?.remove()
}

const removeOutsideGermanyCard = () => {
  document.getElementById(OUTSIDE_GERMANY_CARD_ID)?.remove()
  document.getElementById(OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID)?.remove()
}

const removePopupTrigger = () => {
  document.getElementById(TRIGGER_ID)?.remove()
  document.getElementById(TRIGGER_SPACER_BEFORE_ID)?.remove()
}

const renderOutsideGermanyNotice = (copy: Messages) => {
  injectStyles()
  removeLegacyBanner()

  const ppcwl = findStarRatingSectionPpcwl()
  if (!ppcwl) {
    return
  }

  const existingCard = document.getElementById(OUTSIDE_GERMANY_CARD_ID)
  const beforeExisting = existingCard?.previousElementSibling
  const chainOk =
    beforeExisting?.id === OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID && beforeExisting.previousElementSibling === ppcwl

  if (
    existingCard &&
    chainOk &&
    existingCard.textContent?.includes(copy.content.outsideGermanyNotice) &&
    !document.getElementById(INLINE_CARD_ID) &&
    !document.getElementById(TRIGGER_ID)
  ) {
    return
  }

  withObserverPaused(() => {
    removeInlineCard()
    removePopupTrigger()
    removeOutsideGermanyCard()
    document.getElementById(STATUS_BADGE_ID)?.remove()

    const spacerTemplate = findAyRuiTemplate(ppcwl)
    const spacerBefore = cloneAyRuiSpacer(spacerTemplate, OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID)
    ppcwl.insertAdjacentElement('afterend', spacerBefore)

    const card = document.createElement('div')
    card.id = OUTSIDE_GERMANY_CARD_ID
    card.setAttribute('role', 'status')

    const header = document.createElement('div')
    header.className = 'ec-card-header'
    header.textContent = copy.common.echtstern
    card.append(header)

    const message = document.createElement('p')
    message.className = 'ec-notice'
    message.textContent = copy.content.outsideGermanyNotice
    card.append(message)

    spacerBefore.insertAdjacentElement('afterend', card)
  })
}

const renderPopupTrigger = (result: EstimateResult, thresholds: WarningThresholds, copy: Messages, locale: Locale) => {
  injectStyles()
  removeLegacyBanner()
  removeOutsideGermanyCard()
  renderRatingStatus(result, thresholds, copy, locale)

  const ppcwl = findStarRatingSectionPpcwl()
  if (!ppcwl) {
    return
  }

  const existingTrigger = document.getElementById(TRIGGER_ID)
  const triggerText = result.noRemovedReviews ? copy.content.inlineNoRemovedChecked : copy.content.showEstimate
  const triggerTitle = result.noRemovedReviews
    ? copy.content.inlineNoRemovedChecked
    : copy.content.showEstimateTitle(formatRating(result.median, locale))

  const beforeExisting = existingTrigger?.previousElementSibling
  const chainOk =
    beforeExisting?.id === TRIGGER_SPACER_BEFORE_ID &&
    beforeExisting.previousElementSibling === ppcwl

  if (
    existingTrigger &&
    chainOk &&
    existingTrigger.textContent === triggerText &&
    existingTrigger.title === triggerTitle &&
    !document.getElementById(INLINE_CARD_ID)
  ) {
    return
  }

  withObserverPaused(() => {
    existingTrigger?.remove()
    document.getElementById(TRIGGER_SPACER_BEFORE_ID)?.remove()
    removeInlineCard()

    const spacerTemplate = findAyRuiTemplate(ppcwl)
    const spacerBefore = cloneAyRuiSpacer(spacerTemplate, TRIGGER_SPACER_BEFORE_ID)

    ppcwl.insertAdjacentElement('afterend', spacerBefore)

    const trigger = document.createElement('button')
    trigger.id = TRIGGER_ID
    trigger.type = 'button'
    trigger.title = triggerTitle
    trigger.setAttribute('aria-label', triggerTitle)
    trigger.textContent = triggerText
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void browser?.runtime
        .sendMessage({ type: 'OPEN_ECHTSTERN_POPUP' })
        .catch((error: unknown) => logUnexpectedExtensionError('Open popup message failed', error))
    })

    spacerBefore.insertAdjacentElement('afterend', trigger)
  })
}

const buildBarRow = (
  star: StarValue,
  current: number,
  added: number,
  maxCount: number,
): HTMLElement => {
  const row = document.createElement('div')
  row.className = 'ec-bar-row'

  const label = document.createElement('span')
  label.className = 'ec-bar-label'
  label.textContent = String(star)
  row.append(label)

  const track = document.createElement('span')
  track.className = 'ec-bar-track'

  const currentWidth = Math.max(0, Math.min(100, (current / maxCount) * 100))
  const addedWidth = Math.max(0, Math.min(100 - currentWidth, (added / maxCount) * 100))

  const currentSpan = document.createElement('span')
  currentSpan.className = 'ec-bar-current'
  currentSpan.style.width = `${currentWidth}%`

  const addedSpan = document.createElement('span')
  addedSpan.className = 'ec-bar-added'
  addedSpan.style.width = `${addedWidth}%`

  track.append(currentSpan, addedSpan)
  row.append(track)

  return row
}

const buildInlineStars = (rating: number): HTMLElement => {
  const wrapper = document.createElement('span')
  wrapper.className = 'ec-stars'
  wrapper.setAttribute('aria-hidden', 'true')

  const track = document.createElement('span')
  track.className = 'ec-stars-track'
  track.textContent = '★★★★★'
  wrapper.append(track)

  const fill = document.createElement('span')
  fill.className = 'ec-stars-fill'
  fill.textContent = '★★★★★'
  fill.style.width = `${Math.max(0, Math.min(100, (rating / 5) * 100))}%`
  wrapper.append(fill)

  return wrapper
}

const buildInlineCardElement = (
  result: EstimateResult,
  copy: Messages,
  locale: Locale,
): HTMLButtonElement => {
  const card = document.createElement('button')
  card.id = INLINE_CARD_ID
  card.type = 'button'

  const ratingText = formatRating(result.median, locale)
  const ariaLabel = copy.content.inlineCardAriaLabel(ratingText)
  card.setAttribute('aria-label', ariaLabel)
  card.title = ariaLabel

  const header = document.createElement('div')
  header.className = 'ec-card-header'
  header.textContent = result.noRemovedReviews ? copy.common.echtstern : copy.content.inlineCardTitle
  card.append(header)

  if (result.noRemovedReviews) {
    const message = document.createElement('p')
    message.className = 'ec-checked-message'
    message.textContent = copy.content.inlineNoRemovedChecked
    card.append(message)

    card.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void browser?.runtime
        .sendMessage({ type: 'OPEN_ECHTSTERN_POPUP' })
        .catch((error: unknown) => logUnexpectedExtensionError('Open popup message failed', error))
    })

    return card
  }

  const body = document.createElement('div')
  body.className = 'ec-card-body'

  const breakdown = result.googleStarBreakdown
  if (breakdown) {
    const bars = document.createElement('div')
    bars.className = 'ec-bars'

    const maxCount = Math.max(
      ...STAR_VALUES_DESC.map((star) => breakdown[star] + result.estimatedAddedStarBreakdown[star]),
      1,
    )

    for (const star of STAR_VALUES_DESC) {
      bars.append(
        buildBarRow(star, breakdown[star], result.estimatedAddedStarBreakdown[star], maxCount),
      )
    }

    body.append(bars)
  } else {
    body.style.gridTemplateColumns = '1fr'
  }

  const summary = document.createElement('div')
  summary.className = 'ec-summary'

  const rating = document.createElement('strong')
  rating.className = 'ec-rating'
  rating.textContent = ratingText
  summary.append(rating)

  summary.append(buildInlineStars(result.median))

  const confidence = document.createElement('span')
  confidence.className = 'ec-confidence'
  confidence.textContent = result.noRemovedReviews
    ? copy.content.inlineMatchesGoogle
    : copy.content.inlineConfidenceShort(
        formatRating(result.intervalLow, locale),
        formatRating(result.intervalHigh, locale),
      )
  summary.append(confidence)

  const reviews = document.createElement('span')
  reviews.className = 'ec-reviews'
  const addedAvg = Math.max(0, Math.round(result.averageAddedReviewCount))
  if (!result.noRemovedReviews && addedAvg > 0) {
    reviews.textContent = copy.content.inlineReviewsWithAdded(
      formatWholeCount(result.reviewCount, locale),
      formatWholeCount(addedAvg, locale),
    )
  } else {
    reviews.textContent = copy.content.inlineReviews(formatWholeCount(result.reviewCount, locale))
  }
  summary.append(reviews)

  body.append(summary)
  card.append(body)

  const hint = document.createElement('span')
  hint.className = 'ec-hint'
  hint.textContent = `${copy.content.inlineOpenDetails} →`
  card.append(hint)

  card.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void browser?.runtime
      .sendMessage({ type: 'OPEN_ECHTSTERN_POPUP' })
      .catch((error: unknown) => logUnexpectedExtensionError('Open popup message failed', error))
  })

  return card
}

const computeInlineCardSignature = (
  result: EstimateResult,
  locale: Locale,
): string => {
  const breakdownKey = result.googleStarBreakdown
    ? STAR_VALUES_DESC.map(
        (star) =>
          `${star}:${(result.googleStarBreakdown ?? {})[star]}/${result.estimatedAddedStarBreakdown[star]}`,
      ).join(',')
    : 'no-breakdown'

  return [
    locale,
    result.noRemovedReviews ? 'no-removed' : 'monte-carlo',
    result.median.toFixed(2),
    result.intervalLow.toFixed(2),
    result.intervalHigh.toFixed(2),
    result.reviewCount,
    Math.round(result.averageAddedReviewCount),
    breakdownKey,
  ].join('|')
}

const renderInlineCard = (
  result: EstimateResult,
  thresholds: WarningThresholds,
  copy: Messages,
  locale: Locale,
) => {
  injectStyles()
  removeLegacyBanner()
  removeOutsideGermanyCard()
  renderRatingStatus(result, thresholds, copy, locale)

  const ppcwl = findStarRatingSectionPpcwl()
  if (!ppcwl) {
    return
  }

  const existingCard = document.getElementById(INLINE_CARD_ID)
  const beforeExisting = existingCard?.previousElementSibling
  const chainOk =
    beforeExisting?.id === INLINE_CARD_SPACER_BEFORE_ID && beforeExisting.previousElementSibling === ppcwl
  const signature = computeInlineCardSignature(result, locale)

  if (
    existingCard &&
    chainOk &&
    existingCard.dataset.signature === signature &&
    !document.getElementById(TRIGGER_ID)
  ) {
    return
  }

  withObserverPaused(() => {
    removeInlineCard()
    removePopupTrigger()

    const spacerTemplate = findAyRuiTemplate(ppcwl)
    const spacerBefore = cloneAyRuiSpacer(spacerTemplate, INLINE_CARD_SPACER_BEFORE_ID)
    ppcwl.insertAdjacentElement('afterend', spacerBefore)

    const card = buildInlineCardElement(result, copy, locale)
    card.dataset.signature = signature
    spacerBefore.insertAdjacentElement('afterend', card)
  })
}

const renderEstimateUi = (
  result: EstimateResult,
  thresholds: WarningThresholds,
  copy: Messages,
  locale: Locale,
  inlineDisplay: InlineDisplayMode,
) => {
  if (inlineDisplay === 'card') {
    renderInlineCard(result, thresholds, copy, locale)
  } else {
    renderPopupTrigger(result, thresholds, copy, locale)
  }
}

const persistLatestResult = async (result: EstimateResult) => {
  latestResult = result

  if (!hasBrowserLocalStorage() || !browser) {
    return
  }

  const payload: StoredLatestEstimate = {
    placeName: findPlaceName(),
    sourceUrl: location.href,
    calculatedAt: new Date().toISOString(),
    result,
  }

  try {
    await browser.storage.local.remove(LATEST_CONTEXT_STORAGE_KEY)
    await browser.storage.local.set({ [LATEST_ESTIMATE_STORAGE_KEY]: payload })
  } catch (error) {
    logUnexpectedExtensionError('Latest estimate persist failed', error)
  }
}

const persistOutsideGermanyContext = async () => {
  if (!hasBrowserLocalStorage() || !browser) {
    return
  }

  const payload: StoredLatestContext = {
    placeName: findPlaceName(),
    sourceUrl: location.href,
    calculatedAt: new Date().toISOString(),
    status: 'outsideGermany',
  }

  try {
    await browser.storage.local.remove(LATEST_ESTIMATE_STORAGE_KEY)
    await browser.storage.local.set({ [LATEST_CONTEXT_STORAGE_KEY]: payload })
  } catch (error) {
    logUnexpectedExtensionError('Latest context persist failed', error)
  }
}

const sendObservationViaBackground = async (payload: ObservationPayload): Promise<boolean> => {
  if (!browser?.runtime?.sendMessage) {
    logTracking('Cannot send observation: runtime.sendMessage unavailable')
    return false
  }

  let response: unknown
  try {
    response = await browser.runtime.sendMessage({
      type: 'SEND_ECHTSTERN_OBSERVATION',
      payload,
    })
  } catch (error) {
    logUnexpectedExtensionError('Observation background message failed', error)
    return false
  }

  const ok = Boolean((response as { ok?: boolean } | undefined)?.ok)
  logTracking('Background observation result', response)
  return ok
}

const clearNoRemovalsTrackingCandidate = () => {
  if (noRemovalsTrackingTimer !== undefined) {
    window.clearTimeout(noRemovalsTrackingTimer)
    noRemovalsTrackingTimer = undefined
  }
  noRemovalsTrackingCandidate = undefined
}

const prepareObservation = async (
  result: EstimateResult,
  locale: Locale,
  shareAnonymousStats: boolean,
): Promise<PreparedObservation | null> => {
  if (!TRACKING_ENABLED_BY_DEFAULT || !shareAnonymousStats) {
    logTracking('Skipped observation: tracking disabled or user opted out', {
      trackingEnabled: TRACKING_ENABLED_BY_DEFAULT,
      shareAnonymousStats,
    })
    return null
  }

  const placeIdentity = findPlaceIdentity()
  if (!placeIdentity) {
    logTracking('Skipped observation: no place key found')
    return null
  }

  const hasRemovedRange = result.noRemovedReviews !== true
  const installId = await ensureInstallId()
  if (!installId) {
    logTracking('Skipped observation: no install id available')
    return null
  }

  const coordinates = findCoordinatesFromUrl()

  return {
    hasRemovedRange,
    payload: buildObservationPayload({
      result,
      placeKey: placeIdentity.key,
      placeName: placeIdentity.name,
      businessCategory: rememberBusinessCategory(placeIdentity.key),
      sourceUrl: location.href,
      latitude: coordinates?.latitude,
      longitude: coordinates?.longitude,
      locale,
      installId,
    }),
    placeKey: placeIdentity.key,
  }
}

const sendPreparedObservation = async ({ hasRemovedRange, payload, placeKey }: PreparedObservation) => {
  const shouldSend = await shouldSendObservation(placeKey, { hasRemovedRange })
  if (!shouldSend) {
    logTracking('Skipped observation: local throttle active', { hasRemovedRange, placeKey })
    return
  }

  logTracking('Prepared observation payload', payload)

  try {
    const sent = await sendObservationViaBackground(payload)
    if (sent) {
      await markObservationSent(placeKey, { hasRemovedRange })
      logTracking('Observation sent and throttle updated', { hasRemovedRange, placeKey })
    } else {
      logTracking('Observation not accepted by background/API', { placeKey })
    }
  } catch (error) {
    // Tracking must never affect the Google Maps UI.
    logTracking('Observation send failed in content script', error)
  }
}

const maybeSendObservation = async (result: EstimateResult, locale: Locale, shareAnonymousStats: boolean) => {
  const preparedObservation = await prepareObservation(result, locale, shareAnonymousStats)
  if (preparedObservation) {
    await sendPreparedObservation(preparedObservation)
  }
}

const flushNoRemovalsTrackingCandidate = () => {
  const candidate = noRemovalsTrackingCandidate
  clearNoRemovalsTrackingCandidate()

  if (candidate) {
    void sendPreparedObservation(candidate.preparedObservation)
  }
}

const maybeSendStableNoRemovalsObservation = async (
  signature: string,
  result: EstimateResult,
  locale: Locale,
  shareAnonymousStats: boolean,
) => {
  const now = Date.now()

  if (noRemovalsTrackingCandidate?.signature !== signature) {
    const preparedObservation = await prepareObservation(result, locale, shareAnonymousStats)
    if (!preparedObservation) {
      clearNoRemovalsTrackingCandidate()
      return
    }

    noRemovalsTrackingCandidate = {
      firstSeenAt: now,
      preparedObservation,
      signature,
    }
  }

  const elapsed = now - noRemovalsTrackingCandidate.firstSeenAt
  if (elapsed >= NO_REMOVALS_TRACKING_STABILIZATION_MS) {
    flushNoRemovalsTrackingCandidate()
    return
  }

  if (noRemovalsTrackingTimer === undefined) {
    noRemovalsTrackingTimer = window.setTimeout(() => {
      noRemovalsTrackingTimer = undefined
      scheduleScan()
    }, NO_REMOVALS_TRACKING_STABILIZATION_MS - elapsed)
  }
}

const scanAndRender = async () => {
  lastScanStartedAt = Date.now()
  rememberPlaceName()
  rememberBusinessCategory()
  if (!isReviewsTabActive()) {
    clearInjectedState()
    return
  }

  const coordinates = findCoordinatesFromUrl()
  if (isOutsideGermanyBounds(coordinates)) {
    let settings: Awaited<ReturnType<typeof loadSettings>>
    try {
      settings = await loadSettings()
    } catch (error) {
      logUnexpectedExtensionError('Settings load failed', error)
      return
    }

    const locale = resolveLocaleSetting(settings.locale)
    const copy = getMessages(locale)
    if (latestSignature !== OUTSIDE_GERMANY_SIGNATURE) {
      clearInjectedState()
      latestSignature = OUTSIDE_GERMANY_SIGNATURE
    }
    latestResult = null
    renderOutsideGermanyNotice(copy)
    await persistOutsideGermanyContext()
    return
  }

  const ratingText = findRatingText()
  const reviewCountText = findReviewCountText()
  const removedNoticeText = findRemovedNoticeText()
  const displayedRating = parseRating(ratingText)
  const parsedReviewCount = parseReviewCount(reviewCountText)
  const removedRange = parseRemovedReviewRange(removedNoticeText) ?? parseRemovedReviewRangeFromTrustedText(removedNoticeText)
  const starBreakdown = findStarBreakdown()
  const starBreakdownRating = starBreakdown ? ratingFromStarBreakdown(starBreakdown) : null
  const starBreakdownReviewCount = starBreakdown ? starBreakdownTotal(starBreakdown) : null
  const rating = starBreakdownRating ?? displayedRating
  const reviewCount = starBreakdownReviewCount || parsedReviewCount

  if (rating === null || displayedRating === null || reviewCount === null) {
    clearInjectedState()
    return
  }

  let settings: Awaited<ReturnType<typeof loadSettings>>
  try {
    settings = await loadSettings()
  } catch (error) {
    logUnexpectedExtensionError('Settings load failed', error)
    return
  }
  const locale = resolveLocaleSetting(settings.locale)
  const copy = getMessages(locale)

  if (removedRange === null) {
    const payload = { rating, displayedRating, reviewCount, starBreakdown }
    const signature = JSON.stringify({
      mode: 'no-removals',
      payload,
      weights: settings.weights,
      defamationQuotaPercent: settings.defamationQuotaPercent,
      warningThresholds: settings.warningThresholds,
      locale: settings.locale,
      inlineDisplay: settings.inlineDisplay,
    })

    if (signature === latestSignature && latestResult?.noRemovedReviews) {
      renderEstimateUi(latestResult, settings.warningThresholds, copy, locale, settings.inlineDisplay)
      await maybeSendStableNoRemovalsObservation(signature, latestResult, locale, settings.shareAnonymousStats)
      return
    }

    const result = buildNoRemovedReviewsEstimate(payload, settings.weights, {
      defamationQuotaPercent: settings.defamationQuotaPercent,
      noRemovedReviewsLabel: copy.estimate.noRemovedReviews,
    })
    latestSignature = signature
    renderEstimateUi(result, settings.warningThresholds, copy, locale, settings.inlineDisplay)
    await persistLatestResult(result)
    await maybeSendStableNoRemovalsObservation(signature, result, locale, settings.shareAnonymousStats)
    logTracking('Delayed no-removals observation until review context stabilizes', {
      stabilizationMs: NO_REMOVALS_TRACKING_STABILIZATION_MS,
    })
    return
  }

  clearNoRemovalsTrackingCandidate()
  const data = { rating, displayedRating, reviewCount, removedRange, starBreakdown }
  const signature = JSON.stringify({
    mode: 'monte-carlo',
    data,
    weights: settings.weights,
    defamationQuotaPercent: settings.defamationQuotaPercent,
    warningThresholds: settings.warningThresholds,
    locale: settings.locale,
    inlineDisplay: settings.inlineDisplay,
  })

  if (signature === latestSignature && latestResult && !latestResult.noRemovedReviews) {
    renderEstimateUi(latestResult, settings.warningThresholds, copy, locale, settings.inlineDisplay)
    return
  }

  const result = calculateEstimate(data, settings.weights, {
    defamationQuotaPercent: settings.defamationQuotaPercent,
  })
  latestSignature = signature
  renderEstimateUi(result, settings.warningThresholds, copy, locale, settings.inlineDisplay)
  await persistLatestResult(result)
  void maybeSendObservation(result, locale, settings.shareAnonymousStats)
}

const scheduleScan = () => {
  if (debounceTimer !== undefined) {
    return
  }

  const elapsedSinceLastScan = Date.now() - lastScanStartedAt
  const delay = Math.max(500, MIN_SCAN_INTERVAL_MS - elapsedSinceLastScan)
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined
    void scanAndRender().catch((error: unknown) => logUnexpectedExtensionError('Scan failed', error))
  }, delay)
}

const scheduleDeferredScans = () => {
  scheduleScan()
  window.setTimeout(scheduleScan, 1_000)
  window.setTimeout(scheduleScan, 2_500)
}

const scheduleNavigationScans = () => {
  flushNoRemovalsTrackingCandidate()
  latestSignature = ''
  latestResult = null
  latestPlaceKey = ''
  latestPlaceName = undefined
  latestBusinessCategoryPlaceKey = ''
  latestBusinessCategory = undefined
  clearInjectedState()
  scheduleDeferredScans()
}

const handlePotentialUrlChange = () => {
  if (location.href === lastObservedUrl) {
    return
  }

  lastObservedUrl = location.href

  // Google Maps mutates the URL repeatedly within the same profile (e.g. cid URL ->
  // /maps/place/ URL, appended data params). Those refinements share the same place
  // identity and must not reset the no-removals stabilization, otherwise a pending
  // snapshot is flushed before the removed-reviews banner has loaded.
  const currentPlaceKey = findPlaceKeyFromUrl()
  if (currentPlaceKey && currentPlaceKey === lastNavigationPlaceKey) {
    scheduleDeferredScans()
    return
  }

  lastNavigationPlaceKey = currentPlaceKey
  scheduleNavigationScans()
}

observer = new MutationObserver((mutations) => {
  handlePotentialUrlChange()

  const onlyOwnMutations = mutations.every((mutation) => {
    const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]
    return isOwnNode(mutation.target) || changedNodes.every(isOwnNode)
  })

  if (!onlyOwnMutations) {
    scheduleScan()
  }
})
observer.observe(document.documentElement, { childList: true, subtree: true })

window.addEventListener('popstate', handlePotentialUrlChange)
window.addEventListener('hashchange', handlePotentialUrlChange)
window.setInterval(handlePotentialUrlChange, 750)

if (browser?.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[SETTINGS_STORAGE_KEY]) {
      latestSignature = ''
      scheduleScan()
    }
  })
}

lastNavigationPlaceKey = findPlaceKeyFromUrl()
scheduleScan()
