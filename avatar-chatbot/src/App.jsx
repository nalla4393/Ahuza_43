import { useCallback, useEffect, useRef, useState } from "react";
import AvatarViewport from "./components/AvatarViewport.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import CustomizePanel from "./components/CustomizePanel.jsx";
import { loadImage } from "./lib/faceTexture.js";
import { speak, stopSpeaking } from "./lib/speech.js";

const KEY = "beulah-avatar-v2";

// Mouth/eye positions for public/beulah.png (photo UV, origin bottom-left).
const BEULAH_PRESET = { mouth: [0.487, 0.503], eyeL: [0.383, 0.685], eyeR: [0.608, 0.686] };

// Downscale + JPEG-encode so the photo fits in localStorage.
function toDataUrl(img, max = 1024) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

const imageFromUrl = (url) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = rej;
  i.src = url;
});

const CALIB_STEPS = [
  ["mouth", "Click the CENTER OF THE MOUTH (where the lips meet)"],
  ["eyeL", "Click the CENTER of the eye on the LEFT of the screen"],
  ["eyeR", "Click the CENTER of the eye on the RIGHT of the screen"],
];

// Uses the browser's experimental FaceDetector when present; otherwise returns null.
async function detectFace(img) {
  if (!("FaceDetector" in window)) return null;
  try {
    const [face] = await new window.FaceDetector({ maxDetectedFaces: 1 }).detect(img);
    const lm = face?.landmarks || [];
    const center = (l) => [l.locations.reduce((a, p) => a + p.x, 0) / l.locations.length, l.locations.reduce((a, p) => a + p.y, 0) / l.locations.length];
    const eyes = lm.filter((l) => l.type === "eye").map(center).sort((a, b) => a[0] - b[0]);
    const m = lm.find((l) => l.type === "mouth");
    if (eyes.length < 2 || !m) return null;
    const uv = ([x, y]) => [x / img.width, 1 - y / img.height];
    return { mouth: uv(center(m)), eyeL: uv(eyes[0]), eyeR: uv(eyes[1]) };
  } catch {
    return null;
  }
}

export default function App() {
  const avatar = useRef(null);
  const [mode, setMode] = useState("empty"); // empty | photo | model | cartoon
  const [ui, setUi] = useState({ background: "#dfe7f2", strength: 1 });
  const [calib, setCalib] = useState(null); // index into CALIB_STEPS while calibrating
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm Beulah. How can I help you today?" },
  ]);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

  const saved = useRef({ params: {} }); // { dataUrl, params } mirrored to localStorage

  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(saved.current)); }
    catch { setError("Could not save the photo in this browser (storage full)."); }
  };

  const applyParams = (p) => {
    avatar.current.setPhotoParams(p);
    saved.current.params = { ...saved.current.params, ...p };
    persist();
  };

  // Restore the last avatar on page load: saved copy first, then /beulah.png from the public folder.
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const { dataUrl, params } = JSON.parse(raw);
          const img = await imageFromUrl(dataUrl);
          avatar.current.showPhoto(img);
          saved.current = { dataUrl, params: params || {} };
          if (params?.mouth) avatar.current.setPhotoParams(params);
          setMode("photo");
          return;
        }
        const r = await fetch("/beulah.png");
        if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) {
          const img = await imageFromUrl(URL.createObjectURL(await r.blob()));
          await usePhoto(img, BEULAH_PRESET);
        }
      } catch { /* nothing saved yet */ }
    })();
  }, []);

  const set = useCallback((patch) => {
    setUi((p) => ({ ...p, ...patch }));
    if (patch.strength !== undefined) avatar.current?.setStrength(patch.strength);
  }, []);

  const startCalib = () => { avatar.current?.setFrozen(true); setCalib(0); };

  const usePhoto = async (img, presets) => {
    avatar.current.showPhoto(img);
    avatar.current.setStrength(ui.strength);
    saved.current = { dataUrl: toDataUrl(img), params: {} };
    persist();
    setMode("photo");
    const found = presets || (await detectFace(img));
    if (found) applyParams(found);
    else startCalib(); // ask the user to click the mouth and eyes once
  };

  const onPhoto = async (file) => {
    setError("");
    try {
      const { img } = await loadImage(file);
      await usePhoto(img);
    } catch (e) {
      setError(e.message);
    }
  };

  const onModel = async (file) => {
    setError("");
    try {
      await avatar.current.showModel(URL.createObjectURL(file));
      setMode("model");
    } catch {
      setError("Could not load that 3D model. Please use a humanoid .glb file.");
    }
  };

  const onDownload = () => {
    const a = document.createElement("a");
    a.href = saved.current.dataUrl;
    a.download = "beulah.png";
    a.click();
  };

  const onCartoon = () => { avatar.current.showCartoon(); setMode("cartoon"); };

  const onPick = (uv) => {
    applyParams({ [CALIB_STEPS[calib][0]]: uv });
    if (calib + 1 >= CALIB_STEPS.length) { setCalib(null); avatar.current.setFrozen(false); }
    else setCalib(calib + 1);
  };

  const send = async (content) => {
    setError("");
    stopSpeaking();
    const history = [...messages, { role: "user", content }];
    setMessages(history);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Request failed");
      const { text, gesture } = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: text }]);

      // Gesture and audio start in the same tick so they stay in sync.
      const estimate = Math.max(2, text.length * 0.06);
      avatar.current?.play(gesture, estimate + 0.5);
      if (muted) {
        avatar.current?.setSpeaking(true);
        setTimeout(() => avatar.current?.setSpeaking(false), estimate * 1000);
      } else {
        speak(text, {
          onStart: () => avatar.current?.setSpeaking(true),
          onBoundary: () => avatar.current?.pulse(),
          onEnd: () => avatar.current?.setSpeaking(false),
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <section className="stage">
        <div className="view">
          <AvatarViewport ref={avatar} background={ui.background} onPick={calib !== null ? onPick : undefined} />
          {mode === "empty" && (
            <div className="overlay">
              <h2>Create Beulah</h2>
              <p>Upload a front-facing photo to turn it into your talking avatar.</p>
              <label className="upload big">
                📷 Upload photo
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && onPhoto(e.target.files[0])} />
              </label>
            </div>
          )}
          {calib !== null && <div className="banner">Step {calib + 1}/3: {CALIB_STEPS[calib][1]}</div>}
        </div>
        <CustomizePanel mode={mode} background={ui.background} strength={ui.strength} set={set}
          onPhoto={onPhoto} onModel={onModel} onCartoon={onCartoon} onCalibrate={startCalib} onDownload={onDownload} />
      </section>
      <section className="side">
        <h1>Beulah – Customer Support</h1>
        {error && <div className="error">{error}</div>}
        <ChatPanel messages={messages} busy={busy} onSend={send} muted={muted} onToggleMute={() => setMuted((m) => !m)} />
      </section>
    </div>
  );
}
