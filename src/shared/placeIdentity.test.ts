import { describe, expect, it } from 'vitest'
import { extractGoogleMapsCid, placeKeyFromUrl } from './placeIdentity'

const CID_URL = 'https://www.google.com/maps?cid=7577283683645403420'
const PLACE_URL =
  'https://www.google.com/maps/place/TAVO+SOULFOOD/@50.0837507,8.2411974,17z/data=!3m1!4b1!4m6!3m5!1s0x47bdbd1082b240df:0x6927eb5d360c311c!8m2!3d50.0837507!4d8.2411974!16s%2Fg%2F11yv50gxp7?entry=ttu'

describe('placeIdentity', () => {
  it('extracts the decimal CID from a ?cid= URL', () => {
    expect(extractGoogleMapsCid(CID_URL)).toBe('7577283683645403420')
  })

  it('extracts the CID from the hex data segment of a /maps/place/ URL', () => {
    expect(extractGoogleMapsCid(PLACE_URL)).toBe('7577283683645403420')
  })

  it('treats the cid URL and the place URL of the same profile as one identity', () => {
    // Regression: Google Maps rewrites the URL within a single profile. If the
    // two forms produced different keys, in-profile URL changes were mistaken
    // for navigation and flushed pending observations prematurely.
    expect(placeKeyFromUrl(CID_URL)).toBe('google-cid:7577283683645403420')
    expect(placeKeyFromUrl(PLACE_URL)).toBe(placeKeyFromUrl(CID_URL))
  })

  it('uses the last hex CID when multiple data segments are present', () => {
    const urlWithMultipleSegments =
      'https://www.google.com/maps/place/Insel/@53.9,11.4,12z/data=!4m15!1m8!3m7!1s0x47adbc162ba63295:0x4251ae8ad84c550!2sInsel!3m5!1s0x47adbd9d29530797:0x9449e4f32362abcb!8m2!3d54.0!4d11.4'
    expect(extractGoogleMapsCid(urlWithMultipleSegments)).toBe(
      BigInt('0x9449e4f32362abcb').toString(10),
    )
  })

  it('falls back to the place path name when no CID is present', () => {
    expect(placeKeyFromUrl('https://www.google.com/maps/place/El+Gaucho+Original/@50,8,17z')).toBe(
      'El Gaucho Original',
    )
  })

  it('returns undefined for non-place URLs', () => {
    expect(placeKeyFromUrl('https://www.google.com/maps/contrib/123/reviews')).toBeUndefined()
    expect(extractGoogleMapsCid('https://www.google.com/maps/search/restaurants')).toBeUndefined()
  })
})
