// Sound bank — Howler thunk hook for successful commits (issue #8).
// Sound defaults on but never blocks: Howler construction and play() are
// wrapped so missing wav assets, missing AudioContext (SSR/tests) or
// denied autoplay degrade to a silent no-op. The persisted mute flag lives
// in localStorage; there is deliberately no toggle UI in this lap.

let enabledCache: boolean | null = null

export function isSoundEnabled(): boolean {
  if (enabledCache !== null) return enabledCache
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem('wordtable-sound') : null
    enabledCache = raw === null ? true : raw !== 'off'
  } catch {
    enabledCache = true
  }
  return enabledCache
}

export function setSoundEnabled(on: boolean): void {
  enabledCache = on
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wordtable-sound', on ? 'on' : 'off')
    }
  } catch {
    // Persistence is best-effort; playback works regardless.
  }
}

export function playThunk(): void {
  try {
    if (!isSoundEnabled()) return
    playThunkHowl()
  } catch {
    // Sound must never break a commit.
  }
}

// Isolated so the Howler import + construction cost happens only once, while
// every successful commit still replays the cached thunk. Any failure stays
// inside the try/catch so sound degrades to a silent no-op.
let thunkHowl: { play(): void } | null = null
let thunkPromise: Promise<{ play(): void } | null> | null = null

function playThunkHowl(): void {
  try {
    if (!isSoundEnabled()) return
    if (thunkHowl) {
      try {
        thunkHowl.play()
      } catch {
        // Autoplay denied or no audio device: stay silent.
      }
      return
    }
    if (thunkPromise === null) {
      thunkPromise = import('howler')
        .then((mod) => {
          try {
            const howl = new mod.Howl({
              src: ['sounds/thunk.wav'],
              volume: 0.5,
              preload: true,
            })
            thunkHowl = howl
            return howl as { play(): void }
          } catch {
            // Missing asset or audio stack: stay silent.
            return null
          }
        })
        .catch(() => {
          // Howler itself unavailable: stay silent.
          return null
        })
    }
    void thunkPromise.then((howl) => {
      try {
        if (!isSoundEnabled()) return
        howl?.play()
      } catch {
        // Autoplay denied or no audio device: stay silent.
      }
    })
  } catch {
    // Sound must never break a commit.
  }
}
