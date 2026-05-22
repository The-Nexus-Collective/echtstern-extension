import { browser } from '../shared/browserApi'
import { logTracking, postObservation, type ObservationPayload } from '../shared/tracking'

type ECHTSTERNMessage =
  | { type?: 'OPEN_ECHTSTERN_POPUP' }
  | { type?: 'SEND_ECHTSTERN_OBSERVATION'; payload?: ObservationPayload }

browser?.runtime.onMessage.addListener((message: ECHTSTERNMessage, _sender, sendResponse) => {
  if (message.type === 'OPEN_ECHTSTERN_POPUP') {
    void browser?.action.openPopup?.()
    return false
  }

  if (message.type === 'SEND_ECHTSTERN_OBSERVATION') {
    if (!message.payload) {
      sendResponse({ ok: false, error: 'Missing observation payload.' })
      return false
    }

    void postObservation(message.payload)
      .then((ok) => {
        sendResponse({ ok })
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
