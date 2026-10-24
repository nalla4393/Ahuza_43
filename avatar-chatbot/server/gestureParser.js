// Maps raw LLM output -> { text, gesture, emotion }.
// 1) Prefer an explicit tag: [gesture: wave]
// 2) Otherwise infer from the text (lightweight intent/emotion heuristics).
export const GESTURES = ["wave", "point", "nod", "explain", "apologize", "think", "idle"];

const TAG_RE = /\[\s*gesture\s*:\s*([a-z_]+)\s*\]/gi;

const HEURISTICS = [
  [/\b(hello|hi there|welcome|goodbye|bye|see you)\b/i, "wave", "happy"],
  [/\b(sorry|apologi[sz]e|unfortunately|inconvenience)\b/i, "apologize", "sad"],
  [/\b(click|go to|you can find|located|see the|menu)\b/i, "point", "neutral"],
  [/\b(yes|sure|certainly|absolutely|of course|got it)\b/i, "nod", "happy"],
  [/\b(because|first|then|steps?|how to|process|policy)\b/i, "explain", "neutral"],
  [/\b(let me check|hmm|not sure|looking into)\b/i, "think", "neutral"],
];

const EMOTION_BY_GESTURE = { wave: "happy", nod: "happy", apologize: "sad", point: "neutral", explain: "neutral", think: "neutral", idle: "neutral" };

export function parseReply(raw) {
  let gesture = null;
  // Take the first valid tag, then strip all tags so they are never spoken or shown.
  const text = String(raw)
    .replace(TAG_RE, (_, g) => {
      const name = g.toLowerCase();
      if (!gesture && GESTURES.includes(name)) gesture = name;
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();

  let emotion = gesture ? EMOTION_BY_GESTURE[gesture] : "neutral";
  if (!gesture) {
    gesture = "idle";
    for (const [re, g, e] of HEURISTICS) {
      if (re.test(text)) {
        gesture = g;
        emotion = e;
        break;
      }
    }
  }
  return { text, gesture, emotion };
}
