/**
 * Pure helpers for deciding whether we are in a context where the Google Maps
 * "removed reviews" banner would be visible if it existed (i.e. the Reviews tab).
 *
 * These are intentionally side-effect free (no `location`/DOM access) so the
 * decision can be unit tested. The DOM reading (collecting active tab labels)
 * stays in the content script and is passed in here.
 *
 * Background: the rating histogram (.PPCwl) and the review count are ALSO present
 * on the Overview tab, where the removed-reviews banner can never render. Relying
 * on those signals made the extension emit bogus "no removals" observations from
 * Overview, so trust is granted only via reviews-specific evidence: an active tab
 * labelled as reviews, or a reviews-specific URL marker.
 */

const REVIEWS_LABEL_PATTERN = /\b(rezensionen|bewertungen|berichte|reviews?|ratings?)\b/i
const REVIEWS_VIEW_URL_PATTERN = /(?:!9m1!1b1|\/reviews(?:[/?#]|$))/i

export const isReviewsViewUrl = (href: string): boolean => REVIEWS_VIEW_URL_PATTERN.test(href)

export const isGoogleMapsPlaceUrl = (href: string): boolean => {
  try {
    return new URL(href).pathname.includes('/maps/place/')
  } catch {
    return false
  }
}

export const hasReviewsTabLabel = (activeTabLabels: readonly string[]): boolean =>
  activeTabLabels.some((label) => REVIEWS_LABEL_PATTERN.test(label))

// Whether any active tab was detected at all (the place panel exposes the selected
// tab as `button[role="tab"][aria-selected="true"]`). Used to veto the URL marker.
export const hasActiveTabLabel = (activeTabLabels: readonly string[]): boolean =>
  activeTabLabels.some((label) => label.trim().length > 0)

export interface ReviewsContextInput {
  activeTabLabels: readonly string[]
  href: string
}

export const isReviewsContext = ({ activeTabLabels, href }: ReviewsContextInput): boolean => {
  if (hasReviewsTabLabel(activeTabLabels)) {
    return true
  }

  // An active tab was detected, but it is not the reviews tab (e.g. "Übersicht",
  // "Info", "Speisekarte", …). Do not trust the URL marker in that case: Google keeps
  // the `!9m1!1b1` reviews marker in the URL when switching to another place, which
  // would otherwise emit bogus observations from a non-reviews tab.
  if (hasActiveTabLabel(activeTabLabels)) {
    return false
  }

  // No active tab detected yet (e.g. mid navigation) → fall back to the URL marker.
  return isGoogleMapsPlaceUrl(href) && isReviewsViewUrl(href)
}
