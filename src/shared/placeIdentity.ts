/**
 * Pure helpers for deriving a stable Google Maps place identity from a URL.
 *
 * These are intentionally side-effect free (no `location`/DOM access) so the
 * navigation logic that relies on them can be unit tested. Google Maps mutates
 * the URL repeatedly within a single profile (a `?cid=` URL becomes a
 * `/maps/place/...` URL with an appended `data` segment). All of those forms
 * must resolve to the same key, otherwise in-profile URL changes are mistaken
 * for navigation to a different place.
 */

export const extractGoogleMapsCid = (url: string): string | undefined => {
  try {
    const parsed = new URL(url)
    const existingCid = parsed.searchParams.get('cid')

    if (existingCid && /^\d+$/.test(existingCid)) {
      return existingCid
    }
  } catch {
    // Fall through to extracting the raw hex CID from Google Maps' data segment.
  }

  const decodedUrl = (() => {
    try {
      return decodeURIComponent(url)
    } catch {
      return url
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

export const placeKeyFromUrl = (url: string): string | undefined => {
  const cid = extractGoogleMapsCid(url)

  if (cid) {
    return `google-cid:${cid}`
  }

  try {
    const path = new URL(url).pathname
    const match = path.match(/\/maps\/place\/([^/?#]+)/)
    return match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : undefined
  } catch {
    return undefined
  }
}
