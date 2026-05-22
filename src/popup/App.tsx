import { useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import HistogramChart from './HistogramChart'
import { browser, hasBrowserLocalStorage } from '../shared/browserApi'
import { buildNoRemovedReviewsEstimate, calculateEstimate } from '../shared/estimate'
import {
  DEFAULT_DEFAMATION_QUOTA_PERCENT,
  DEFAULT_INLINE_DISPLAY_MODE,
  DEFAULT_SHARE_ANONYMOUS_STATS,
  DEFAULT_WARNING_THRESHOLDS,
  DEFAULT_WEIGHTS,
  LATEST_ESTIMATE_STORAGE_KEY,
  adjustWarningThresholds,
  areWeightsValid,
  loadSettings,
  saveSettings,
  weightsTotal,
  type ECHTSTERNSettings,
} from '../shared/settings'
import { formatAverageStars, formatOriginalRating, formatRating, formatWeights } from '../shared/format'
import {
  DEFAULT_LOCALE_SETTING,
  getMessages,
  localeToIntl,
  resolveLocaleSetting,
  type Locale,
  type LocaleSetting,
  type Messages,
} from '../shared/i18n'
import type { EstimateResult, InlineDisplayMode, RemovedReviewRange, StarValue, StarWeights, StoredLatestEstimate, WarningThresholds } from '../shared/types'
import emptyStar from '../assets/empty_star.png'
import fullStar from '../assets/full_star.png'
import halfStar from '../assets/half_star.png'
import iconUrl from '../assets/icon.svg'

type ActiveTab = 'estimate' | 'weights'

const imageDownIconUrl = 'icons/image-down.svg'
const STAR_VALUES_DESC: StarValue[] = [5, 4, 3, 2, 1]

const WARNING_THRESHOLD_CONTROLS: Array<{
  key: keyof WarningThresholds
}> = [
  {
    key: 'yellowGreenBoundary',
  },
  { key: 'yellowQuestionAbove' },
  { key: 'redExclamationAbove' },
]

const formatCount = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(localeToIntl(locale), {
    maximumFractionDigits: value < 10 && value % 1 !== 0 ? 1 : 0,
  }).format(value)

const formatWholeCount = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(localeToIntl(locale), {
    maximumFractionDigits: 0,
  }).format(Math.round(value))

const formatPercent = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(localeToIntl(locale), {
    maximumFractionDigits: 1,
  }).format(value)

const formatRemovedRange = (range: RemovedReviewRange, locale: Locale): string => {
  if (range.isOpenEnded || (range.min === 250 && range.max === 250)) {
    return locale === 'de' ? 'mindestens 250' : 'at least 250'
  }

  if (range.min === range.max) {
    return formatWholeCount(range.min, locale)
  }

  return locale === 'de'
    ? `zwischen ${formatWholeCount(range.min, locale)} und ${formatWholeCount(range.max, locale)}`
    : `between ${formatWholeCount(range.min, locale)} and ${formatWholeCount(range.max, locale)}`
}

const formatSimulationRange = (range: RemovedReviewRange, locale: Locale): string => {
  if (range.min === range.max) {
    return formatWholeCount(range.min, locale)
  }

  return locale === 'de'
    ? `${formatWholeCount(range.min, locale)} bis ${formatWholeCount(range.max, locale)}`
    : `${formatWholeCount(range.min, locale)} to ${formatWholeCount(range.max, locale)}`
}

const formatRemovalRateRange = (result: EstimateResult, locale: Locale): string => {
  const minRate = (result.removedRange.min / (result.reviewCount + result.removedRange.min)) * 100
  const maxRate = (result.removedRange.max / (result.reviewCount + result.removedRange.max)) * 100

  if (result.removedRange.min === result.removedRange.max) {
    return `${formatPercent(minRate, locale)}%`
  }

  return locale === 'de'
    ? `zwischen ${formatPercent(minRate, locale)}% und ${formatPercent(maxRate, locale)}%`
    : `between ${formatPercent(minRate, locale)}% and ${formatPercent(maxRate, locale)}%`
}

const loadLatestEstimate = async (): Promise<StoredLatestEstimate | null> => {
  if (!hasBrowserLocalStorage() || !browser) {
    return null
  }

  const data = await browser.storage.local.get(LATEST_ESTIMATE_STORAGE_KEY)
  return (data[LATEST_ESTIMATE_STORAGE_KEY] as StoredLatestEstimate | undefined) ?? null
}

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.click()
}

const waitForNextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const formatScreenshotDate = (date = new Date()): string =>
  new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)

const prepareShareNode = (source: HTMLElement, poweredByText: string): HTMLElement => {
  const clone = source.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-share-exclude="true"]').forEach((node) => {
    node.remove()
  })

  const poweredBy = document.createElement('p')
  poweredBy.className = 'share-branding'
  poweredBy.textContent = `${poweredByText} · ${formatScreenshotDate()}`
  clone.append(poweredBy)

  clone.style.background = '#ffffff'
  clone.style.left = '0'
  clone.style.pointerEvents = 'none'
  clone.style.position = 'fixed'
  clone.style.top = '0'
  clone.style.width = `${source.offsetWidth}px`
  clone.style.zIndex = '-1'
  document.body.append(clone)

  return clone
}

const fileSafeName = (value: string | undefined): string =>
  (value ?? 'echtstern-schaetzung')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'echtstern-schaetzung'

const App = () => {
  const popupRef = useRef<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('estimate')
  const [settings, setSettings] = useState<ECHTSTERNSettings>({
    weights: DEFAULT_WEIGHTS,
    defamationQuotaPercent: DEFAULT_DEFAMATION_QUOTA_PERCENT,
    warningThresholds: DEFAULT_WARNING_THRESHOLDS,
    locale: DEFAULT_LOCALE_SETTING,
    inlineDisplay: DEFAULT_INLINE_DISPLAY_MODE,
    shareAnonymousStats: DEFAULT_SHARE_ANONYMOUS_STATS,
  })
  const [latest, setLatest] = useState<StoredLatestEstimate | null>(null)
  const [status, setStatus] = useState('')
  const locale = resolveLocaleSetting(settings.locale)
  const copy = getMessages(locale)

  useEffect(() => {
    const initialize = async () => {
      const [loadedSettings, loadedLatest] = await Promise.all([loadSettings(), loadLatestEstimate()])
      setSettings(loadedSettings)
      setLatest(loadedLatest)
    }

    void initialize()

    if (!browser?.storage?.onChanged) {
      return undefined
    }

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && changes[LATEST_ESTIMATE_STORAGE_KEY]) {
        setLatest((changes[LATEST_ESTIMATE_STORAGE_KEY].newValue as StoredLatestEstimate | undefined) ?? null)
      }
    }

    const extensionBrowser = browser

    extensionBrowser.storage.onChanged.addListener(handleStorageChange)

    return () => {
      extensionBrowser.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  const recalculatedResult = useMemo<EstimateResult | null>(() => {
    if (!latest) {
      return null
    }

    if (!areWeightsValid(settings.weights)) {
      return latest.result
    }

    if (latest.result.noRemovedReviews) {
      return buildNoRemovedReviewsEstimate(
        {
          rating: latest.result.originalRating,
          displayedRating: latest.result.displayedRating ?? latest.result.originalRating,
          reviewCount: latest.result.reviewCount,
          starBreakdown: latest.result.googleStarBreakdown,
        },
        settings.weights,
        {
          defamationQuotaPercent: settings.defamationQuotaPercent,
          noRemovedReviewsLabel: copy.estimate.noRemovedReviews,
        },
      )
    }

    return calculateEstimate(
      {
        rating: latest.result.originalRating,
        displayedRating: latest.result.displayedRating ?? latest.result.originalRating,
        reviewCount: latest.result.reviewCount,
        removedRange: latest.result.removedRange,
        starBreakdown: latest.result.googleStarBreakdown,
      },
      settings.weights,
      {
        defamationQuotaPercent: settings.defamationQuotaPercent,
      },
    )
  }, [copy.estimate.noRemovedReviews, latest, settings.defamationQuotaPercent, settings.weights])

  const updateWeight = async (star: StarValue, value: number) => {
    const weights: StarWeights = {
      ...settings.weights,
      [star]: value,
    }
    setSettings({ ...settings, weights })

    if (!areWeightsValid(weights)) {
      setStatus(copy.settings.weightSumError)
      return
    }

    await saveSettings({ ...settings, weights })
    setStatus(copy.common.settingsSaved)
  }

  const updateDefamationQuota = async (defamationQuotaPercent: number) => {
    const nextSettings = { ...settings, defamationQuotaPercent }
    setSettings(nextSettings)

    if (!areWeightsValid(nextSettings.weights)) {
      setStatus(copy.settings.weightSumError)
      return
    }

    await saveSettings(nextSettings)
    setStatus(copy.settings.quotaSaved)
  }

  const updateWarningThreshold = async (key: keyof WarningThresholds, value: number) => {
    const warningThresholds = adjustWarningThresholds(settings.warningThresholds, key, value)
    const nextSettings = {
      ...settings,
      warningThresholds,
    }
    setSettings(nextSettings)

    if (!areWeightsValid(nextSettings.weights)) {
      setStatus(copy.settings.weightSumError)
      return
    }

    await saveSettings(nextSettings)
    setStatus(copy.settings.thresholdsSaved)
  }

  const updateLocale = async (localeSetting: LocaleSetting) => {
    const nextSettings = { ...settings, locale: localeSetting }
    setSettings(nextSettings)

    if (!areWeightsValid(nextSettings.weights)) {
      setStatus(getMessages(resolveLocaleSetting(localeSetting)).settings.weightSumError)
      return
    }

    await saveSettings(nextSettings)
    setStatus(getMessages(resolveLocaleSetting(localeSetting)).settings.languageSaved)
  }

  const updateInlineDisplay = async (inlineDisplay: InlineDisplayMode) => {
    const nextSettings = { ...settings, inlineDisplay }
    setSettings(nextSettings)

    if (!areWeightsValid(nextSettings.weights)) {
      setStatus(copy.settings.weightSumError)
      return
    }

    await saveSettings(nextSettings)
    setStatus(copy.settings.inlineDisplaySaved)
  }

  const updateShareAnonymousStats = async (shareAnonymousStats: boolean) => {
    const nextSettings = { ...settings, shareAnonymousStats }
    setSettings(nextSettings)

    if (!areWeightsValid(nextSettings.weights)) {
      setStatus(copy.settings.weightSumError)
      return
    }

    await saveSettings(nextSettings)
    setStatus(copy.settings.anonymousStatsSaved)
  }

  const resetWeights = async () => {
    const nextSettings = {
      weights: DEFAULT_WEIGHTS,
      defamationQuotaPercent: DEFAULT_DEFAMATION_QUOTA_PERCENT,
      warningThresholds: DEFAULT_WARNING_THRESHOLDS,
      locale: settings.locale,
      inlineDisplay: DEFAULT_INLINE_DISPLAY_MODE,
      shareAnonymousStats: DEFAULT_SHARE_ANONYMOUS_STATS,
    }
    setSettings(nextSettings)
    await saveSettings(nextSettings)
    setStatus(copy.settings.defaultsSaved)
  }

  const downloadEstimatePng = async () => {
    if (!popupRef.current || !latest || !recalculatedResult) {
      return
    }

    let shareNode: HTMLElement | null = null

    try {
      if (activeTab !== 'estimate') {
        setActiveTab('estimate')
        await waitForNextFrame()
        await waitForNextFrame()
      }

      shareNode = prepareShareNode(popupRef.current, copy.estimate.poweredBy)
      await waitForNextFrame()
      const dataUrl = await toPng(shareNode, {
        backgroundColor: '#ffffff',
        cacheBust: true,
        pixelRatio: 2,
      })
      downloadDataUrl(dataUrl, `${fileSafeName(latest.placeName)}-echtstern.png`)
    } catch {
      // Keep the popup compact; failures are uncommon and usually caused by browser image restrictions.
      console.warn(copy.estimate.downloadError)
    } finally {
      shareNode?.remove()
    }
  }

  const heading = latest?.placeName ?? ""

  return (
    <main className="popup-shell" ref={popupRef}>
      <header className="popup-header">
        <div className="header-top">
          <p className="eyebrow">
            <img alt="" src={iconUrl} />
            {copy.common.echtstern}
          </p>
          <nav className="tabs" aria-label="Popup Tabs">
            <button className={activeTab === 'estimate' ? 'active' : ''} type="button" onClick={() => setActiveTab('estimate')}>
              {copy.tabs.estimate}
            </button>
            <button className={activeTab === 'weights' ? 'active' : ''} type="button" onClick={() => setActiveTab('weights')}>
              {copy.tabs.settings}
            </button>
            <button
              aria-label={copy.estimate.downloadPng}
              className="icon-tab-button"
              data-share-exclude="true"
              disabled={!latest || !recalculatedResult}
              title={copy.estimate.downloadPng}
              type="button"
              onClick={() => void downloadEstimatePng()}
            >
              <img alt="" src={imageDownIconUrl} />
            </button>
          </nav>
        </div>
        <h1>{heading}</h1>
      </header>

      {activeTab === 'estimate' ? (
        <EstimateTab copy={copy} latest={latest} locale={locale} result={recalculatedResult} />
      ) : (
        <WeightsTab
          copy={copy}
          weights={settings.weights}
          defamationQuotaPercent={settings.defamationQuotaPercent}
          locale={locale}
          localeSetting={settings.locale}
          warningThresholds={settings.warningThresholds}
          inlineDisplay={settings.inlineDisplay}
          shareAnonymousStats={settings.shareAnonymousStats}
          onChange={updateWeight}
          onQuotaChange={updateDefamationQuota}
          onLocaleChange={updateLocale}
          onWarningThresholdChange={updateWarningThreshold}
          onInlineDisplayChange={updateInlineDisplay}
          onShareAnonymousStatsChange={updateShareAnonymousStats}
          onReset={resetWeights}
          status={status}
        />
      )}
    </main>
  )
}

type EstimateTabProps = {
  copy: Messages
  latest: StoredLatestEstimate | null
  locale: Locale
  result: EstimateResult | null
}

const EstimateTab = ({ copy, latest, locale, result }: EstimateTabProps) => {
  if (!latest || !result) {
    return (
      <section className="empty-state">
        <h2>{copy.estimate.missingTitle}</h2>
        <p>{copy.estimate.missingText}</p>
      </section>
    )
  }

  return (
    <div>
    <section className="panel">
    
      <div className="rating-comparison">
        <RatingCard
          label={copy.estimate.echtsternEstimate}
          locale={locale}
          rating={result.median}
          ratingText={`${formatRating(result.median, locale)}`}
          detail={
            result.noRemovedReviews
              ? copy.estimate.matchesGoogleDetail
              : copy.estimate.confidenceInterval(formatRating(result.intervalLow, locale), formatRating(result.intervalHigh, locale))
          }
        />
        <RatingCard
          label={copy.estimate.googleRating}
          locale={locale}
          rating={result.displayedRating ?? result.originalRating}
          ratingText={`${formatOriginalRating(result.displayedRating ?? result.originalRating, locale)}`}
          detail={copy.estimate.unrounded(formatRating(result.originalRating, locale))}
        />
      </div>
      {result.noRemovedReviews ? (
        <p className="status" role="status">
          {copy.estimate.noRemovedReviews}
        </p>
      ) : result?.removedRange?.label ? <p className="status" role="status" style={{ color: '#111111' }}>
          {copy.estimate.removedReviewsStatusPrefix(formatRemovedRange(result.removedRange, locale))}{' '}
          <strong>{formatRemovalRateRange(result, locale)}</strong>.
        </p> : null}

      <StarDistribution copy={copy} locale={locale} result={result} />

      
    </section>
    <details className="method" data-share-exclude="true" style={{ borderTop: 'none' }}>
        <summary>{copy.estimate.howCalculated}</summary>
        {result.noRemovedReviews ? (
          <>
            <div className="context-copy">
              <p>{copy.estimate.noRemovedExplanation(formatRating(result.originalRating, locale), formatCount(result.reviewCount, locale))}</p>
              {result.smallSampleWarning ? (
                <p className="warning">{copy.estimate.smallSampleNoRemoved}</p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="context-copy">
              <p>
                {copy.estimate.monteCarloExplanation(
                  result.removedRange.isOpenEnded
                    ? `${formatRemovedRange(result.removedRange, locale)} (${formatSimulationRange(result.removedRange, locale)} ${
                        locale === 'de' ? 'für die Simulation' : 'for the simulation'
                      })`
                    : formatSimulationRange(result.removedRange, locale),
                  result.assumedTrueDefamationCount,
                  formatOriginalRating(result.defamationQuotaPercent, locale),
                  formatSimulationRange(result.adjustedRemovedRange, locale),
                  formatWeights(result.weights),
                )}
              </p>
              {result.smallSampleWarning ? <p className="warning">{copy.estimate.smallSampleWarning}</p> : null}
              {result.openEndedRangeNote ? <p className="warning">{copy.estimate.openEndedRangeNote}</p> : null}
            </div>

            {result.histogram.length > 0 ? (
              <div className="chart-wrap">
                <HistogramChart result={result} />
              </div>
            ) : null}
          </>
        )}
      </details>
      <details className="method" data-share-exclude="true">
      <summary>{copy.estimate.howInterpret}</summary>
      <ul style={{ paddingInlineStart: '20px' }}>
            {copy.estimate.interpretationItems.map((item, index) => (
              <li key={item}>
                {index === 8 ? (
                  <>
                    {item}{' '}
                    <a href="https://support.google.com/contributionpolicy/answer/16997273?hl=de" target="_blank" rel="noopener noreferrer">
                      Google Support Center
                    </a>
                    .
                  </>
                ) : (
                  item
                )}
              </li>
            ))}
          </ul>
      </details>
    </div>
  )
}

type RatingCardProps = {
  label: string
  locale: Locale
  rating: number
  ratingText: string
  detail: string
}

const RatingCard = ({ label, locale, rating, ratingText, detail }: RatingCardProps) => (
  <div className="metric">
    <span className="metric-label">{label}</span>
    <strong>{ratingText}</strong>
    <StarRating locale={locale} value={rating} />
    <span>{detail}</span>
  </div>
)

type StarDistributionProps = {
  copy: Messages
  locale: Locale
  result: EstimateResult
}

const StarDistribution = ({ copy, locale, result }: StarDistributionProps) => {
  const googleBreakdown = result.googleStarBreakdown
  if (!googleBreakdown) {
    return (
      <section className="distribution" aria-label={copy.estimate.distribution.title}>
        <div className="distribution-header">
          <h2>{copy.estimate.distribution.title}</h2>
        </div>
        <p className="distribution-empty">{copy.estimate.distribution.empty(formatRating(result.originalRating, locale), formatCount(result.reviewCount, locale))}</p>
      </section>
    )
  }

  const maxCount = Math.max(
    ...STAR_VALUES_DESC.map((star) => googleBreakdown[star] + result.estimatedAddedStarBreakdown[star]),
    1,
  )

  return (
    <section className="distribution" aria-label={copy.estimate.distribution.title}>
      <div className="distribution-header">
        <h2>{copy.estimate.distribution.title}</h2>
        <div className="legend">
          <span><i className="legend-current" />{copy.common.google}</span>
          <span><i className="legend-added" />{copy.estimate.distribution.added}</span>
        </div>
      </div>

      {STAR_VALUES_DESC.map((star) => (
        <DistributionRow
          key={star}
          star={star}
          googleCount={googleBreakdown[star]}
          addedCount={result.estimatedAddedStarBreakdown[star]}
          locale={locale}
          maxCount={maxCount}
        />
      ))}
    </section>
  )
}

type DistributionRowProps = {
  star: StarValue
  googleCount: number
  addedCount: number
  locale: Locale
  maxCount: number
}

const DistributionRow = ({ star, googleCount, addedCount, locale, maxCount }: DistributionRowProps) => {
  const currentWidth = Math.max(0, (googleCount / maxCount) * 100)
  const addedWidth = Math.max(0, (addedCount / maxCount) * 100)
  const roundedAddedCount = Math.round(addedCount)

  return (
    <div className="distribution-row">
      <span className="distribution-star">{star} ★</span>
      <div className="distribution-track">
        <span className="distribution-current" style={{ width: `${currentWidth}%` }} />
        <span className="distribution-added" style={{ width: `${addedWidth}%` }} />
      </div>
      <span className="distribution-count">
        {formatCount(googleCount, locale)}
        {` + ${formatWholeCount(roundedAddedCount, locale)}`}
      </span>
    </div>
  )
}

type WeightsTabProps = {
  copy: Messages
  weights: StarWeights
  defamationQuotaPercent: number
  locale: Locale
  localeSetting: LocaleSetting
  warningThresholds: WarningThresholds
  inlineDisplay: InlineDisplayMode
  shareAnonymousStats: boolean
  onChange: (star: StarValue, value: number) => void
  onQuotaChange: (value: number) => void
  onLocaleChange: (locale: LocaleSetting) => void
  onWarningThresholdChange: (key: keyof WarningThresholds, value: number) => void
  onInlineDisplayChange: (value: InlineDisplayMode) => void
  onShareAnonymousStatsChange: (value: boolean) => void
  onReset: () => void
  status: string
}

const WeightsTab = ({
  copy,
  weights,
  defamationQuotaPercent,
  locale,
  localeSetting,
  warningThresholds,
  inlineDisplay,
  shareAnonymousStats,
  onChange,
  onQuotaChange,
  onLocaleChange,
  onWarningThresholdChange,
  onInlineDisplayChange,
  onShareAnonymousStatsChange,
  onReset,
  status,
}: WeightsTabProps) => {
  const total = weightsTotal(weights)

  return (
    <section className="panel">
      <h2>{copy.settings.title}</h2>
      
      <span><strong>{copy.settings.trueDefamationQuota}</strong></span>
      <label className="slider-row">
      <span className="slider-label">
            {copy.settings.quota}
          </span>
        <input
          min="0"
          max="10"
          step="0.1"
          type="range"
          value={defamationQuotaPercent}
          onChange={(event) => {
            void onQuotaChange(Number(event.target.value))
          }}
        />
        <output>{formatOriginalRating(defamationQuotaPercent, locale)}%</output>
      </label>

      <p className="fine-print">
        {copy.settings.quotaHelp}
      </p>
      <div className="quota-row">
        <span>{""}</span>
      </div>

      <span><strong>{copy.settings.remainingAssumption}</strong></span>
      <p className="fine-print">{copy.settings.remainingAssumptionHelp(formatAverageStars(weights, locale))}</p>
      

      {STAR_VALUES_DESC.map((star) => (
        <label className="slider-row" key={star}>
          <span className="slider-label">
            <StarIconRow count={star} />
            {copy.settings.starShare(star)}
          </span>
          <input
            min="0"
            max="100"
            type="range"
            value={weights[star]}
            onChange={(event) => {
              void onChange(star, Number(event.target.value))
            }}
          />
          <output>{weights[star]}%</output>
        </label>
      ))}


{!areWeightsValid(weights) ?<div> <span><strong>{locale === 'de' ? 'Summe' : 'Total'}:</strong> {total}%</span><p className="warning">{copy.settings.invalidWeights}</p> </div>: null}

      

      <section className="settings-section">
      <h2>{copy.settings.warningThresholds}</h2>
        <p className="fine-print">{copy.settings.warningThresholdHelp}</p>

        {WARNING_THRESHOLD_CONTROLS.map((control) => (
          <label className="slider-row threshold-row" key={control.key}>
            <span>{copy.settings.thresholdLabels[control.key]}</span>
            <input
              min="0"
              max="1"
              step="0.01"
              type="range"
              value={warningThresholds[control.key]}
              onChange={(event) => {
                void onWarningThresholdChange(control.key, Number(event.target.value))
              }}
            />
            <output>{formatRating(warningThresholds[control.key], locale)}</output>
          </label>
        ))}
      </section>

     
      {status ? <p className="status">{status}</p> : null}

     

      

      <section className="settings-section">
      <h2>{copy.settings.inlineDisplayTitle}</h2>
      <p className="fine-print">{copy.settings.inlineDisplayHelp}</p>
      <label className="select-row inline-display-row">
        <span>{copy.settings.inlineDisplayTitle}</span>
        <select
          value={inlineDisplay}
          onChange={(event) => {
            void onInlineDisplayChange(event.target.value as InlineDisplayMode)
          }}
        >
          <option value="card">{copy.settings.inlineDisplayCard}</option>
          <option value="button">{copy.settings.inlineDisplayButton}</option>
        </select>
      </label>
      </section>

      <section className="settings-section">
      <h2>{copy.settings.anonymousStatsTitle}</h2>
      <p className="fine-print">{copy.settings.anonymousStatsHelp}</p>
      <label className="checkbox-row">
        <input
          checked={shareAnonymousStats}
          type="checkbox"
          onChange={(event) => {
            void onShareAnonymousStatsChange(event.target.checked)
          }}
        />
        <span>{copy.settings.anonymousStatsShare}</span>
      </label>
      </section>

      <section className="settings-section">
      <h2>{copy.settings.language}</h2>
      <label className="select-row">
        <span>{copy.settings.language}</span>
        <select
          value={localeSetting}
          onChange={(event) => {
            void onLocaleChange(event.target.value as LocaleSetting)
          }}
        >
          <option value="auto">{copy.settings.languageAuto}</option>
          <option value="de">{copy.settings.languageDe}</option>
          <option value="en">{copy.settings.languageEn}</option>
        </select>
      </label>
      </section>

      <section className="settings-section">
      <h2>{copy.settings.resetTitle}</h2>
      <button className="secondary-button" type="button" onClick={() => void onReset()}>
        {copy.settings.reset}
      </button>

      <p className="fine-print">
        {copy.settings.defaultText(DEFAULT_DEFAMATION_QUOTA_PERCENT)}
      </p>
      </section>

    </section>
  )
}

type StarRatingProps = {
  locale: Locale
  value: number
}

const StarRating = ({ locale, value }: StarRatingProps) => (
  <span className="star-rating" aria-label={`${formatRating(value, locale)} ${locale === 'de' ? 'von 5 Sternen' : 'out of 5 stars'}`}>
    {STAR_VALUES_DESC.toReversed().map((star) => {
      const source = value >= star ? fullStar : value >= star - 0.5 ? halfStar : emptyStar
      return <img alt="" key={star} src={source} />
    })}
  </span>
)

type StarIconRowProps = {
  count: StarValue
}

const StarIconRow = ({ count }: StarIconRowProps) => (
  <span className="star-icon-row" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <img alt="" key={index} src={fullStar} />
    ))}
  </span>
)

export default App
