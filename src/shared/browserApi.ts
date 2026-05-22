type BrowserApi = typeof chrome

const globalBrowser = globalThis as {
  browser?: BrowserApi
  chrome?: BrowserApi
}

export const browser: BrowserApi | undefined = globalBrowser.browser ?? globalBrowser.chrome

export const hasBrowserLocalStorage = (): boolean => Boolean(browser?.storage?.local)

export const hasBrowserSyncStorage = (): boolean => Boolean(browser?.storage?.sync)
