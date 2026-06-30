import { browser } from '../shared/browserApi'
import type { PopupCandidate } from '../shared/popup'
import { fetchPlaceMatches, logTracking, postObservation, type ObservationPayload } from '../shared/tracking'

type ECHTSTERNMessage =
  | { type?: 'OPEN_ECHTSTERN_POPUP' }
  | { type?: 'SEND_ECHTSTERN_OBSERVATION'; payload?: ObservationPayload }
  | { type?: 'FETCH_ECHTSTERN_MATCHES'; candidates?: PopupCandidate[] }

browser?.runtime.onMessage.addListener((message: ECHTSTERNMessage, _sender, sendResponse) => {
  if (message.type === 'OPEN_ECHTSTERN_POPUP') {
    void browser?.action.openPopup?.()
    return false
  }

  if (message.type === 'FETCH_ECHTSTERN_MATCHES') {
    void fetchPlaceMatches(message.candidates ?? [])
      .then((matches) => {
        sendResponse({ ok: matches !== null, matches: matches ?? [] })
      })
      .catch((error: unknown) => {
        logTracking('Place match fetch failed in background', error)
        sendResponse({ ok: false, matches: [] })
      })

    return true
  }

  if (message.type === 'SEND_ECHTSTERN_OBSERVATION') {
    if (!message.payload) {
      sendResponse({ ok: false, error: 'Missing observation payload.' })
      return false
    }

    void postObservation(message.payload)
      .then((result) => {
        sendResponse(result)
      })
      .catch((error: unknown) => {
        logTracking('Observation post failed in background', error)
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown tracking error.',
        })
      })

    return true
  }

  return false
})
