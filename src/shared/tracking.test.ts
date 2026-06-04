import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type StorageState = Record<string, unknown>

type TrackingModule = typeof import('./tracking')

const PLACE_KEY = 'google-cid:123'

let store: StorageState
let tracking: TrackingModule

const createBrowserMock = () => ({
  storage: {
    local: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: StorageState) => {
        Object.assign(store, items)
      }),
      remove: vi.fn(async () => {}),
    },
  },
})

beforeEach(async () => {
  vi.resetModules()
  store = {}
  vi.stubGlobal('chrome', createBrowserMock())
  tracking = await import('./tracking')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('observation throttle', () => {
  it('allows the first observation for a place', async () => {
    expect(await tracking.shouldSendObservation(PLACE_KEY)).toBe(true)
  })

  it('throttles a repeated no-removals observation within the window', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    await tracking.markObservationSent(PLACE_KEY, { hasRemovedRange: false }, now)

    const soon = new Date(now.getTime() + 60_000)
    expect(await tracking.shouldSendObservation(PLACE_KEY, { hasRemovedRange: false }, soon)).toBe(false)
  })

  it('allows upgrading from a no-removals snapshot to a removed-range snapshot', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    await tracking.markObservationSent(PLACE_KEY, { hasRemovedRange: false }, now)

    const soon = new Date(now.getTime() + 60_000)
    expect(await tracking.shouldSendObservation(PLACE_KEY, { hasRemovedRange: true }, soon)).toBe(true)
  })

  it('does not re-send a removed-range snapshot within the window', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    await tracking.markObservationSent(PLACE_KEY, { hasRemovedRange: true }, now)

    const soon = new Date(now.getTime() + 60_000)
    expect(await tracking.shouldSendObservation(PLACE_KEY, { hasRemovedRange: true }, soon)).toBe(false)
  })

  it('allows any observation again once the throttle window has elapsed', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    await tracking.markObservationSent(PLACE_KEY, { hasRemovedRange: true }, now)

    const later = new Date(now.getTime() + tracking.OBSERVATION_THROTTLE_MS + 1)
    expect(await tracking.shouldSendObservation(PLACE_KEY, { hasRemovedRange: true }, later)).toBe(true)
  })

  it('treats legacy string throttle entries as no-removals for upgrades', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    // Older extension versions stored a bare ISO timestamp string.
    store[tracking.OBSERVATION_THROTTLE_STORAGE_KEY] = { [PLACE_KEY]: now.toISOString() }

    const soon = new Date(now.getTime() + 60_000)
    expect(await tracking.shouldSendObservation(PLACE_KEY, { hasRemovedRange: true }, soon)).toBe(true)
    expect(await tracking.shouldSendObservation(PLACE_KEY, { hasRemovedRange: false }, soon)).toBe(false)
  })

  it('records the removed-range flag when marking an observation as sent', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    await tracking.markObservationSent(PLACE_KEY, { hasRemovedRange: true }, now)

    const state = store[tracking.OBSERVATION_THROTTLE_STORAGE_KEY] as Record<
      string,
      { hasRemovedRange?: boolean; sentAt: string }
    >
    expect(state[PLACE_KEY].hasRemovedRange).toBe(true)
    expect(state[PLACE_KEY].sentAt).toBe(now.toISOString())
  })
})
