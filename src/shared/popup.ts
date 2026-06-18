/**
 * Google Maps hover-popup extraction + cautious render decisions.
 *
 * The hover popup (the transient tooltip card shown when hovering a map pin or a
 * results-list row) has no reliable Google CID, so we can only treat its content
 * as a *candidate* to match against known places. The DOM extraction here is kept
 * side-effect free (it accepts a `ParentNode`) so it can be unit tested against a
 * static HTML sample.
 */

import { parseRating, parseReviewCount } from './parsing'
import { extractGoogleMapsCid } from './placeIdentity'

export const POPUP_SELECTORS = {
  root: '.Yl28hd',
  content: '.aIFcqe',
  name: '.szh09c.fontHeadlineSmall',
  rating: '.ZkP5Je',
  ratingValue: '.MW4etd',
  reviewCount: '.UY7F9',
  category: '.HVpXgd.fontBodySmall',
} as const

/**
 * Selectors for the "search this area" results list. Each result card is
 * URL-addressable (the `a.hfpxzc` link carries the full place URL with a CID),
 * so matches here can be exact identity matches.
 */
export const RESULTS_SELECTORS = {
  article: 'div[role="article"].Nv2PK',
  link: 'a.hfpxzc',
  name: '.qBF1Pd.fontHeadlineSmall',
  rating: '.ZkP5Je',
  ratingValue: '.MW4etd',
  reviewCount: '.UY7F9',
  detailLine: '.W4Efsd',
} as const

export type PopupMatchConfidence = 'exact' | 'high' | 'low' | 'none'

export type PopupMatchPlace = {
  name: string | null
  sourceUrl: string
  lastObservedAt: string | null
  rating: number
  displayedRating: number
  reviewCount: number
  removedRange: { min: number; max: number; isOpenEnded: boolean } | null
  starBreakdown: { 1: number; 2: number; 3: number; 4: number; 5: number } | null
}

export type PopupMatch = {
  confidence: PopupMatchConfidence
  reason: string
  place: PopupMatchPlace | null
}

export type PopupMatchResponse = {
  matches: PopupMatch[]
}

export type PopupCandidate = {
  name: string
  displayedRating: number
  reviewCount: number
  businessCategory?: string
  /**
   * Reliable Google CID (decimal). Only available for the sidebar overview,
   * which is URL-addressable; the hover popup never has one.
   */
  cid?: string
}

export type PopupExtraction = {
  candidate: PopupCandidate
  popupRoot: HTMLElement
  ratingAnchor: HTMLElement
}

export type ResultExtraction = {
  candidate: PopupCandidate
  articleRoot: HTMLElement
  ratingAnchor: HTMLElement
  /** Element whose native click opens the place panel (the card's overlay link). */
  openTarget: HTMLElement
}

export type PopupRenderPlan = 'value' | 'cautious' | 'cta'

const normalizeText = (value: string | null | undefined): string | undefined => {
  const normalized = value?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

const parseParenthesizedCount = (text: string | null | undefined): number | null => {
  if (!text) {
    return null
  }

  const digits = text.replace(/\u00a0/g, ' ').match(/\d[\d.,\s]*/)?.[0]
  if (!digits) {
    return null
  }

  const count = Number.parseInt(digits.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(count) && count >= 0 ? count : null
}

/**
 * Pure text → candidate parser. Kept separate from the DOM walk so the parsing
 * rules can be unit tested without a DOM.
 */
export const parsePopupCandidateFields = (fields: {
  name?: string | null
  ratingLabel?: string | null
  ratingValueText?: string | null
  reviewCountText?: string | null
  categoryText?: string | null
}): PopupCandidate | null => {
  const name = normalizeText(fields.name)
  if (!name) {
    return null
  }

  const displayedRating = parseRating(fields.ratingLabel) ?? parseRating(fields.ratingValueText)
  if (displayedRating === null) {
    return null
  }

  const reviewCount =
    parseReviewCount(fields.ratingLabel) ?? parseParenthesizedCount(fields.reviewCountText)
  if (reviewCount === null) {
    return null
  }

  return {
    name,
    displayedRating,
    reviewCount,
    businessCategory: normalizeText(fields.categoryText),
  }
}

const isPopupRootVisible = (root: HTMLElement): boolean => {
  if (root.style.display === 'none' || root.getAttribute('aria-hidden') === 'true') {
    return false
  }

  return Boolean(root.querySelector(POPUP_SELECTORS.content))
}

/**
 * Extract every visible hover-popup candidate from the given root (defaults to
 * `document`). Returns the parsed candidate plus the DOM nodes needed to anchor a
 * rendered badge next to the popup's star rating.
 */
export const extractPopupCandidates = (root: ParentNode = document): PopupExtraction[] => {
  const extractions: PopupExtraction[] = []

  for (const popupRoot of Array.from(root.querySelectorAll<HTMLElement>(POPUP_SELECTORS.root))) {
    if (!isPopupRootVisible(popupRoot)) {
      continue
    }

    const ratingAnchor = popupRoot.querySelector<HTMLElement>(POPUP_SELECTORS.rating)
    if (!ratingAnchor) {
      continue
    }

    const nameElement = popupRoot.querySelector<HTMLElement>(POPUP_SELECTORS.name)
    const categoryElement = popupRoot.querySelector<HTMLElement>(POPUP_SELECTORS.category)

    const candidate = parsePopupCandidateFields({
      name: nameElement?.getAttribute('aria-label') ?? nameElement?.textContent,
      ratingLabel: ratingAnchor.getAttribute('aria-label'),
      ratingValueText: ratingAnchor.querySelector(POPUP_SELECTORS.ratingValue)?.textContent,
      reviewCountText: ratingAnchor.querySelector(POPUP_SELECTORS.reviewCount)?.textContent,
      categoryText: categoryElement?.querySelector('span')?.textContent ?? categoryElement?.textContent,
    })

    if (candidate) {
      extractions.push({ candidate, popupRoot, ratingAnchor })
    }
  }

  return extractions
}

/**
 * Extract the business category from a results card. The category sits in a
 * `.W4Efsd` block that does *not* contain the star rating, as a `span > span`
 * text node (e.g. "Restaurant").
 */
const extractResultCategory = (article: HTMLElement): string | undefined => {
  for (const block of Array.from(article.querySelectorAll<HTMLElement>(RESULTS_SELECTORS.detailLine))) {
    if (block.querySelector(RESULTS_SELECTORS.rating)) {
      continue
    }

    const text = normalizeText(block.querySelector('span > span')?.textContent)
    if (text && !/\d/.test(text)) {
      return text
    }
  }

  return undefined
}

/**
 * Extract every result card from the "search this area" list. Each card exposes
 * a full place URL, so the candidate carries a reliable CID for exact matching.
 */
export const extractResultsCandidates = (root: ParentNode = document): ResultExtraction[] => {
  const extractions: ResultExtraction[] = []

  for (const article of Array.from(root.querySelectorAll<HTMLElement>(RESULTS_SELECTORS.article))) {
    const link = article.querySelector<HTMLAnchorElement>(RESULTS_SELECTORS.link)
    const ratingAnchor = article.querySelector<HTMLElement>(RESULTS_SELECTORS.rating)
    if (!link || !ratingAnchor) {
      continue
    }

    const nameElement = article.querySelector<HTMLElement>(RESULTS_SELECTORS.name)

    const candidate = parsePopupCandidateFields({
      name: nameElement?.textContent,
      ratingLabel: ratingAnchor.getAttribute('aria-label'),
      ratingValueText: ratingAnchor.querySelector(RESULTS_SELECTORS.ratingValue)?.textContent,
      reviewCountText: ratingAnchor.querySelector(RESULTS_SELECTORS.reviewCount)?.textContent,
      categoryText: extractResultCategory(article),
    })

    if (!candidate) {
      continue
    }

    candidate.cid = extractGoogleMapsCid(link.href)

    extractions.push({
      candidate,
      articleRoot: article,
      ratingAnchor,
      openTarget: link,
    })
  }

  return extractions
}

/**
 * Resolve the element whose native click opens the hovered place in Google Maps.
 * The place title opens the place; the rating button must be avoided because it
 * opens an unrelated legal-info tooltip. Fall back to the popup content card,
 * then the popup root.
 */
export const resolvePopupOpenTarget = (extraction: PopupExtraction): HTMLElement =>
  extraction.popupRoot.querySelector<HTMLElement>(POPUP_SELECTORS.name) ??
  extraction.popupRoot.querySelector<HTMLElement>(POPUP_SELECTORS.content) ??
  extraction.popupRoot

export const popupCandidateCacheKey = (candidate: PopupCandidate): string =>
  [
    candidate.name.toLowerCase(),
    candidate.reviewCount,
    (candidate.businessCategory ?? '').toLowerCase(),
  ].join('|')

/**
 * Decide how cautiously to surface a match next to the popup stars:
 * - `value`: confident enough to show the last known ECHTSTERN estimate.
 * - `cautious`: a likely match, shown with a softer label.
 * - `cta`: no usable match, invite the user to check ECHTSTERN.
 */
export const decidePopupRender = (match: PopupMatch | null | undefined): PopupRenderPlan => {
  if (!match || !match.place) {
    return 'cta'
  }

  if (match.confidence === 'exact' || match.confidence === 'high') {
    return 'value'
  }

  if (match.confidence === 'low') {
    return 'cautious'
  }

  return 'cta'
}
