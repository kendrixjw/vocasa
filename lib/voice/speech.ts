// Thin wrapper over the browser Web Speech API (SpeechRecognition). The mic is
// just a transcript source: interim results stream to `onInterim`, and the final
// utterance goes to `onFinal`, which the caller pipes into the SAME op bridge as
// typed text. Whisper/other STT can slot in later behind this same interface.
//
// The Web Speech API types aren't in every lib.dom config, so we declare the
// minimal shape we use rather than pulling `any`.

interface SRAlternative {
  readonly transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  readonly [index: number]: SRResult;
}
interface SREvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRConstructor = new () => SpeechRecognitionLike;

function getCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return getCtor() !== null;
}

export type VoiceHandlers = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

/** A single-utterance push-to-talk recognizer. Call start() to listen, stop() to end. */
export class VoiceRecognizer {
  private rec: SpeechRecognitionLike | null = null;
  private handlers: VoiceHandlers = {};
  private active = false;

  constructor(handlers: VoiceHandlers = {}) {
    this.handlers = handlers;
  }

  get supported(): boolean {
    return isSpeechSupported();
  }
  get listening(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    const Ctor = getCtor();
    if (!Ctor) {
      this.handlers.onError?.("Voice input isn't supported in this browser.");
      return;
    }
    const rec = new Ctor();
    rec.lang =
      (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.active = true;
      this.handlers.onStart?.();
    };
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text;
        else interim += text;
      }
      if (interim) this.handlers.onInterim?.(interim.trim());
      if (final) this.handlers.onFinal?.(final.trim());
    };
    rec.onerror = (e) => {
      // "aborted" fires when we stop()/abort() the recognizer ourselves — it's
      // not a real failure, so don't surface it to the user.
      if (e.error === "aborted") return;

      let msg: string;
      switch (e.error) {
        case "not-allowed":
        case "service-not-allowed":
          msg = "Microphone access was blocked. Allow the mic in your browser and try again.";
          break;
        case "no-speech":
          msg = "I didn't hear anything. Try again.";
          break;
        case "audio-capture":
          msg = "No microphone was found. Check that one is connected.";
          break;
        case "network":
          // Browser speech recognition relies on an online service (e.g. Google
          // in Chrome); this is the usual culprit for a generic failure.
          msg = "Voice service is unavailable right now. Check your connection, or type your command.";
          break;
        case "language-not-supported":
          msg = "This browser can't recognize the current language. Try typing instead.";
          break;
        default:
          msg = `Voice input error (${e.error || "unknown"}).`;
      }
      this.handlers.onError?.(msg);
    };
    rec.onend = () => {
      this.active = false;
      this.rec = null;
      this.handlers.onEnd?.();
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.active = false;
      this.rec = null;
      this.handlers.onError?.("Couldn't start the microphone.");
    }
  }

  stop(): void {
    this.rec?.stop();
  }

  abort(): void {
    this.rec?.abort();
  }
}
