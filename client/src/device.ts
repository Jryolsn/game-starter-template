// Hjälpfunktioner för mobilkänsla. Alla är säkra att anropa även där stödet saknas.

// ---- Håll skärmen tänd under en runda ----
let wakeLock: WakeLockSentinel | null = null;
let wantAwake = false;

export async function keepAwake(): Promise<void> {
  wantAwake = true;
  if (wakeLock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {
    // Nekas t.ex. i strömsparläge. Spelet fungerar ändå.
  }
}

export function releaseAwake(): void {
  wantAwake = false;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// Webbläsaren släpper låset när fliken döljs; ta det igen när spelaren kommer tillbaka.
document.addEventListener("visibilitychange", () => {
  if (wantAwake && document.visibilityState === "visible") keepAwake();
});

// ---- Vibration ----
/** Kort vibration som feedback. Stöds på Android; iOS Safari ignorerar det tyst. */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

// ---- Ljud ----
let audio: AudioContext | null = null;

/** Anropa från en tryckning (knapp, touch). iOS spelar inget ljud förrän ljudet låsts upp så. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
  } catch {}
}

/** Enkel syntetiserad ton, bra som platshållare tills spelet har riktiga ljudfiler. */
export function playTone(freq: number, seconds: number, volume = 0.15): void {
  if (audio?.state !== "running") return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const t = audio.currentTime;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + seconds);
}

/** Spela en ljudfil (t.ex. från client/public/sounds). Laddas och cachas vid första användning. */
const buffers = new Map<string, Promise<AudioBuffer>>();
export async function playSound(url: string, volume = 1): Promise<void> {
  if (audio?.state !== "running") return;
  const ctx = audio;
  if (!buffers.has(url))
    buffers.set(
      url,
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b)),
    );
  try {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = await buffers.get(url)!;
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
  } catch {}
}
