// Sound toggle (issue #9): a single `#sound-toggle` button whose label
// is exactly `Sound: On` / `Sound: Off`, persisted via the audio bank.

import { isSoundOn, setSoundOn } from '../audio/bank'

export function buildSoundToggleHTML(on: boolean): string {
  return `<button type="button" id="sound-toggle" aria-pressed="${on ? 'true' : 'false'}">Sound: ${on ? 'On' : 'Off'}</button>`
}

export function repaintSoundToggle(el: HTMLElement): void {
  try {
    el.textContent = `Sound: ${isSoundOn() ? 'On' : 'Off'}`
    el.setAttribute('aria-pressed', isSoundOn() ? 'true' : 'false')
  } catch {
    // The toggle must never break the table.
  }
}

export function mountSoundToggle(el: HTMLElement): void {
  if (el.dataset.soundMounted === '1') return
  el.dataset.soundMounted = '1'
  repaintSoundToggle(el)
  el.addEventListener('click', () => {
    try {
      setSoundOn(!isSoundOn())
    } catch {
      // Persistence is best-effort.
    }
    repaintSoundToggle(el)
  })
}
