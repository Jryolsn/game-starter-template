// Hjälpfunktioner för mobilkänsla. Alla är säkra att anropa även där stödet saknas,
// och ljud och vibration följer spelarens inställningar (profile.ts). Mikrofonen styrs av webbläsarens tillåtelse.
import { loadSettings } from "./profile.ts";

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
  if (!loadSettings().vibration) return;
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

// ---- Mikrofon: ljudnivå som styrning ----
// Bara nivån (ett tal) används; själva ljudet lämnar aldrig telefonen.
let mic: { stream: MediaStream; analyser: AnalyserNode; data: Float32Array<ArrayBuffer> } | null = null;
let micStarting: Promise<boolean> | null = null;

/**
 * Starta mikrofonen. Anropa från en tryckning: webbläsaren frågar om lov första gången,
 * och iOS kräver en tryckning. Ger false om spelaren nekar, sidan inte är https eller stöd saknas.
 */
export function startMic(): Promise<boolean> {
  if (mic?.stream.getAudioTracks()[0]?.readyState === "live") return Promise.resolve(true);
  micStarting ??= openMic().finally(() => (micStarting = null));
  return micStarting;
}

async function openMic(): Promise<boolean> {
  stopMic();
  unlockAudio();
  if (!audio || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    // Utan brusreducering och automatisk förstärkning, annars jämnas ljudnivån ut.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512; // ca 10 ms ljud per avläsning, så att nivån följer med snabbt
    audio.createMediaStreamSource(stream).connect(analyser); // inte till högtalaren
    mic = { stream, analyser, data: new Float32Array(analyser.fftSize) };
    return true;
  } catch {
    return false; // nekad, ingen mikrofon, eller sidan är inte https
  }
}

/**
 * Hur högt det låter just nu, 0 (tyst) till 1 (mycket högt). 0 om mikrofonen inte är igång.
 * Läs den t.ex. varje bildruta och skicka den, avrundad, som en del av spelarens input.
 */
export function micLevel(): number {
  if (!mic) return 0;
  mic.analyser.getFloatTimeDomainData(mic.data);
  let sum = 0;
  for (const s of mic.data) sum += s * s;
  const db = 10 * Math.log10(sum / mic.data.length + 1e-12);
  return Math.min(1, Math.max(0, (db + 60) / 60)); // -60 dB → 0, 0 dB → 1
}

/** Stäng av mikrofonen, så att telefonens inspelningsindikator släcks. */
export function stopMic(): void {
  for (const t of mic?.stream.getTracks() ?? []) t.stop();
  mic?.analyser.disconnect();
  mic = null;
}

// ---- Kamera ----
// Bilden stannar i telefonen. Spelet ritar den eller analyserar den (t.ex. med MediaPipe)
// och skickar bara resultatet som input, till exempel "handen är uppe".
export type CameraFacing = "user" | "environment";
let camera: { stream: MediaStream; video: HTMLVideoElement; facing: CameraFacing } | null = null;
let cameraStarting: Promise<HTMLVideoElement | null> | null = null;

/**
 * Starta kameran: "user" är framkameran (selfie), "environment" den bakre. Anropa från en tryckning;
 * webbläsaren frågar om lov första gången. Ger en <video> med kamerabilden, som spelet kan visa,
 * rita på sin canvas med drawImage eller analysera. Ger null om spelaren nekar, sidan inte är
 * https eller kamera saknas.
 */
export function startCamera(facing: CameraFacing = "user"): Promise<HTMLVideoElement | null> {
  const live = camera?.stream.getVideoTracks()[0]?.readyState === "live";
  if (camera && live && camera.facing === facing) return Promise.resolve(camera.video);
  cameraStarting ??= openCamera(facing).finally(() => (cameraStarting = null));
  return cameraStarting;
}

async function openCamera(facing: CameraFacing): Promise<HTMLVideoElement | null> {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    // Låg upplösning räcker för styrning och sparar batteri.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true; // annars öppnar iOS videon i helskärm
    video.srcObject = stream;
    await video.play().catch(() => {});
    camera = { stream, video, facing };
    return video;
  } catch {
    return null; // nekad, ingen kamera, eller sidan är inte https
  }
}

/** Stäng av kameran, så att telefonens kameraindikator släcks. */
export function stopCamera(): void {
  for (const t of camera?.stream.getTracks() ?? []) t.stop();
  if (camera) camera.video.srcObject = null;
  camera = null;
}
