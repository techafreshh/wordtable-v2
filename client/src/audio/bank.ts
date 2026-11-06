// Canonical Howler sound bank (issue #9). Four UI sounds with a
// persisted mute flag. Playback degrades to a silent no-op when wav
// assets, the AudioContext (SSR/tests) or Howler itself are missing, so
// audio can never break rendering. Howler is lazily imported — never a
// static module-level import — so vitest/node stays green.

export type SoundName = 'thunk' | 'fanfare' | 'bag' | 'error'

const SOUND_KEY = 'wordtable.sound'
const LEGACY_KEY = 'wordtable-sound'

const VOLUMES: Record<SoundName, number> = {
  thunk: 0.5,
  fanfare: 0.6,
  bag: 0.4,
  error: 0.4,
}

interface HowlLike {
  play(): void
}

const howls = new Map<SoundName, HowlLike | null>()
let howlerFailed = false

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

// Legacy `wordtable-sound` (`on`/`off`) migrates to `wordtable.sound`
// (`On`/`Off`) on first read so the two keys cannot diverge.
function readStored(): 'On' | 'Off' | null {
  const store = storage()
  if (store === null) return null
  try {
    const raw = store.getItem(SOUND_KEY)
    if (raw === 'On' || raw === 'Off') return raw
    const legacy = store.getItem(LEGACY_KEY)
    if (legacy === 'on' || legacy === 'off') {
      const migrated = legacy === 'on' ? 'On' : 'Off'
      store.setItem(SOUND_KEY, migrated)
      return migrated
    }
    return null
  } catch {
    return null
  }
}

export function isSoundOn(): boolean {
  const stored = readStored()
  return stored === null ? true : stored === 'On'
}

export function setSoundOn(on: boolean): void {
  try {
    const store = storage()
    if (store !== null) {
      store.setItem(SOUND_KEY, on ? 'On' : 'Off')
      store.removeItem(LEGACY_KEY)
    }
  } catch {
    // Persistence is best-effort; the toggle still applies in-memory.
  }
  // Mirror into the Howler master volume without awaiting it.
  if (!howlerFailed) {
    import('howler')
      .then((mod) => {
        try {
          mod.Howler.volume(on ? 1 : 0)
        } catch {
          // No audio device: stay silent.
        }
      })
      .catch(() => {
        howlerFailed = true
      })
  }
}

export function playSound(name: SoundName): void {
  try {
    if (!isSoundOn()) return
    const cached = howls.get(name)
    if (cached) {
      try {
        cached.play()
      } catch {
        // Autoplay denied or no audio device: stay silent.
      }
      return
    }
    if (cached === null || howlerFailed) return
    howls.set(name, null)
    void import('howler')
      .then((mod) => {
        try {
          const howl = new mod.Howl({
            src: [`sounds/${name}.wav`],
            volume: VOLUMES[name] ?? 0.5,
            preload: true,
          }) as unknown as HowlLike
          howls.set(name, howl)
          if (!isSoundOn()) return
          try {
            howl.play()
          } catch {
            // Autoplay denied or no audio device: stay silent.
          }
        } catch {
          // Missing asset or audio stack: stay silent.
        }
      })
      .catch(() => {
        howlerFailed = true
      })
  } catch {
    // Sound must never break the caller.
  }
}
