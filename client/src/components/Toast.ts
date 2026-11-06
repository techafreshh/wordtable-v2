// Toast — the friendly refusal surface (issue #8). #toast carries
// role=status and is hidden whenever the uiStore toast is null. Copy is set
// verbatim (e.g. `Not in my book: XYZQ`); the ≥2 s visibility window lives
// in the uiStore showToast timer, so rapid illegal plays replace the text
// and restart the clock.

import { uiStore } from '../store/ui'

export function buildToastHTML(toast: string | null): string {
  if (toast === null || toast === '') {
    return '<div id="toast" role="status" hidden></div>'
  }
  return `<div id="toast" role="status">${escapeHTML(toast)}</div>`
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function showToastText(text: string): void {
  uiStore.getState().showToast(text)
}

export function hideToast(): void {
  uiStore.getState().clearToast()
}

export function mountToast(toastEl: HTMLElement): void {
  if (toastEl.dataset.mounted === '1') return
  toastEl.dataset.mounted = '1'

  const paint = (): void => {
    const toast = uiStore.getState().toast
    if (toast === null || toast === '') {
      toastEl.setAttribute('hidden', '')
      toastEl.textContent = ''
    } else {
      toastEl.removeAttribute('hidden')
      // textContent keeps the refusal copy byte-exact.
      toastEl.textContent = toast
    }
  }
  paint()
  uiStore.subscribe(paint)
}
