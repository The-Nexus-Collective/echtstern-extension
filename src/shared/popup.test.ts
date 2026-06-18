// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  decidePopupRender,
  extractPopupCandidates,
  extractResultsCandidates,
  parsePopupCandidateFields,
  popupCandidateCacheKey,
  resolvePopupOpenTarget,
  type PopupMatch,
} from './popup'

const VISIBLE_POPUP_HTML = `
  <div class="Yl28hd oykxFd Hk4XGb U2hcle" style="display: block;">
    <div class="aIFcqe">
      <div class="wSFSne">
        <div class="szh09c fontHeadlineSmall" aria-label="Monkey Mind">Monkey Mind</div>
      </div>
      <button class="vsBKZc" jsaction="pane.wfvdle605">
        <span class="NrSyHc">
          <span class="e4rVHe fontBodySmall">
            <span role="img" class="ZkP5Je" aria-label="4,8&nbsp;Sterne 444&nbsp;Rezensionen">
              <span class="MW4etd" aria-hidden="true">4,8</span>
              <span class="UY7F9" aria-hidden="true">(444)</span>
            </span>
          </span>
        </span>
      </button>
      <div class="HVpXgd fontBodySmall">
        <span><span>Café</span></span>
        <span><span class="Lx2maf" aria-hidden="true">·</span><span>10–20&nbsp;€</span></span>
      </div>
    </div>
  </div>
`

const HIDDEN_POPUP_HTML = `
  <div class="Yl28hd" style="display: none;">
    <div class="aIFcqe">
      <div class="szh09c fontHeadlineSmall" aria-label="Hidden Place">Hidden Place</div>
      <span role="img" class="ZkP5Je" aria-label="3,9&nbsp;Sterne 12&nbsp;Rezensionen"></span>
    </div>
  </div>
`

const RESULTS_LIST_HTML = `
  <div role="article" class="Nv2PK THOPZb CpccDe">
    <a class="hfpxzc" aria-label="Allerblick" href="https://www.google.com/maps/place/Allerblick/data=!4m10!3m9!1s0x47b03fa8720f11a7:0xe320d897f8e206e2!5m2!4m1!1i2!8m2!3d52.6!4d9.9!16s%2Fg%2F1tdr76_3?hl=de"></a>
    <div class="bfdHYd">
      <div class="UaQhfb fontBodyMedium">
        <div class="NrDZNb">
          <div class="qBF1Pd fontHeadlineSmall">Allerblick</div>
        </div>
        <div class="W4Efsd">
          <div class="AJB7ye">
            <span class="e4rVHe fontBodyMedium">
              <span role="img" class="ZkP5Je" aria-label="4,5&nbsp;Sterne 817&nbsp;Rezensionen">
                <span class="MW4etd" aria-hidden="true">4,5</span>
                <span class="UY7F9" aria-hidden="true">(817)</span>
              </span>
            </span>
          </div>
        </div>
        <div class="W4Efsd">
          <div class="W4Efsd"><span><span>Restaurant</span></span></div>
        </div>
      </div>
    </div>
  </div>
`

afterEach(() => {
  document.body.innerHTML = ''
})

describe('parsePopupCandidateFields', () => {
  it('parses name, rating, review count and category from the aria-label', () => {
    const candidate = parsePopupCandidateFields({
      name: 'Monkey Mind',
      ratingLabel: '4,8\u00a0Sterne 444\u00a0Rezensionen',
      categoryText: 'Café',
    })

    expect(candidate).toEqual({
      name: 'Monkey Mind',
      displayedRating: 4.8,
      reviewCount: 444,
      businessCategory: 'Café',
    })
  })

  it('falls back to the parenthesized review count when the aria-label has no count', () => {
    const candidate = parsePopupCandidateFields({
      name: 'Monkey Mind',
      ratingValueText: '4,8',
      reviewCountText: '(444)',
    })

    expect(candidate?.displayedRating).toBe(4.8)
    expect(candidate?.reviewCount).toBe(444)
    expect(candidate?.businessCategory).toBeUndefined()
  })

  it('returns null when the name or rating is missing', () => {
    expect(parsePopupCandidateFields({ ratingLabel: '4,8 Sterne 10 Rezensionen' })).toBeNull()
    expect(parsePopupCandidateFields({ name: 'No Rating' })).toBeNull()
  })
})

describe('extractPopupCandidates', () => {
  it('extracts the visible popup candidate from a Google Maps sample', () => {
    document.body.innerHTML = VISIBLE_POPUP_HTML

    const extractions = extractPopupCandidates(document)
    expect(extractions).toHaveLength(1)
    expect(extractions[0].candidate).toEqual({
      name: 'Monkey Mind',
      displayedRating: 4.8,
      reviewCount: 444,
      businessCategory: 'Café',
    })
    expect(extractions[0].ratingAnchor.classList.contains('ZkP5Je')).toBe(true)
  })

  it('ignores popups that are not displayed', () => {
    document.body.innerHTML = VISIBLE_POPUP_HTML + HIDDEN_POPUP_HTML

    const extractions = extractPopupCandidates(document)
    expect(extractions).toHaveLength(1)
    expect(extractions[0].candidate.name).toBe('Monkey Mind')
  })
})

describe('resolvePopupOpenTarget', () => {
  it('targets the place title, not the rating button (which opens a legal tooltip)', () => {
    document.body.innerHTML = VISIBLE_POPUP_HTML

    const [extraction] = extractPopupCandidates(document)
    const target = resolvePopupOpenTarget(extraction)

    expect(target).toBeInstanceOf(HTMLElement)
    expect(target.classList.contains('szh09c')).toBe(true)
    expect(target.classList.contains('vsBKZc')).toBe(false)
  })
})

describe('popupCandidateCacheKey', () => {
  it('builds a stable key from name, review count and category', () => {
    const key = popupCandidateCacheKey({
      name: 'Monkey Mind',
      displayedRating: 4.8,
      reviewCount: 444,
      businessCategory: 'Café',
    })
    expect(key).toBe('monkey mind|444|café')
  })
})

describe('extractResultsCandidates', () => {
  it('extracts a result card with name, rating, category and the URL CID', () => {
    document.body.innerHTML = RESULTS_LIST_HTML

    const extractions = extractResultsCandidates(document)
    expect(extractions).toHaveLength(1)
    expect(extractions[0].candidate).toEqual({
      name: 'Allerblick',
      displayedRating: 4.5,
      reviewCount: 817,
      businessCategory: 'Restaurant',
      cid: BigInt('0xe320d897f8e206e2').toString(10),
    })
    expect(extractions[0].ratingAnchor.classList.contains('ZkP5Je')).toBe(true)
    expect(extractions[0].openTarget.classList.contains('hfpxzc')).toBe(true)
  })

  it('skips cards without a rating', () => {
    document.body.innerHTML = `
      <div role="article" class="Nv2PK">
        <a class="hfpxzc" href="https://www.google.com/maps/place/X/data=!1s0x0:0x1"></a>
        <div class="qBF1Pd fontHeadlineSmall">No Rating</div>
      </div>
    `

    expect(extractResultsCandidates(document)).toHaveLength(0)
  })
})

describe('decidePopupRender', () => {
  const placeFor = (): PopupMatch['place'] => ({
    name: 'Monkey Mind',
    sourceUrl: 'https://www.google.com/maps?cid=1',
    lastObservedAt: '2026-01-01T00:00:00.000Z',
    rating: 4.8,
    displayedRating: 4.8,
    reviewCount: 444,
    removedRange: { min: 10, max: 20, isOpenEnded: false },
    starBreakdown: null,
  })

  it('shows the value for high/exact confidence', () => {
    expect(decidePopupRender({ confidence: 'high', reason: '', place: placeFor() })).toBe('value')
    expect(decidePopupRender({ confidence: 'exact', reason: '', place: placeFor() })).toBe('value')
  })

  it('shows a cautious label for low confidence', () => {
    expect(decidePopupRender({ confidence: 'low', reason: '', place: placeFor() })).toBe('cautious')
  })

  it('shows the CTA for none or missing matches', () => {
    expect(decidePopupRender({ confidence: 'none', reason: '', place: null })).toBe('cta')
    expect(decidePopupRender(null)).toBe('cta')
    expect(decidePopupRender({ confidence: 'high', reason: '', place: null })).toBe('cta')
  })
})
