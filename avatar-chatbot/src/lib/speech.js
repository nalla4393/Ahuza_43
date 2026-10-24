// Browser TTS + speech-to-text wrappers (Web Speech API; Chrome/Edge/Safari).

export const sttSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

function pickFemaleVoice() {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const hints = /(female|samantha|zira|aria|jenny|google uk english female|google us english|karen|victoria)/i;
  return voices.find((v) => hints.test(v.name)) || voices[0] || null;
}

/**
 * Speak text. Callbacks let the avatar sync mouth + gesture with the audio.
 * Resolves when speech finishes (or immediately if TTS is unavailable).
 */
export function speak(text, { onStart, onBoundary, onEnd } = {}) {
  return new Promise((resolve) => {
    const done = () => { onEnd?.(); resolve(); };
    if (!("speechSynthesis" in window)) { onStart?.(); return setTimeout(done, text.length * 60); }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickFemaleVoice();
    if (voice) u.voice = voice;
    u.pitch = 1.1;
    u.rate = 1;
    u.onstart = () => onStart?.();
    u.onboundary = () => onBoundary?.();
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function listen({ onResult, onEnd, onError }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => onResult(e.results[0][0].transcript);
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = onEnd;
  rec.start();
  return rec;
}
