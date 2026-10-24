// Avatar creation + appearance controls.
export default function CustomizePanel({ mode, background, strength, set, onPhoto, onModel, onCartoon, onCalibrate, onDownload }) {
  return (
    <div className="customize">
      <label className="upload">
        📷 {mode === "photo" ? "Change photo" : "Upload photo"}
        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && onPhoto(e.target.files[0])} />
      </label>
      {mode === "photo" && (
        <>
          <button onClick={onCalibrate}>🎯 Fix mouth/eyes</button>
          <button className="alt" onClick={onDownload}>💾 Save photo file</button>
          <label className="row">
            Mouth movement
            <input type="range" min="0.3" max="1.6" step="0.05" value={strength} onChange={(e) => set({ strength: parseFloat(e.target.value) })} />
          </label>
        </>
      )}
      <label className="upload alt">
        🧍 Load 3D model (.glb)
        <input type="file" accept=".glb,.gltf,model/gltf-binary" hidden onChange={(e) => e.target.files[0] && onModel(e.target.files[0])} />
      </label>
      <button className="alt" onClick={onCartoon}>Cartoon</button>
      <label className="row">
        Background
        <input type="color" value={background} onChange={(e) => set({ background: e.target.value })} />
      </label>
      <p className="hint">
        Photo: use a front-facing, evenly lit portrait. For a full realistic 3D body with hand gestures, create a
        selfie avatar (e.g. at avaturn.me), download it as .glb and load it here. Your photo is remembered in this browser and never uploaded to a server.
      </p>
    </div>
  );
}
