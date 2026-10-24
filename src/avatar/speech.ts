// Browser text-to-speech helpers. Callbacks let the avatar sync mouth movement with the audio.
import type { Gesture } from './photoAvatar';

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
  const preferred = /(female|samantha|zira|aria|jenny|google uk english female|google us english|karen|victoria)/i;
  return voices.find((voice) => preferred.test(voice.name)) || voices[0] || null;
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(text: string, handlers: { onStart: () => void; onBoundary: () => void; onEnd: () => void }): void {
  if (!speechSupported) {
    handlers.onStart();
    window.setTimeout(handlers.onEnd, Math.min(text.length * 60, 8000));
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.pitch = 1.1;
  utterance.onstart = handlers.onStart;
  utterance.onboundary = handlers.onBoundary;
  utterance.onend = handlers.onEnd;
  utterance.onerror = handlers.onEnd;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupported) window.speechSynthesis.cancel();
}

// Keyword intent parser: maps a reply to a gesture (the store API returns plain text only).
const RULES: Array<[RegExp, Gesture]> = [
  [/\b(hello|hi there|welcome|goodbye|bye|see you)\b/i, 'wave'],
  [/\b(sorry|apologi[sz]e|unfortunately|unable|inconvenience)\b/i, 'apologize'],
  [/\b(click|go to|you can find|located|menu|select|choose|open)\b/i, 'point'],
  [/\b(yes|sure|certainly|absolutely|of course|submitted|confirmed|happy to)\b/i, 'nod'],
  [/\b(let me check|checking|not sure|looking into)\b/i, 'think'],
  [/\b(because|first|then|steps?|how to|process|policy|days|status|delivery)\b/i, 'explain'],
];

export function gestureForText(text: string): Gesture {
  const tag = /\[\s*gesture\s*:\s*([a-z]+)\s*\]/i.exec(text)?.[1]?.toLowerCase();
  if (tag && RULES.some(([, gesture]) => gesture === tag)) return tag as Gesture;
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? 'idle';
}
