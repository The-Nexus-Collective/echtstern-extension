import { browser, hasBrowserLocalStorage } from '../shared/browserApi'
import { buildNoRemovedReviewsEstimate, calculateEstimate } from '../shared/estimate'
import { formatRating } from '../shared/format'
import { getMessages, localeToIntl, resolveLocaleSetting, type Locale, type Messages } from '../shared/i18n'
import { LATEST_CONTEXT_STORAGE_KEY, LATEST_ESTIMATE_STORAGE_KEY, loadSettings, SETTINGS_STORAGE_KEY } from '../shared/settings'
import {
  API_BASE_URL,
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
import { extractGoogleMapsCid, placeKeyFromUrl } from '../shared/placeIdentity'
import { isReviewsContext } from '../shared/reviewsContext'
import {
  decidePopupRender,
  extractPopupCandidates,
  extractResultsCandidates,
  popupCandidateCacheKey,
  resolvePopupOpenTarget,
  type PopupCandidate,
  type PopupExtraction,
  type PopupMatch,
  type PopupMatchPlace,
  type ResultExtraction,
} from '../shared/popup'

const LEGACY_BANNER_ID = 'echtstern-estimate-banner'
const TRIGGER_ID = 'echtstern-popup-trigger'
const TRIGGER_SPACER_BEFORE_ID = 'echtstern-popup-trigger-spacer-before'
const INLINE_CARD_ID = 'echtstern-inline-card'
const INLINE_CARD_SPACER_BEFORE_ID = 'echtstern-inline-card-spacer-before'
const OUTSIDE_GERMANY_CARD_ID = 'echtstern-outside-germany-card'
const OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID = 'echtstern-outside-germany-card-spacer-before'
const STATUS_BADGE_ID = 'echtstern-rating-status'
const STYLE_ID = 'echtstern-content-style'
const POPUP_BADGE_CLASS = 'echtstern-popup-badge'
const SIDEBAR_BADGE_ID = 'echtstern-sidebar-badge'

// Local-only debug overlay: enabled only for local builds (the `:local` scripts point
// the extension at a localhost API). Production builds leave it off automatically.
const DEBUG_OVERLAY_ENABLED = /localhost|127\.0\.0\.1/i.test(
  (import.meta.env.VITE_ECHTSTERN_API_BASE_URL as string | undefined) ?? '',
)
const DEBUG_OVERLAY_ID = 'echtstern-debug-overlay'

const STAR_VALUES_DESC: StarValue[] = [5, 4, 3, 2, 1]
const OUTSIDE_GERMANY_SIGNATURE = 'outside-germany'
const NO_REMOVALS_TRACKING_STABILIZATION_MS = 2_000
const POPUP_SCAN_DEBOUNCE_MS = 400
const POPUP_SIMULATION_COUNT = 2_000
const POPUP_MATCH_BATCH_SIZE = 10
const POPUP_OPEN_REVIEWS_POLL_MS = 200
const POPUP_OPEN_REVIEWS_MAX_ATTEMPTS = 40
const POPUP_OPEN_REVIEWS_STABLE_TICKS = 3
const REVIEWS_TAB_LABEL_PATTERN = /(rezensionen|reviews)/i
const POPUP_SEARCH_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>'
const POPUP_INFO_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'

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
let latestWebsiteUrlPlaceKey = ''
let latestWebsiteUrl: string | undefined
let latestWebsiteChecked = false
let debugCategoryCapturedAt: string | undefined
let debugWebsiteCapturedAt: string | undefined
let debugLastSend = '—'
let debugLastPayload: ObservationPayload | null = null
let debugLastPayloadAt: string | undefined
let debounceTimer: number | undefined
let noRemovalsTrackingTimer: number | undefined
let noRemovalsTrackingCandidate: NoRemovalsTrackingCandidate | undefined
let lastScanStartedAt = 0
let lastObservedUrl = location.href
let lastNavigationPlaceKey: string | undefined
let observer: MutationObserver | null = null
let popupDebounceTimer: number | undefined
const popupMatchCache = new Map<string, PopupMatch | null>()
const popupPendingKeys = new Set<string>()
const cidMatchCache = new Map<string, PopupMatch | null>()
const cidPendingKeys = new Set<string>()

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
      `#${LEGACY_BANNER_ID}, #${TRIGGER_ID}, #${TRIGGER_SPACER_BEFORE_ID}, #${INLINE_CARD_ID}, #${INLINE_CARD_SPACER_BEFORE_ID}, #${OUTSIDE_GERMANY_CARD_ID}, #${OUTSIDE_GERMANY_CARD_SPACER_BEFORE_ID}, #${STATUS_BADGE_ID}, #${STYLE_ID}, #${DEBUG_OVERLAY_ID}, .${POPUP_BADGE_CLASS}`,
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

    .${POPUP_BADGE_CLASS} {
      align-items: center;
      background: #f7fbff;
      border: 1px solid #202124;
      border-radius: 999px;
      color: #202124;
      cursor: pointer;
      display: inline-flex;
      font-family: Roboto, Arial, sans-serif;
      gap: 6px;
      line-height: 1;
      margin-top: 6px;
      max-width: 100%;
      padding: 4px 10px;
      text-align: left;
      white-space: nowrap;
    }

    .${POPUP_BADGE_CLASS}:hover {
      background: #eef3f8;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-score {
      font-size: 14px;
      font-weight: 700;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-stars {
      display: inline-block;
      font-size: 13px;
      height: 13px;
      letter-spacing: 1px;
      line-height: 1;
      position: relative;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-stars-track {
      color: #dadce0;
      display: inline-block;
      white-space: nowrap;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-stars-fill {
      color: #fbbc04;
      display: inline-block;
      left: 0;
      overflow: hidden;
      position: absolute;
      top: 0;
      white-space: nowrap;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-cta-text {
      font-size: 12px;
      font-weight: 700;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-info,
    .${POPUP_BADGE_CLASS} .ec-popup-action {
      align-items: center;
      display: inline-flex;
      flex: 0 0 auto;
    }

    .${POPUP_BADGE_CLASS} .ec-popup-info { color: #5f6368; }
    .${POPUP_BADGE_CLASS} .ec-popup-action { color: #1a73e8; }

    .${POPUP_BADGE_CLASS} .ec-popup-info svg,
    .${POPUP_BADGE_CLASS} .ec-popup-action svg {
      display: block;
      height: 16px;
      width: 16px;
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

const collectActiveTabLabels = (): string[] => {
  const labels: string[] = []
  for (const selector of GOOGLE_MAPS_SELECTORS.activeTabCandidates) {
    for (const tab of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      labels.push(`${tab.getAttribute('aria-label') ?? ''} ${tab.textContent ?? ''}`)
    }
  }
  return labels
}

const isReviewsTabActive = (): boolean =>
  isReviewsContext({ activeTabLabels: collectActiveTabLabels(), href: location.href })

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

const TRACKING_QUERY_PARAMS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'yclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
])

const isTrackingParam = (key: string): boolean =>
  /^utm_/i.test(key) || TRACKING_QUERY_PARAMS.has(key.toLowerCase())

const normalizeWebsiteUrl = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim()
  if (!trimmed || !/^https?:\/\//i.test(trimmed) || trimmed.length > 2_000) {
    return undefined
  }

  try {
    const url = new URL(trimmed)
    for (const key of [...url.searchParams.keys()]) {
      if (isTrackingParam(key)) {
        url.searchParams.delete(key)
      }
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

// Proxy for "the overview info section is rendered": these rows render together
// with the website row, so their presence + a missing website link means the
// place genuinely has no website.
const isOverviewInfoLoaded = (): boolean =>
  Boolean(document.querySelector('[data-item-id="address"], [data-item-id="oloc"]'))

const GOOGLE_HOST_PATTERN = /(?:^|\.)google\.[a-z.]+$/i
const REDIRECT_TARGET_PARAMS = ['adurl', 'url', 'q', 'dest', 'continue']

// Google sometimes wraps the website link in an ad/redirect URL like
// `https://www.google.com/aclk?…&adurl=…`. Recover the real target from the query
// params when present.
const isGoogleRedirectUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return (
      GOOGLE_HOST_PATTERN.test(url.hostname) &&
      (/^\/(aclk|url|searchredirect)/i.test(url.pathname) ||
        REDIRECT_TARGET_PARAMS.some((key) => url.searchParams.has(key)))
    )
  } catch {
    return false
  }
}

const unwrapGoogleRedirect = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl)
    if (!isGoogleRedirectUrl(rawUrl)) {
      return rawUrl
    }
    for (const key of REDIRECT_TARGET_PARAMS) {
      const target = url.searchParams.get(key)
      if (target && /^https?:\/\//i.test(target)) {
        return target
      }
    }
    return rawUrl
  } catch {
    return rawUrl
  }
}

const DOMAIN_TOKEN_PATTERN =
  /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(\/[^\s]*)?$/i

// When the href is an unrecoverable Google redirect, the real domain is still shown as
// the link's aria-label ("Website: shalimar-ulm.de") or visible text ("shalimar-ulm.de").
const websiteUrlFromDisplayText = (anchor: HTMLAnchorElement): string | undefined => {
  const sources = [
    anchor.getAttribute('aria-label')?.replace(/^[^:]*:\s*/, ''),
    anchor.querySelector('.Io6YTe')?.textContent,
    anchor.textContent,
  ]

  for (const source of sources) {
    const token = source?.replace(/\s+/g, ' ').trim().split(' ')[0]
    const match = token ? DOMAIN_TOKEN_PATTERN.exec(token) : null
    if (match) {
      return `https://${match[1]}${match[2] ?? ''}`
    }
  }

  return undefined
}

const findVisibleWebsiteUrl = (): string | undefined => {
  for (const selector of GOOGLE_MAPS_SELECTORS.websiteLinkCandidates) {
    const anchor = document.querySelector<HTMLAnchorElement>(selector)
    if (!anchor) {
      continue
    }

    const rawHref = anchor.getAttribute('href')
    if (rawHref) {
      const normalized = normalizeWebsiteUrl(unwrapGoogleRedirect(rawHref))
      if (normalized && !isGoogleRedirectUrl(normalized)) {
        return normalized
      }
    }

    // href missing or an unrecoverable Google redirect → use the displayed domain.
    const fromDisplayText = normalizeWebsiteUrl(websiteUrlFromDisplayText(anchor))
    if (fromDisplayText) {
      return fromDisplayText
    }
  }

  return undefined
}

// TODO: temporary local debug overlay – remove once link/category scraping is verified.
const renderDebugOverlay = () => {
  if (!DEBUG_OVERLAY_ENABLED) {
    return
  }

  let overlay = document.getElementById(DEBUG_OVERLAY_ID)
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = DEBUG_OVERLAY_ID
    overlay.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:2147483647',
      'max-width:380px',
      'padding:8px 10px',
      'background:rgba(17,17,17,0.9)',
      'color:#fff',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'border-radius:8px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
      'pointer-events:none',
      'white-space:pre-wrap',
      'word-break:break-all',
    ].join(';')
    document.documentElement.append(overlay)
  }

  const liveWebsite = findVisibleWebsiteUrl()
  const liveCategory = findVisibleBusinessCategory()
  const currentPlaceKey = findPlaceKey()
  const liveUrlName = findPlaceNameFromUrl()
  const liveDomName = findVisiblePlaceName()
  const reviewsActive = (() => {
    try {
      return isReviewsTabActive()
    } catch {
      return false
    }
  })()

  const websiteAnchorCount = GOOGLE_MAPS_SELECTORS.websiteLinkCandidates.reduce(
    (total, selector) => total + document.querySelectorAll(selector).length,
    0,
  )
  const rawAuthorityHref =
    document.querySelector<HTMLAnchorElement>('a[data-item-id="authority"]')?.getAttribute('href') ?? '—'

  const payload = debugLastPayload
  const starBreakdown = payload?.starBreakdown
  const payloadLines = payload
    ? [
        `payload @ ${debugLastPayloadAt ?? '—'}`,
        `  placeKey: ${payload.placeKey}`,
        `  placeName: ${payload.placeName ?? '⟨FEHLT⟩'}`,
        `  category: ${payload.businessCategory ?? '—'}`,
        `  websiteUrl: ${payload.websiteUrl ?? '—'}`,
        `  websiteChecked: ${payload.websiteChecked ? 'ja' : 'nein'}`,
        `  rating: ${payload.rating}  angezeigt: ${payload.displayedRating}  count: ${payload.reviewCount}`,
        `  coords: ${payload.latitude ?? '—'}, ${payload.longitude ?? '—'}`,
        `  removedRange: ${
          payload.removedRange
            ? `${payload.removedRange.min}–${payload.removedRange.max}${payload.removedRange.isOpenEnded ? '+' : ''}`
            : '—'
        }`,
        `  stars(1-5): ${
          starBreakdown ? ([1, 2, 3, 4, 5] as const).map((star) => starBreakdown[star] ?? '·').join('/') : '—'
        }`,
        `  locale: ${payload.locale}`,
      ]
    : ['payload: (noch nichts vorbereitet)']

  const extensionVersion = (() => {
    try {
      return browser?.runtime?.getManifest?.().version ?? '?'
    } catch {
      return '?'
    }
  })()

  overlay.textContent = [
    `ECHTSTERN DEBUG v${extensionVersion} (Cache)`,
    `tab: ${reviewsActive ? 'Rezensionen' : 'Übersicht/andere'}`,
    `placeKey (live): ${currentPlaceKey || '—'}`,
    `placeKey (last): ${latestPlaceKey || '—'}`,
    `name (url): ${liveUrlName ?? '—'}`,
    `name (dom): ${liveDomName ?? '—'}`,
    `category (live): ${liveCategory ?? '—'}`,
    `category (cached): ${latestBusinessCategory ?? '—'}${debugCategoryCapturedAt ? ` @ ${debugCategoryCapturedAt}` : ''}`,
    `website (live): ${liveWebsite ?? '—'}`,
    `website (cached): ${latestWebsiteUrl ?? (latestWebsiteChecked ? 'keine (geprüft)' : '—')}${debugWebsiteCapturedAt ? ` @ ${debugWebsiteCapturedAt}` : ''}`,
    `website cachedKey: ${latestWebsiteUrlPlaceKey || '—'}`,
    `authority anchors: ${websiteAnchorCount}`,
    `authority href (raw): ${rawAuthorityHref}`,
    `api: ${API_BASE_URL}`,
    `lastSend: ${debugLastSend}`,
    '— letzte gespeicherte Daten —',
    ...payloadLines,
  ].join('\n')
}

const titleCaseGoogleCategorySlug = (slug: string): string | undefined => {
  const words = slug
    .split('_')
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) {
    return undefined
  }

  return words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ')
}

const decodeGoogleMapsUrlSafeBase64Bytes = (value: string): Uint8Array | undefined => {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
}

const decodeGoogleMapsCategorySlug = (bytes: Uint8Array): string | undefined => {
  const categoryFieldMarker = [0x73, 0x92, 0x01]

  for (let index = 0; index < bytes.length - categoryFieldMarker.length; index += 1) {
    const isCategoryField = categoryFieldMarker.every((byte, offset) => bytes[index + offset] === byte)
    if (!isCategoryField) {
      continue
    }

    const categoryLength = bytes[index + categoryFieldMarker.length]
    const categoryStart = index + categoryFieldMarker.length + 1
    const categoryEnd = categoryStart + categoryLength
    if (categoryLength === 0 || categoryLength > 80 || categoryEnd > bytes.length) {
      continue
    }

    const categoryBytes = bytes.slice(categoryStart, categoryEnd)
    const isGoogleCategorySlug = categoryBytes.every(
      (byte) => (byte >= 97 && byte <= 122) || byte === 95,
    )
    if (!isGoogleCategorySlug) {
      continue
    }

    const slug = new TextDecoder().decode(categoryBytes)
    if (slug !== 'restaurants') {
      return slug
    }
  }

  return undefined
}

const decodeGoogleMapsUrlToken = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).trim()
  } catch {
    return undefined
  }
}

const findBusinessCategoryFromSearchCategoryUrl = (): string | undefined => {
  const searchCategoryCandidates = Array.from(location.href.matchAll(/!1s([^!?#&]+)!6e5/g))
    .map((match) => (match[1] ? decodeGoogleMapsUrlToken(match[1]) : undefined))
    .filter((category): category is string => Boolean(category))

  for (const category of searchCategoryCandidates.reverse()) {
    if (/^restaurants?$/i.test(category)) {
      return 'Restaurant'
    }
  }

  return undefined
}

const findBusinessCategoryFromUrl = (): string | undefined => {
  const encodedCategoryCandidates = Array.from(location.href.matchAll(/!15s([^!?#&]+)/g))
    .map((match) => match[1])
    .filter(Boolean)

  for (const encoded of encodedCategoryCandidates.reverse()) {
    const bytes = decodeGoogleMapsUrlSafeBase64Bytes(encoded)
    const slug = bytes ? decodeGoogleMapsCategorySlug(bytes) : undefined

    if (slug) {
      return titleCaseGoogleCategorySlug(slug)
    }
  }

  return findBusinessCategoryFromSearchCategoryUrl()
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

const findPlaceKeyFromUrl = (): string | undefined => placeKeyFromUrl(location.href)

const stripTrailingEllipsis = (value: string): string =>
  value.replace(/(\u2026|\.{3})\s*$/u, '').trim()

// During a profile switch Google updates the URL (and therefore the place key) before
// the panel content. If the visible place name does not match the URL place name we are
// mid-transition and the rating/review DOM still belongs to the previous place, so we
// must not persist an observation with that stale data.
const isPlaceContextConsistent = (): boolean => {
  const urlName = findPlaceNameFromUrl()
  const domName = findVisiblePlaceName()

  if (!urlName || !domName) {
    return true
  }

  const normalizedUrlName = stripTrailingEllipsis(urlName).toLowerCase()
  const normalizedDomName = stripTrailingEllipsis(domName).toLowerCase()

  if (!normalizedUrlName || !normalizedDomName) {
    return true
  }

  return (
    normalizedUrlName.startsWith(normalizedDomName) ||
    normalizedDomName.startsWith(normalizedUrlName)
  )
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
    latestWebsiteUrlPlaceKey = ''
    latestWebsiteUrl = undefined
    latestWebsiteChecked = false
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

  const urlBusinessCategory = findBusinessCategoryFromUrl()
  // The visible (DOM) category can still belong to the previous place during a profile
  // switch, so only trust it once the panel has settled (URL/DOM name consistent). The
  // URL-derived category is always tied to the current place and stays trusted.
  const visibleBusinessCategory = isPlaceContextConsistent() ? findVisibleBusinessCategory() : undefined
  const currentBusinessCategory = visibleBusinessCategory ?? urlBusinessCategory
  if (currentBusinessCategory) {
    if (currentBusinessCategory !== latestBusinessCategory) {
      debugCategoryCapturedAt = new Date().toLocaleTimeString()
    }
    latestBusinessCategoryPlaceKey = placeKey
    latestBusinessCategory = currentBusinessCategory
  }

  const rememberedBusinessCategory = latestBusinessCategoryPlaceKey === placeKey ? latestBusinessCategory : undefined

  return rememberedBusinessCategory
}

type WebsiteCapture = { websiteUrl?: string; websiteChecked: boolean }

const rememberWebsiteUrl = (placeKey = findPlaceKey()): WebsiteCapture => {
  if (!placeKey) {
    return { websiteChecked: false }
  }

  // Only read the website from a settled panel. During a profile switch the previous
  // place's website row can still be in the DOM; capturing it would attribute the wrong
  // website to the new place (and it would then stick on the server via COALESCE).
  if (isPlaceContextConsistent()) {
    const currentWebsiteUrl = findVisibleWebsiteUrl()

    if (currentWebsiteUrl) {
      if (currentWebsiteUrl !== latestWebsiteUrl) {
        debugWebsiteCapturedAt = new Date().toLocaleTimeString()
      }
      latestWebsiteUrlPlaceKey = placeKey
      latestWebsiteUrl = currentWebsiteUrl
      latestWebsiteChecked = true
    } else if (isOverviewInfoLoaded()) {
      // Overview is loaded but no website link exists → confirmed "checked, no website".
      // Never drop a real URL already captured for this place.
      if (!latestWebsiteChecked || latestWebsiteUrlPlaceKey !== placeKey) {
        debugWebsiteCapturedAt = new Date().toLocaleTimeString()
      }
      latestWebsiteUrlPlaceKey = placeKey
      latestWebsiteChecked = true
    }
  }

  if (latestWebsiteUrlPlaceKey !== placeKey) {
    return { websiteChecked: false }
  }

  return { websiteUrl: latestWebsiteUrl, websiteChecked: latestWebsiteChecked }
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

const sendObservationViaBackground = async (
  payload: ObservationPayload,
): Promise<{ ok: boolean; retryable: boolean }> => {
  if (!browser?.runtime?.sendMessage) {
    logTracking('Cannot send observation: runtime.sendMessage unavailable')
    return { ok: false, retryable: false }
  }

  let response: unknown
  try {
    response = await browser.runtime.sendMessage({
      type: 'SEND_ECHTSTERN_OBSERVATION',
      payload,
    })
  } catch (error) {
    logUnexpectedExtensionError('Observation background message failed', error)
    return { ok: false, retryable: false }
  }

  const result = response as { ok?: boolean; retryable?: boolean } | undefined
  logTracking('Background observation result', response)
  return { ok: Boolean(result?.ok), retryable: Boolean(result?.retryable) }
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

  if (!isPlaceContextConsistent()) {
    logTracking('Skipped observation: place context not settled (URL/DOM name mismatch)', {
      placeKey: placeIdentity.key,
    })
    return null
  }

  const hasRemovedRange = result.noRemovedReviews !== true
  const installId = await ensureInstallId()
  if (!installId) {
    logTracking('Skipped observation: no install id available')
    return null
  }

  const coordinates = findCoordinatesFromUrl()
  const businessCategory = rememberBusinessCategory(placeIdentity.key)
  const { websiteUrl, websiteChecked } = rememberWebsiteUrl(placeIdentity.key)

  const payload = buildObservationPayload({
    result,
    placeKey: placeIdentity.key,
    placeName: placeIdentity.name,
    businessCategory,
    websiteUrl,
    websiteChecked,
    sourceUrl: location.href,
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    locale,
    installId,
  })

  // Debug: remember the exact payload that will be sent so the overlay can show it.
  debugLastPayload = payload
  debugLastPayloadAt = new Date().toLocaleTimeString()
  renderDebugOverlay()

  return {
    hasRemovedRange,
    payload,
    placeKey: placeIdentity.key,
  }
}

const sendPreparedObservation = async ({ hasRemovedRange, payload, placeKey }: PreparedObservation) => {
  const shouldSend = await shouldSendObservation(placeKey, { hasRemovedRange })
  if (!shouldSend) {
    logTracking('Skipped observation: local throttle active', { hasRemovedRange, placeKey })
    // TODO: temporary debug – remove once website scraping is verified.
    debugLastSend = `${new Date().toLocaleTimeString()} throttled (web=${payload.websiteUrl ? 'y' : 'n'})`
    renderDebugOverlay()
    return
  }

  logTracking('Prepared observation payload', payload)

  try {
    const { ok, retryable } = await sendObservationViaBackground(payload)
    // TODO: temporary debug – remove once website scraping is verified.
    debugLastSend = `${new Date().toLocaleTimeString()} ok=${ok}${retryable ? ' retryable' : ''} (web=${payload.websiteUrl ? 'y' : 'n'})`
    renderDebugOverlay()
    if (ok && !retryable) {
      await markObservationSent(placeKey, { hasRemovedRange })
      logTracking('Observation sent and throttle updated', { hasRemovedRange, placeKey })
    } else if (retryable) {
      // Server could not persist yet (e.g. cid-only URL without coordinates).
      // Do not throttle so the next scan re-sends once the URL resolves.
      logTracking('Observation deferred for retry; throttle not updated', { placeKey })
    } else {
      logTracking('Observation not accepted by background/API', { placeKey })
    }
  } catch (error) {
    // Tracking must never affect the Google Maps UI.
    logTracking('Observation send failed in content script', error)
    // TODO: temporary debug – remove once website scraping is verified.
    debugLastSend = `${new Date().toLocaleTimeString()} error`
    renderDebugOverlay()
  }
}

const maybeSendObservation = async (result: EstimateResult, locale: Locale, shareAnonymousStats: boolean) => {
  const preparedObservation = await prepareObservation(result, locale, shareAnonymousStats)
  if (preparedObservation) {
    await sendPreparedObservation(preparedObservation)
  }
}

const flushNoRemovalsTrackingCandidate = (reason: string) => {
  const candidate = noRemovalsTrackingCandidate
  clearNoRemovalsTrackingCandidate()

  if (candidate) {
    void reason
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
    flushNoRemovalsTrackingCandidate('stable_elapsed')
    return
  }

  if (noRemovalsTrackingTimer === undefined) {
    noRemovalsTrackingTimer = window.setTimeout(() => {
      noRemovalsTrackingTimer = undefined
      scheduleScan()
    }, NO_REMOVALS_TRACKING_STABILIZATION_MS - elapsed)
  }
}

const fetchPopupMatchesViaBackground = async (
  candidates: PopupCandidate[],
): Promise<PopupMatch[] | null> => {
  if (!browser?.runtime?.sendMessage) {
    return null
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: 'FETCH_ECHTSTERN_MATCHES',
      candidates,
    })
    const typed = response as { ok?: boolean; matches?: PopupMatch[] } | undefined
    if (!typed?.ok || !Array.isArray(typed.matches)) {
      return null
    }
    return typed.matches
  } catch (error) {
    logUnexpectedExtensionError('Popup match request failed', error)
    return null
  }
}

const estimatePopupRating = (
  place: PopupMatchPlace,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  noRemovedReviewsLabel: string,
): number => {
  const starBreakdown = place.starBreakdown ?? undefined

  if (!place.removedRange) {
    return buildNoRemovedReviewsEstimate(
      {
        rating: place.rating,
        displayedRating: place.displayedRating,
        reviewCount: place.reviewCount,
        starBreakdown,
      },
      settings.weights,
      {
        defamationQuotaPercent: settings.defamationQuotaPercent,
        noRemovedReviewsLabel,
      },
    ).median
  }

  return calculateEstimate(
    {
      rating: place.rating,
      displayedRating: place.displayedRating,
      reviewCount: place.reviewCount,
      removedRange: {
        min: place.removedRange.min,
        max: place.removedRange.max,
        label: '',
        isOpenEnded: place.removedRange.isOpenEnded,
      },
      starBreakdown,
    },
    settings.weights,
    {
      defamationQuotaPercent: settings.defamationQuotaPercent,
      simulationCount: POPUP_SIMULATION_COUNT,
    },
  ).median
}

const openEchtsternPopup = () => {
  void browser?.runtime
    .sendMessage({ type: 'OPEN_ECHTSTERN_POPUP' })
    .catch((error: unknown) => logUnexpectedExtensionError('Open popup message failed', error))
}

const dispatchSyntheticClick = (element: HTMLElement) => {
  const eventInit: MouseEventInit = { bubbles: true, cancelable: true, view: window }

  // Google Maps wires its handlers via jsaction, which often needs the full
  // pointer/mouse sequence (not just a bare click) to reliably fire.
  if (typeof PointerEvent !== 'undefined') {
    element.dispatchEvent(new PointerEvent('pointerdown', eventInit))
  }
  element.dispatchEvent(new MouseEvent('mousedown', eventInit))
  if (typeof PointerEvent !== 'undefined') {
    element.dispatchEvent(new PointerEvent('pointerup', eventInit))
  }
  element.dispatchEvent(new MouseEvent('mouseup', eventInit))
  element.dispatchEvent(new MouseEvent('click', eventInit))
}

const findReviewsTab = (): HTMLElement | null => {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('button[role="tab"], [role="tab"]'))
  return (
    tabs.find((tab) =>
      REVIEWS_TAB_LABEL_PATTERN.test(`${tab.getAttribute('aria-label') ?? ''} ${tab.textContent ?? ''}`),
    ) ?? null
  )
}

/**
 * Switch the currently open place panel to its reviews tab. Google re-renders the
 * panel asynchronously and can reset it back to the overview tab after our first
 * click, so keep re-clicking until the reviews tab stays selected for a couple of
 * ticks (or we run out of attempts).
 */
const switchToReviewsTab = () => {
  let attempts = 0
  let stableSelectedTicks = 0
  const timer = window.setInterval(() => {
    attempts += 1

    const reviewsTab = findReviewsTab()
    if (reviewsTab) {
      if (reviewsTab.getAttribute('aria-selected') === 'true') {
        stableSelectedTicks += 1
        if (stableSelectedTicks >= POPUP_OPEN_REVIEWS_STABLE_TICKS) {
          window.clearInterval(timer)
          return
        }
      } else {
        stableSelectedTicks = 0
        try {
          dispatchSyntheticClick(reviewsTab)
        } catch (error) {
          logUnexpectedExtensionError('Switching to reviews tab failed', error)
        }
      }
    }

    if (attempts >= POPUP_OPEN_REVIEWS_MAX_ATTEMPTS) {
      window.clearInterval(timer)
    }
  }, POPUP_OPEN_REVIEWS_POLL_MS)
}

/**
 * Open a place by replaying a native click on its panel/card handle, then switch
 * to the reviews tab so the user lands where ECHTSTERN data is shown.
 */
const openPlaceAndShowReviews = (openTarget: HTMLElement) => {
  try {
    dispatchSyntheticClick(openTarget)
  } catch (error) {
    logUnexpectedExtensionError('Opening place failed', error)
    openEchtsternPopup()
    return
  }

  switchToReviewsTab()
}

/**
 * Open the hovered place by replaying the popup's own click. The popup exposes no
 * place URL, so this DOM click-through is the only contextual handle we have.
 */
const openHoveredPlaceReviews = (extraction: PopupExtraction) => {
  openPlaceAndShowReviews(resolvePopupOpenTarget(extraction))
}

const buildPopupStars = (rating: number): HTMLElement => {
  const wrapper = document.createElement('span')
  wrapper.className = 'ec-popup-stars'
  wrapper.setAttribute('aria-hidden', 'true')

  const track = document.createElement('span')
  track.className = 'ec-popup-stars-track'
  track.textContent = '★★★★★'
  wrapper.append(track)

  const fill = document.createElement('span')
  fill.className = 'ec-popup-stars-fill'
  fill.textContent = '★★★★★'
  fill.style.width = `${Math.max(0, Math.min(100, (rating / 5) * 100))}%`
  wrapper.append(fill)

  return wrapper
}

const buildPopupIcon = (svg: string, className: string): HTMLElement => {
  const icon = document.createElement('span')
  icon.className = className
  icon.innerHTML = svg
  return icon
}

const formatPopupRemovedRange = (
  removedRange: NonNullable<PopupMatchPlace['removedRange']>,
  locale: Locale,
): string => {
  if (removedRange.isOpenEnded) {
    const threshold = formatWholeCount(Math.max(0, removedRange.min - 1), locale)
    return locale === 'de' ? `mehr als ${threshold}` : `more than ${threshold}`
  }

  if (removedRange.min === removedRange.max) {
    return formatWholeCount(removedRange.min, locale)
  }

  return `${formatWholeCount(removedRange.min, locale)}–${formatWholeCount(removedRange.max, locale)}`
}

const popupRemovedInfoText = (place: PopupMatchPlace, copy: Messages, locale: Locale): string =>
  place.removedRange
    ? copy.content.popup.removedInfo(formatPopupRemovedRange(place.removedRange, locale))
    : copy.content.popup.noRemovedInfo

/**
 * Build the shared ECHTSTERN badge element (popup + sidebar). Returns the
 * detached button plus a content signature so callers can skip re-inserting an
 * identical badge.
 */
const buildEchtsternBadgeElement = (
  match: PopupMatch | null,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  copy: Messages,
  locale: Locale,
  onActivate: () => void,
): { badge: HTMLButtonElement; signature: string } => {
  const plan = decidePopupRender(match)
  const popupCopy = copy.content.popup
  const place = plan === 'cta' ? null : match?.place ?? null
  const ratingValue = place ? estimatePopupRating(place, settings, copy.estimate.noRemovedReviews) : null
  const ratingText = ratingValue !== null ? formatRating(ratingValue, locale) : ''
  const infoText = place && ratingValue !== null ? popupRemovedInfoText(place, copy, locale) : ''
  const signature = `${plan}|${ratingText}|${infoText}`

  const badge = document.createElement('button')
  badge.type = 'button'
  badge.className = POPUP_BADGE_CLASS
  badge.dataset.signature = signature

  if (!place || ratingValue === null) {
    badge.dataset.variant = 'cta'
    badge.title = popupCopy.cta
    badge.setAttribute('aria-label', popupCopy.cta)

    const text = document.createElement('span')
    text.className = 'ec-popup-cta-text'
    text.textContent = popupCopy.cta
    badge.append(text, buildPopupIcon(POPUP_SEARCH_ICON_SVG, 'ec-popup-action'))
  } else {
    badge.dataset.variant = 'value'
    const ariaLabel = popupCopy.valueAriaLabel(ratingText)
    badge.title = ariaLabel
    badge.setAttribute('aria-label', ariaLabel)

    const score = document.createElement('span')
    score.className = 'ec-popup-score'
    score.textContent = ratingText

    const brand = document.createElement('span')
    brand.className = 'ec-popup-brand'
    brand.textContent = popupCopy.brand

    const info = buildPopupIcon(POPUP_INFO_ICON_SVG, 'ec-popup-info')
    info.setAttribute('role', 'img')
    info.setAttribute('aria-label', infoText)
    info.title = infoText

    const action = buildPopupIcon(POPUP_SEARCH_ICON_SVG, 'ec-popup-action')
    action.setAttribute('role', 'img')
    action.setAttribute('aria-label', popupCopy.openReviewsLabel)
    action.title = popupCopy.openReviewsLabel

    badge.append(score, buildPopupStars(ratingValue), brand, info, action)
  }

  badge.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onActivate()
  })

  return { badge, signature }
}

/**
 * Insert (or refresh) an ECHTSTERN badge inside `root`, anchored after `anchor`.
 * Dedupes by content signature so unchanged badges are left in place.
 */
const renderAnchoredBadge = (
  root: HTMLElement,
  anchor: HTMLElement,
  match: PopupMatch | null,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  copy: Messages,
  locale: Locale,
  onActivate: () => void,
) => {
  const existingBadge = root.querySelector<HTMLElement>(`.${POPUP_BADGE_CLASS}`)
  const { badge, signature } = buildEchtsternBadgeElement(match, settings, copy, locale, onActivate)

  if (existingBadge?.dataset.signature === signature && anchor.parentElement?.contains(existingBadge)) {
    return
  }

  withObserverPaused(() => {
    existingBadge?.remove()
    anchor.insertAdjacentElement('afterend', badge)
  })
}

const renderPopupBadge = (
  extraction: PopupExtraction,
  match: PopupMatch | null,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  copy: Messages,
  locale: Locale,
) => {
  const anchorTarget = extraction.ratingAnchor.closest<HTMLElement>('button') ?? extraction.ratingAnchor
  renderAnchoredBadge(extraction.popupRoot, anchorTarget, match, settings, copy, locale, () =>
    openHoveredPlaceReviews(extraction),
  )
}

const renderResultBadge = (
  extraction: ResultExtraction,
  match: PopupMatch | null,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  copy: Messages,
  locale: Locale,
) => {
  const anchorTarget = extraction.ratingAnchor.closest<HTMLElement>('.W4Efsd') ?? extraction.ratingAnchor
  renderAnchoredBadge(extraction.articleRoot, anchorTarget, match, settings, copy, locale, () =>
    openPlaceAndShowReviews(extraction.openTarget),
  )
}

/**
 * Resolve the category line element in the sidebar overview so we can anchor the
 * badge where the business category is shown. The category is usually a button,
 * but Google sometimes renders it as a plain span.
 */
const findBusinessCategoryElement = (): HTMLElement | null => {
  for (const selector of GOOGLE_MAPS_SELECTORS.businessCategoryCandidates) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element && normalizeBusinessCategory(element.textContent)) {
      return element
    }
  }

  return null
}

type SidebarOverviewExtraction = {
  candidate: PopupCandidate
  anchorLine: HTMLElement
}

/**
 * Extract the open place in the sidebar overview. Unlike the hover popup, this
 * surface is URL-addressable, so we can attach the reliable Google CID and let
 * the backend return an exact identity match.
 */
const extractSidebarOverviewCandidate = (): SidebarOverviewExtraction | null => {
  if (isReviewsTabActive()) {
    return null
  }

  const cid = extractGoogleMapsCid(location.href)
  if (!cid) {
    return null
  }

  const name = findPlaceName()
  if (!name || isGenericGoogleMapsTitle(name)) {
    return null
  }

  const displayedRating = parseRating(findRatingText())
  if (displayedRating === null) {
    return null
  }

  const reviewCount = parseReviewCount(findReviewCountText())
  if (reviewCount === null) {
    return null
  }

  const categoryElement = findBusinessCategoryElement()
  const anchorLine = categoryElement?.closest<HTMLElement>('.fontBodyMedium') ?? categoryElement
  if (!anchorLine) {
    return null
  }

  return {
    candidate: {
      name,
      displayedRating,
      reviewCount,
      businessCategory: normalizeBusinessCategory(categoryElement?.textContent),
      cid,
    },
    anchorLine,
  }
}

const renderSidebarBadge = (
  anchorLine: HTMLElement,
  match: PopupMatch | null,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  copy: Messages,
  locale: Locale,
) => {
  const existingBadge = document.getElementById(SIDEBAR_BADGE_ID)
  const { badge, signature } = buildEchtsternBadgeElement(match, settings, copy, locale, switchToReviewsTab)
  badge.id = SIDEBAR_BADGE_ID

  if (existingBadge?.dataset.signature === signature && anchorLine.parentElement?.contains(existingBadge)) {
    return
  }

  withObserverPaused(() => {
    existingBadge?.remove()
    anchorLine.insertAdjacentElement('afterend', badge)
  })
}

const scanSidebarOverview = async () => {
  let extraction: SidebarOverviewExtraction | null
  try {
    extraction = extractSidebarOverviewCandidate()
  } catch (error) {
    logUnexpectedExtensionError('Sidebar overview extraction failed', error)
    return
  }

  if (!extraction) {
    withObserverPaused(() => document.getElementById(SIDEBAR_BADGE_ID)?.remove())
    return
  }

  injectStyles()

  let settings: Awaited<ReturnType<typeof loadSettings>>
  try {
    settings = await loadSettings()
  } catch (error) {
    logUnexpectedExtensionError('Settings load failed', error)
    return
  }

  const locale = resolveLocaleSetting(settings.locale)
  const copy = getMessages(locale)
  const cacheKey = `cid:${extraction.candidate.cid ?? ''}`

  if (cidMatchCache.has(cacheKey)) {
    renderSidebarBadge(extraction.anchorLine, cidMatchCache.get(cacheKey) ?? null, settings, copy, locale)
    return
  }

  if (cidPendingKeys.has(cacheKey)) {
    return
  }

  cidPendingKeys.add(cacheKey)
  const matches = await fetchPopupMatchesViaBackground([extraction.candidate])
  cidPendingKeys.delete(cacheKey)

  if (!matches) {
    return
  }

  const match = matches[0] ?? null
  cidMatchCache.set(cacheKey, match)

  const current = extractSidebarOverviewCandidate()
  if (current && `cid:${current.candidate.cid ?? ''}` === cacheKey) {
    renderSidebarBadge(current.anchorLine, match, settings, copy, locale)
  }
}

const scanResults = async () => {
  let extractions: ResultExtraction[]
  try {
    extractions = extractResultsCandidates().filter((extraction) => Boolean(extraction.candidate.cid))
  } catch (error) {
    logUnexpectedExtensionError('Results extraction failed', error)
    return
  }

  if (extractions.length === 0) {
    return
  }

  injectStyles()

  let settings: Awaited<ReturnType<typeof loadSettings>>
  try {
    settings = await loadSettings()
  } catch (error) {
    logUnexpectedExtensionError('Settings load failed', error)
    return
  }

  const locale = resolveLocaleSetting(settings.locale)
  const copy = getMessages(locale)
  const cacheKeyFor = (extraction: ResultExtraction) => `cid:${extraction.candidate.cid ?? ''}`

  for (const extraction of extractions) {
    const key = cacheKeyFor(extraction)
    if (cidMatchCache.has(key)) {
      renderResultBadge(extraction, cidMatchCache.get(key) ?? null, settings, copy, locale)
    }
  }

  const uncached = extractions.filter((extraction) => {
    const key = cacheKeyFor(extraction)
    return !cidMatchCache.has(key) && !cidPendingKeys.has(key)
  })

  if (uncached.length === 0) {
    return
  }

  const batch = uncached.slice(0, POPUP_MATCH_BATCH_SIZE)
  const keys = batch.map(cacheKeyFor)
  keys.forEach((key) => cidPendingKeys.add(key))

  const matches = await fetchPopupMatchesViaBackground(batch.map((extraction) => extraction.candidate))

  keys.forEach((key) => cidPendingKeys.delete(key))

  if (!matches) {
    return
  }

  batch.forEach((extraction, index) => {
    cidMatchCache.set(cacheKeyFor(extraction), matches[index] ?? null)
  })

  schedulePopupScan()
}

const scanPopups = async () => {
  let extractions: PopupExtraction[]
  try {
    extractions = extractPopupCandidates()
  } catch (error) {
    logUnexpectedExtensionError('Popup extraction failed', error)
    return
  }

  if (extractions.length === 0) {
    return
  }

  injectStyles()

  let settings: Awaited<ReturnType<typeof loadSettings>>
  try {
    settings = await loadSettings()
  } catch (error) {
    logUnexpectedExtensionError('Settings load failed', error)
    return
  }

  const locale = resolveLocaleSetting(settings.locale)
  const copy = getMessages(locale)

  for (const extraction of extractions) {
    const key = popupCandidateCacheKey(extraction.candidate)
    if (popupMatchCache.has(key)) {
      renderPopupBadge(extraction, popupMatchCache.get(key) ?? null, settings, copy, locale)
    }
  }

  const uncached = extractions.filter((extraction) => {
    const key = popupCandidateCacheKey(extraction.candidate)
    return !popupMatchCache.has(key) && !popupPendingKeys.has(key)
  })

  if (uncached.length === 0) {
    return
  }

  const batch = uncached.slice(0, POPUP_MATCH_BATCH_SIZE)
  const keys = batch.map((extraction) => popupCandidateCacheKey(extraction.candidate))
  keys.forEach((key) => popupPendingKeys.add(key))

  const matches = await fetchPopupMatchesViaBackground(batch.map((extraction) => extraction.candidate))

  keys.forEach((key) => popupPendingKeys.delete(key))

  if (!matches) {
    return
  }

  batch.forEach((extraction, index) => {
    popupMatchCache.set(popupCandidateCacheKey(extraction.candidate), matches[index] ?? null)
  })

  schedulePopupScan()
}

const schedulePopupScan = () => {
  if (popupDebounceTimer !== undefined) {
    return
  }

  popupDebounceTimer = window.setTimeout(() => {
    popupDebounceTimer = undefined
    void scanPopups().catch((error: unknown) => logUnexpectedExtensionError('Popup scan failed', error))
    void scanSidebarOverview().catch((error: unknown) =>
      logUnexpectedExtensionError('Sidebar overview scan failed', error),
    )
    void scanResults().catch((error: unknown) => logUnexpectedExtensionError('Results scan failed', error))
  }, POPUP_SCAN_DEBOUNCE_MS)
}

const scanAndRender = async () => {
  lastScanStartedAt = Date.now()
  rememberPlaceName()
  rememberBusinessCategory()
  rememberWebsiteUrl()
  renderDebugOverlay()
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
  flushNoRemovalsTrackingCandidate('navigation')
  latestSignature = ''
  latestResult = null
  latestPlaceKey = ''
  latestPlaceName = undefined
  latestBusinessCategoryPlaceKey = ''
  latestBusinessCategory = undefined
  latestWebsiteUrlPlaceKey = ''
  latestWebsiteUrl = undefined
  latestWebsiteChecked = false
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
    schedulePopupScan()
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
schedulePopupScan()
