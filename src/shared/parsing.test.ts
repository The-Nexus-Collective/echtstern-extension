import { describe, expect, it } from 'vitest'
import {
  emptyStarBreakdown,
  parseRating,
  parseRemovedReviewRange,
  parseRemovedReviewRangeFromTrustedText,
  parseReviewCount,
  parseStarBreakdownLabel,
  ratingFromStarBreakdown,
} from './parsing'

describe('parsing', () => {
  it('parses German and English ratings', () => {
    expect(parseRating('4,4 Sterne')).toBe(4.4)
    expect(parseRating('4.2 stars')).toBe(4.2)
  })

  it('parses review counts', () => {
    expect(parseReviewCount('210 Berichte')).toBe(210)
    expect(parseReviewCount('1.234 Rezensionen')).toBe(1234)
    expect(parseReviewCount('2,345 reviews')).toBe(2345)
  })

  it('parses German defamation ranges', () => {
    expect(parseRemovedReviewRange('21 bis 50 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.')).toMatchObject({
      min: 21,
      max: 50,
    })
  })

  it('parses English defamation ranges', () => {
    expect(parseRemovedReviewRange('Two to five reviews removed due to defamation complaints.')).toMatchObject({
      min: 2,
      max: 5,
    })
  })

  it('parses open-ended defamation ranges with a finite simulation cap', () => {
    expect(parseRemovedReviewRange('Over 250 reviews removed due to defamation complaints.')).toMatchObject({
      min: 251,
      max: 300,
      isOpenEnded: true,
    })
    expect(parseRemovedReviewRange('Mehr als 250 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.')).toMatchObject({
      min: 251,
      max: 300,
      isOpenEnded: true,
    })
    expect(parseRemovedReviewRange('Über 250 Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt.')).toMatchObject({
      min: 251,
      max: 300,
      isOpenEnded: true,
    })
    expect(parseRemovedReviewRangeFromTrustedText('250+ Bewertungen entfernt')).toMatchObject({
      min: 251,
      max: 300,
      isOpenEnded: true,
    })
  })

  it('parses trusted range-only text from known Google range nodes', () => {
    expect(parseRemovedReviewRange('21 bis 50')).toBeNull()
    expect(parseRemovedReviewRangeFromTrustedText('21 bis 50')).toMatchObject({
      min: 21,
      max: 50,
    })
  })

  it('parses Google star distribution aria labels and derives an unrounded rating', () => {
    const breakdown = emptyStarBreakdown()
    const parsed = parseStarBreakdownLabel('5 Sterne,1.387 Rezensionen')
    expect(parsed).toEqual({ star: 5, count: 1387 })
    expect(parseStarBreakdownLabel('1 Stern,19 Rezensionen')).toEqual({ star: 1, count: 19 })
    expect(parseStarBreakdownLabel('1 Sterne,1 Rezension')).toEqual({ star: 1, count: 1 })

    breakdown[5] = 1387
    breakdown[4] = 657
    breakdown[3] = 80
    breakdown[2] = 6
    breakdown[1] = 19

    expect(ratingFromStarBreakdown(breakdown)).toBeCloseTo(4.5761, 4)
  })
})
