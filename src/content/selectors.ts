export const GOOGLE_MAPS_SELECTORS = {
  /** Reviews-Spalte: Sterne (.PPCwl), Platzhalter (.AyRUI), … */
  reviewsPanelRoot: '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde',
  starRatingSection: '.PPCwl',
  activeTabCandidates: ['button[role="tab"][aria-selected="true"]'],
  ratingContainerCandidates: ['.jANrlb', '[role="main"] .fontDisplayLarge'],
  ratingTextCandidates: ['.jANrlb .fontDisplayLarge', '[aria-label*="Sterne"]', '[aria-label*="stars"]'],
  reviewCountCandidates: ['.jANrlb .fontBodySmall', '[aria-label*="Rezensionen"]', '[aria-label*="reviews"]'],
  removedNoticeCandidates: ['.zpEcLb'],
  starBreakdownCandidates: [
    'tr.BHOKXe[aria-label]',
    '[role="img"][aria-label*="Stern"][aria-label*="Rezension"]',
    '[role="img"][aria-label*="Sterne"][aria-label*="Rezensionen"]',
    '[role="img"][aria-label*="star"][aria-label*="review"]',
    '[role="img"][aria-label*="stars"][aria-label*="reviews"]',
  ],
  placeNameCandidates: [
    'h1.DUwDvf',
    'span[jsname="r4nke"][jscontroller="JX3q8b"]',
    'span.iD2gKb.W1neJ',
    'h1',
    '[role="main"] h1',
  ],
} as const

export const REMOVED_NOTICE_TEXT_PATTERN = /(diffamierung|defamation)/i
export const REVIEW_COUNT_TEXT_PATTERN = /(bewertungen|rezensionen|berichte|reviews?)/i
