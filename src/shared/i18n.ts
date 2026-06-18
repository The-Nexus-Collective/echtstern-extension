import { browser } from './browserApi'

export type Locale = 'de' | 'en'

export type LocaleSetting = 'auto' | Locale

export const DEFAULT_LOCALE_SETTING: LocaleSetting = 'auto'

const isLocale = (value: string): value is Locale => value === 'de' || value === 'en'

export const normalizeLocaleSetting = (value: unknown): LocaleSetting =>
  value === 'de' || value === 'en' || value === 'auto' ? value : DEFAULT_LOCALE_SETTING

const browserLocale = (): Locale => {
  const language =
    browser?.i18n?.getUILanguage
      ? browser.i18n.getUILanguage()
      : typeof navigator !== 'undefined'
        ? navigator.language
        : 'de'

  const primary = language.toLowerCase().split('-')[0]
  return isLocale(primary) ? primary : 'en'
}

export const resolveLocaleSetting = (setting: LocaleSetting): Locale =>
  setting === 'auto' ? browserLocale() : setting

export const localeToIntl = (locale: Locale): string => (locale === 'de' ? 'de-DE' : 'en-US')

export const messages = {
  de: {
    tabs: {
      estimate: 'Schätzung',
      settings: 'Einstellungen',
    },
    common: {
      echtstern: 'ECHTSTERN',
      google: 'Google',
      stars: 'Sterne',
      reviews: 'Bewertungen',
      settingsSaved: 'Gespeichert.',
    },
    content: {
      showEstimate: 'ECHTSTERN-Schätzung anzeigen',
      showEstimateTitle: (rating: string) => `ECHTSTERN-Schätzung anzeigen: ${rating} Sterne`,
      lowerThanGoogle: (difference: string) =>
        `ECHTSTERN-Schätzung liegt ${difference} Sterne unter der Google-Anzeige.`,
      lessThanThreshold: (threshold: string) =>
        `ECHTSTERN-Schätzung liegt weniger als ${threshold} Sterne unter der Google-Anzeige.`,
      inlineCardTitle: 'ECHTSTERN-Schätzung',
      inlineConfidenceShort: (low: string, high: string) => `(${low} – ${high})`,
      inlineMatchesGoogle: 'Entspricht der Google-Bewertung',
      inlineReviews: (count: string) => `${count} Berichte`,
      inlineReviewsWithAdded: (count: string, added: string) => `${count} + ${added} Berichte`,
      inlineNoRemovedChecked:
        'ECHTSTERN geprüft: Dieses Geschäft hat in den letzten 365 Tagen keine Bewertungen entfernen lassen.',
      outsideGermanyNotice:
        'Google lässt Bewertungen wegen Diffamierungsbeschwerden aktuell nur bei Profilen in Deutschland entfernen. Außerhalb Deutschlands zeigt ECHTSTERN deshalb keine Schätzung.',
      inlineOpenDetails: 'Details öffnen',
      inlineCardAriaLabel: (rating: string) =>
        `ECHTSTERN-Schätzung ${rating} Sterne. Zum Öffnen der Details klicken.`,
      popup: {
        brand: 'ECHTSTERN',
        cta: 'Bewertung mit ECHTSTERN prüfen',
        openReviewsLabel: 'Rezensionen-Tab öffnen und die ECHTSTERN-Bewertung prüfen.',
        valueAriaLabel: (rating: string) =>
          `ECHTSTERN-Schätzung ${rating} Sterne. Klicken, um die Rezensionen zu öffnen.`,
        removedInfo: (range: string) =>
          `ECHTSTERN: In den letzten 365 Tagen wurden ${range} Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernt. Zum Prüfen klicken.`,
        noRemovedInfo:
          'ECHTSTERN: Dieses Geschäft hat in den letzten 365 Tagen keine Bewertungen entfernen lassen. Zum Prüfen klicken.',
      },
    },
    estimate: {
      missingTitle: 'Kontext fehlt!',
      missingText:
        'Öffne in Google Maps das Rezensionen-Tab eines Geschäfts. ECHTSTERN nutzt Hinweise auf entfernte Bewertungen oder zeigt eine grüne Ampel, wenn keine gemeldet wurden.',
      outsideGermanyTitle: 'Außerhalb Deutschlands',
      outsideGermanyText:
        'Google lässt Bewertungen wegen Diffamierungsbeschwerden aktuell nur bei Profilen in Deutschland entfernen. Für dieses Profil zeigt ECHTSTERN deshalb keine Schätzung.',
      echtsternEstimate: 'ECHTSTERN-Schätzung',
      googleRating: 'Google-Bewertung',
      matchesGoogleDetail: 'Entspricht der ungerundeten Google-Bewertung.',
      confidenceInterval: (low: string, high: string) => `90% KI: ${low} - ${high}`,
      unrounded: (rating: string) => `ungerundet ${rating}`,
      noRemovedReviews: 'Dieses Geschäft hat in den letzten 365 Tagen keine Bewertungen entfernen lassen.',
      removedReviewsStatusPrefix: (range: string) =>
        `Dieses Geschäft hat in den letzten 365 Tagen ${range} Bewertungen aufgrund von Beschwerden wegen Diffamierung entfernen lassen. Das ergibt eine Lösch-Quote von`,
      howCalculated: 'Wie wird das Ergebnis berechnet?',
      download: 'Download',
      downloadPng: 'Ergebnis als PNG speichern',
      downloadSuccess: 'PNG gespeichert.',
      downloadError: 'PNG konnte nicht erstellt werden.',
      poweredBy: 'Powered by echtstern.de',
      noRemovedExplanation: (rating: string, count: string) =>
        `Für dieses Geschäft sind bei Google keine aufgrund von Diffamierung gemeldeten entfernten Bewertungen erkennbar. ECHTSTERN setzt die Schätzung daher gleich der von Google ausgewiesenen Bewertungsgrundlage (${rating} Sterne aus ${count} sichtbaren Bewertungen).`,
      smallSampleNoRemoved:
        'Bei weniger als 20 sichtbaren Rezensionen bleiben Aussagen zur Bewertung grundsätzlich unsicher.',
      monteCarloExplanation: (
        removedRange: string,
        assumedTrueDefamationCount: number,
        quota: string,
        adjustedRange: string,
        weights: string,
      ) =>
        `Von der Spanne der aufgrund von Beschwerden wegen Diffamierung entfernten Bewertungen (${removedRange}) werden zunächst, gemäß der Einstellungen, ${assumedTrueDefamationCount} angenommene echte Diffamierungen abgezogen (${quota}% der sichtbaren Bewertungen). Mit der daraus errechneten Spanne (${adjustedRange}) wird eine Monte-Carlo-Simulation (10.000 Szenarien) mit, gemäß der Einstellungen, folgender Gewichtung durchgeführt: ${weights} für 5/4/3/2/1 Sterne. Das Ergebnis der Simulation ist der Median und der 90%-Konfidenzintervall. Der Median entspricht der ECHTSTERN-Schätzung.`,
      smallSampleWarning: 'Bei weniger als 20 sichtbaren Rezensionen ist die Schätzung besonders unsicher.',
      openEndedRangeNote: 'Für „über 250“ wird technisch mit 251-300 entfernten Bewertungen simuliert.',
      howInterpret: 'Wie kann man das Ergebnis deuten?',
      interpretationItems: [
        'Die Ergebnisse sind eine Schätzung und nicht das tatsächliche Rating des Geschäfts.',
        'Google zeigt nur eine Spanne der entfernten Bewertungen. Wir wissen nicht, wie viele Bewertungen innerhalb dieser Spanne tatsächlich entfernt wurden.',
        'Die angezeigte Spanne beinhaltet nur entfernte Bewertungen aus den letzten 365 Tagen.',
        'Es gibt keine Informationen darüber, wie viele Bewertungen insgesamt, also seit Gründung des Geschäfts, entfernt worden sind. Eine Hochrechnung basierend auf der Zahl der entfernten Bewertungen innerhalb der letzten 365 Tage und dem Gründungsdatum des Geschäfts ist nur schwer möglich. Daher berücksichtigen wir das nicht.',
        'Ab einer Anzahl von mindestens 250 entfernten Bewertungen wird von Google nur noch „Mehr als 250“ angezeigt. Hier rechnen wir mit 251-300 entfernten Bewertungen. Die tatsächliche Anzahl kann deutlich höher sein.',
        'Aus diesen Gründen ist die angezeigte ECHTSTERN-Schätzung wahrscheinlich eher zu optimistisch.',
        'Klarstellend sei gesagt, dass es natürlich auch Geschäfte gibt, die echte großflächige Diffamierungen erleiden oder erlitten haben. Die ECHTSTERN-Schätzung ist in diesen Fällen wahrscheinlich zu pessimistisch.',
        'ECHTSTERN arbeitet mit keinen anderen Daten als denen, die Google öffentlich zur Verfügung stellt.',
        'Mehr Informationen zu Googles Richtlinien über die Entfernung von diffamierenden Bewertungen findest du im',
        'ECHTSTERN ist eine unabhängige Extension und steht in keinerlei Zusammenarbeit mit Google.',
      ],
      distribution: {
        title: 'Sterneverteilung',
        added: 'geschätzt ergänzt',
        empty: (rating: string, count: string) =>
          `Google-Sternebalken wurden noch nicht erkannt. Erkannte Basis: ${rating} aus ${count} Bewertungen. Falls du die Balken in Google Maps siehst, ist die geladene Extension wahrscheinlich noch nicht aktualisiert oder Google nutzt eine andere DOM-Variante.`,
      },
    },
    settings: {
      title: 'Diffamierungsquote',
      language: 'Sprache',
      languageAuto: 'Automatisch',
      languageDe: 'Deutsch',
      languageEn: 'English',
      trueDefamationQuota: 'Angenommene echte Diffamierungsquote:',
      quota: 'Quote',
      quotaHelp:
        'Diese Quote wird auf die sichtbare Gesamtzahl der Bewertungen (auch „Berichte“) angewendet und vor der Schätzung von der angegebenen Spanne an entfernten Bewertungen abgezogen. Das heißt bspw., bei 1000 Bewertungen und 2% Quote werden 20 Bewertungen als reale Diffamierungen angenommen und von der Spanne abgezogen.',
      remainingAssumption: 'Umrechnungsannahme restlicher Bewertungen:',
      remainingAssumptionHelp: (average: string) =>
        `Jede wegen Diffamierung entfernte Bewertung, welche nicht unter die oben genannte Quote fällt, wird im Durchschnitt mit ${average} Sterne angerechnet.`,
      starShare: (star: number) => `${star}-Sterne-Anteil`,
      invalidWeights: 'Die Summe muss 100% ergeben, bevor die Annahme gespeichert wird.',
      warningThresholds: 'Warnungsgrenzen',
      warningThresholdHelp:
        'Differenz zwischen der angezeigten Google-Bewertung und der ECHTSTERN-Schätzung in Sternen.',
      thresholdLabels: {
        yellowGreenBoundary: 'Grüner ✓ / Gelber ✓ (Grenze)',
        yellowQuestionAbove: 'Gelbes ? ab',
        redExclamationAbove: 'Rotes ! ab',
      },
      resetTitle: 'Zurücksetzen',
      reset: 'Zurücksetzen auf Standard',
      defaultText: (quota: number) =>
        `Standard: Umrechnungsannahme 0% 5 Sterne, 0% 4 Sterne, 10% 3 Sterne, 20% 2 Sterne, 70% 1 Stern, ${quota}% echte Diffamierungsquote und Warnungsgrenzen von 0,05, 0,15 und 0,30 Sterne-Differenz. Disclaimer: Diese Standardwerte basieren auf keinen wissenschaftlichen oder empirischen Daten.`,
      weightSumError: 'Die Gewichtung muss in Summe 100% ergeben.',
      quotaSaved: 'Diffamierungsquote gespeichert.',
      thresholdsSaved: 'Warnungsgrenzen gespeichert.',
      defaultsSaved: 'Standard-Annahme gespeichert.',
      languageSaved: 'Sprache gespeichert.',
      inlineDisplayTitle: 'Anzeige in Google Maps',
      inlineDisplayHelp:
        'Wie soll die ECHTSTERN-Schätzung neben der Google-Bewertung angezeigt werden?',
      inlineDisplayCard: 'Direkt einbetten',
      inlineDisplayButton: 'Button anzeigen',
      inlineDisplaySaved: 'Anzeige gespeichert.',
      anonymousStatsTitle: 'Anonyme Beobachtungsdaten',
      anonymousStatsHelp:
        'ECHTSTERN kann öffentlich sichtbare Bewertungsdaten an echtstern.de senden, um aggregierte Entwicklungen über Zeit auszuwerten. Es werden keine Review-Texte, Google-Kontodaten oder Browser-Historie übertragen.',
      anonymousStatsShare: 'Anonyme Beobachtungsdaten teilen',
      anonymousStatsSaved: 'Statistik-Einstellung gespeichert.',
    },
  },
  en: {
    tabs: {
      estimate: 'Estimate',
      settings: 'Settings',
    },
    common: {
      echtstern: 'ECHTSTERN',
      google: 'Google',
      stars: 'stars',
      reviews: 'reviews',
      settingsSaved: 'Saved.',
    },
    content: {
      showEstimate: 'Show ECHTSTERN estimate',
      showEstimateTitle: (rating: string) => `Show ECHTSTERN estimate: ${rating} stars`,
      lowerThanGoogle: (difference: string) =>
        `The ECHTSTERN estimate is ${difference} stars below the Google rating.`,
      lessThanThreshold: (threshold: string) =>
        `The ECHTSTERN estimate is less than ${threshold} stars below the Google rating.`,
      inlineCardTitle: 'ECHTSTERN estimate',
      inlineConfidenceShort: (low: string, high: string) => `(${low} – ${high})`,
      inlineMatchesGoogle: 'Matches the Google rating',
      inlineReviews: (count: string) => `${count} reports`,
      inlineReviewsWithAdded: (count: string, added: string) => `${count} + ${added} reports`,
      inlineNoRemovedChecked:
        'ECHTSTERN checked: This business has not had any reviews removed in the last 365 days.',
      outsideGermanyNotice:
        'Google currently only allows reviews to be removed for defamation complaints on profiles in Germany. ECHTSTERN therefore does not show an estimate outside Germany.',
      inlineOpenDetails: 'Open details',
      inlineCardAriaLabel: (rating: string) =>
        `ECHTSTERN estimate ${rating} stars. Click to open details.`,
      popup: {
        brand: 'ECHTSTERN',
        cta: 'Check rating with ECHTSTERN',
        openReviewsLabel: 'Open the reviews tab and check the ECHTSTERN rating.',
        valueAriaLabel: (rating: string) =>
          `ECHTSTERN estimate ${rating} stars. Click to open the reviews.`,
        removedInfo: (range: string) =>
          `ECHTSTERN: ${range} reviews were removed in the last 365 days due to defamation complaints. Click to check.`,
        noRemovedInfo:
          'ECHTSTERN: This business has not had any reviews removed in the last 365 days. Click to check.',
      },
    },
    estimate: {
      missingTitle: 'Missing context',
      missingText:
        'Open the reviews tab of a business in Google Maps. ECHTSTERN uses notices about removed reviews or shows a green status when none are reported.',
      outsideGermanyTitle: 'Outside Germany',
      outsideGermanyText:
        'Google currently only allows reviews to be removed for defamation complaints on profiles in Germany. ECHTSTERN therefore does not show an estimate for this profile.',
      echtsternEstimate: 'ECHTSTERN estimate',
      googleRating: 'Google rating',
      matchesGoogleDetail: 'Matches the unrounded Google rating.',
      confidenceInterval: (low: string, high: string) => `90% CI: ${low} - ${high}`,
      unrounded: (rating: string) => `unrounded ${rating}`,
      noRemovedReviews: 'This business has not had any reviews removed in the last 365 days.',
      removedReviewsStatusPrefix: (range: string) =>
        `This business has had ${range} reviews removed in the last 365 days due to defamation complaints. This results in a removal rate of`,
      howCalculated: 'How is the result calculated?',
      download: 'Download',
      downloadPng: 'Save result as PNG',
      downloadSuccess: 'PNG saved.',
      downloadError: 'Could not create PNG.',
      poweredBy: 'Powered by echtstern.de',
      noRemovedExplanation: (rating: string, count: string) =>
        `Google does not show any reported reviews removed due to defamation for this business. ECHTSTERN therefore uses the same rating basis as Google (${rating} stars from ${count} visible reviews).`,
      smallSampleNoRemoved:
        'With fewer than 20 visible reviews, statements about the rating are generally less reliable.',
      monteCarloExplanation: (
        removedRange: string,
        assumedTrueDefamationCount: number,
        quota: string,
        adjustedRange: string,
        weights: string,
      ) =>
        `From the range of reviews removed due to defamation complaints (${removedRange}), ECHTSTERN first subtracts ${assumedTrueDefamationCount} reviews assumed to be genuine defamation (${quota}% of visible reviews), according to your settings. The adjusted range (${adjustedRange}) is then used for a Monte Carlo simulation (10,000 scenarios) with this star weighting from your settings: ${weights} for 5/4/3/2/1 stars. The simulation result is the median and the 90% confidence interval. The median is the ECHTSTERN estimate.`,
      smallSampleWarning: 'With fewer than 20 visible reviews, the estimate is especially uncertain.',
      openEndedRangeNote: 'For “more than 250”, ECHTSTERN technically simulates 251-300 removed reviews.',
      howInterpret: 'How should this result be interpreted?',
      interpretationItems: [
        'The results are an estimate, not the actual rating of the business.',
        'Google only shows a range of removed reviews. We do not know how many reviews within that range were actually removed.',
        'The displayed range only includes removed reviews from the last 365 days.',
        'There is no information about how many reviews have been removed in total since the business was created. Projecting this from the removals in the last 365 days and the founding date is difficult, so we do not account for it.',
        'Once at least 250 reviews have been removed, Google only shows “More than 250”. ECHTSTERN calculates with 251-300 removed reviews here. The actual number can be significantly higher.',
        'For these reasons, the displayed ECHTSTERN estimate is probably rather optimistic.',
        'To be clear, some businesses can of course suffer genuine large-scale defamation. In those cases, the ECHTSTERN estimate is probably too pessimistic.',
        'ECHTSTERN uses no data other than what Google makes publicly available.',
        'You can find more information about Google’s policies on removing defamatory reviews in the',
        'ECHTSTERN is an independent extension and is not affiliated with Google.',
      ],
      distribution: {
        title: 'Star distribution',
        added: 'estimated additions',
        empty: (rating: string, count: string) =>
          `Google star bars have not been detected yet. Detected basis: ${rating} from ${count} reviews. If you can see the bars in Google Maps, the loaded extension is probably not updated yet or Google is using a different DOM variant.`,
      },
    },
    settings: {
      title: 'Defamation quota',
      language: 'Language',
      languageAuto: 'Automatic',
      languageDe: 'Deutsch',
      languageEn: 'English',
      trueDefamationQuota: 'Assumed genuine defamation quota:',
      quota: 'Quota',
      quotaHelp:
        'This quota is applied to the visible total number of reviews (also “reports”) and subtracted from the displayed range of removed reviews before the estimate. For example, with 1,000 reviews and a 2% quota, 20 reviews are assumed to be genuine defamation and subtracted from the range.',
      remainingAssumption: 'Conversion assumption for the remaining reviews:',
      remainingAssumptionHelp: (average: string) =>
        `Each review removed due to defamation that is not covered by the quota above is counted as ${average} stars on average.`,
      starShare: (star: number) => `${star}-star share`,
      invalidWeights: 'The total must be 100% before the assumption can be saved.',
      warningThresholds: 'Warning thresholds',
      warningThresholdHelp:
        'Difference between the displayed Google rating and the ECHTSTERN estimate in stars.',
      thresholdLabels: {
        yellowGreenBoundary: 'Green ✓ / Yellow ✓ boundary',
        yellowQuestionAbove: 'Yellow ? from',
        redExclamationAbove: 'Red ! from',
      },
      resetTitle: 'Reset',
      reset: 'Reset to defaults',
      defaultText: (quota: number) =>
        `Default: conversion assumption 0% 5 stars, 0% 4 stars, 10% 3 stars, 20% 2 stars, 70% 1 star, ${quota}% genuine defamation quota and warning thresholds of 0.05, 0.15 and 0.30 stars difference. Disclaimer: these defaults are not based on scientific or empirical data.`,
      weightSumError: 'The weighting must add up to 100%.',
      quotaSaved: 'Defamation quota saved.',
      thresholdsSaved: 'Warning thresholds saved.',
      defaultsSaved: 'Default assumption saved.',
      languageSaved: 'Language saved.',
      inlineDisplayTitle: 'Display on Google Maps',
      inlineDisplayHelp:
        'How should the ECHTSTERN estimate appear next to the Google rating?',
      inlineDisplayCard: 'Embed estimate directly',
      inlineDisplayButton: 'Show button only',
      inlineDisplaySaved: 'Display preference saved.',
      anonymousStatsTitle: 'Anonymous observation data',
      anonymousStatsHelp:
        'ECHTSTERN can send publicly visible rating data to echtstern.de to analyze aggregated changes over time. It does not send review texts, Google account data, or browser history.',
      anonymousStatsShare: 'Share anonymous observation data',
      anonymousStatsSaved: 'Statistics preference saved.',
    },
  },
} as const

export type Messages = (typeof messages)[Locale]

export const getMessages = (locale: Locale): Messages => messages[locale]
