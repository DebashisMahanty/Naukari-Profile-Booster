/**
 * DOM helpers used by content script execution paths.
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function randomDelayMs(minSeconds = 2, maxSeconds = 6) {
  const min = Math.floor(minSeconds * 1000);
  const max = Math.floor(maxSeconds * 1000);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function waitForElement(selectors, timeoutMs = 12000, intervalMs = 250) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    for (const selector of selectorList) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }
    await sleep(intervalMs);
  }

  return null;
}

export function findElementByText(candidateSelector, textNeedles = []) {
  const normalizedNeedles = textNeedles.map((needle) => needle.toLowerCase());
  const nodes = [...document.querySelectorAll(candidateSelector)];

  return nodes.find((node) => {
    const value = (node.innerText || node.textContent || "").toLowerCase();
    return normalizedNeedles.some((needle) => value.includes(needle));
  }) || null;
}
