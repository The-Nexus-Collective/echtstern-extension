export const GOOGLE_MAPS_SELECTORS = {
  /** Reviews-Spalte: Sterne (.PPCwl), Platzhalter (.AyRUI), … */
  reviewsPanelRoot: '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde',
  starRatingSection: '.PPCwl',
  activeTabCandidates: [
    'button[role="tab"][aria-selected="true"]',
    '[role="tab"][aria-selected="true"]',
    'button[aria-current="page"]',
    'a[aria-current="page"]',
    '[role="tab"][tabindex="0"]',
  ],
  ratingContainerCandidates: ['.jANrlb', '[role="main"] .fontDisplayLarge'],
  ratingTextCandidates: ['.jANrlb .fontDisplayLarge', '[aria-label*="Sterne"]', '[aria-label*="stars"]'],
  reviewCountCandidates: ['.jANrlb .fontBodySmall', '[aria-label*="Rezensionen"]', '[aria-label*="reviews"]'],
  removedNoticeCandidates: ['.zpEcLb'],
  businessCategoryCandidates: [
    'button.DkEaL[jsaction$=".category"]',
    'button[jsaction*=".category"]',
    '[role="main"] span.mgr77e > span > span:not(.fjHK4):not(.wmQCje)',
  ],
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
  websiteLinkCandidates: [
    'a[data-item-id="authority"][href]',
    'a[aria-label^="Website:"][href]',
    'a[aria-label*="Website"][href]',
  ],
} as const

export const REMOVED_NOTICE_TEXT_PATTERN = /(diffamierung|defamation)/i
export const REVIEW_COUNT_TEXT_PATTERN = /(bewertungen|rezensionen|berichte|reviews?)/i
