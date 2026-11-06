// Sound compat shim (issue #9): the canonical bank lives in
// ../audio/bank.ts under the `wordtable.sound` key (`On`/`Off`). This
// module keeps the issue #8 `playThunk` / `isSoundEnabled` /
// `setSoundEnabled` surface as a thin delegate, with legacy
// `wordtable-sound` reads migrated inside the bank so the two
// persistence keys cannot diverge.

import { isSoundOn, playSound, setSoundOn } from './bank'

export function isSoundEnabled(): boolean {
  try {
    return isSoundOn()
  } catch {
    return true
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    setSoundOn(on)
  } catch {
    // Persistence is best-effort; playback works regardless.
  }
}

export function playThunk(): void {
  try {
    playSound('thunk')
  } catch {
    // Sound must never break a commit.
  }
}
