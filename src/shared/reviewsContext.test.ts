import { describe, expect, it } from 'vitest'
import { isReviewsContext, isReviewsViewUrl, isGoogleMapsPlaceUrl } from './reviewsContext'

const PLACE_OVERVIEW_URL =
  'https://www.google.com/maps/place/Some+Restaurant/@52.5,13.4,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x123'
const PLACE_REVIEWS_URL =
  'https://www.google.com/maps/place/Some+Restaurant/@52.5,13.4,17z/data=!4m8!3m7!1s0x0:0x123!9m1!1b1'

describe('isReviewsContext', () => {
  it('treats the Overview tab as NOT a reviews context (regression guard)', () => {
    // On Overview the rating histogram and review count are present, but the
    // removed-reviews banner is not. The active tab is "Übersicht" and the URL
    // carries no reviews marker, so this must be false.
    expect(
      isReviewsContext({ activeTabLabels: ['Übersicht', 'Info'], href: PLACE_OVERVIEW_URL }),
    ).toBe(false)
  })

  it('detects the reviews context via the active tab label', () => {
    expect(
      isReviewsContext({ activeTabLabels: ['Rezensionen'], href: PLACE_OVERVIEW_URL }),
    ).toBe(true)
  })

  it('detects the reviews context via the reviews URL marker even without a tab label', () => {
    expect(
      isReviewsContext({ activeTabLabels: ['Übersicht'], href: PLACE_REVIEWS_URL }),
    ).toBe(true)
  })

  it('does not treat a reviews URL marker on a non-place page as reviews', () => {
    expect(
      isReviewsContext({
        activeTabLabels: [],
        href: 'https://www.google.com/maps/search/restaurant/data=!9m1!1b1',
      }),
    ).toBe(false)
  })

  it('returns false when neither tab label nor URL indicate reviews', () => {
    expect(isReviewsContext({ activeTabLabels: [], href: PLACE_OVERVIEW_URL })).toBe(false)
  })
})

describe('isReviewsViewUrl', () => {
  it('matches the encoded reviews tab marker', () => {
    expect(isReviewsViewUrl(PLACE_REVIEWS_URL)).toBe(true)
  })

  it('matches an explicit /reviews path', () => {
    expect(isReviewsViewUrl('https://www.google.com/maps/place/X/reviews')).toBe(true)
  })

  it('does not match an overview URL', () => {
    expect(isReviewsViewUrl(PLACE_OVERVIEW_URL)).toBe(false)
  })
})

describe('isGoogleMapsPlaceUrl', () => {
  it('recognizes a /maps/place/ URL', () => {
    expect(isGoogleMapsPlaceUrl(PLACE_OVERVIEW_URL)).toBe(true)
  })

  it('rejects a non-place URL', () => {
    expect(isGoogleMapsPlaceUrl('https://www.google.com/maps/search/restaurant')).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(isGoogleMapsPlaceUrl('not a url')).toBe(false)
  })
})
