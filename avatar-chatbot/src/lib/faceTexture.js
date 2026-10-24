// Builds the face texture from an uploaded photo (or a procedural default face).
// The canvas is 3:4 to match the face plane, with a feathered oval alpha mask
// so the photo blends into the head instead of showing hard rectangle edges.
export const FACE_W = 384;
export const FACE_H = 512;

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}

// Average colour of the central patch of the photo -> used for neck/hands so they match.
export function sampleSkin(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  const s = Math.min(img.width, img.height) * 0.2;
  ctx.drawImage(img, img.width / 2 - s / 2, img.height * 0.5 - s / 2, s, s, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

function applyOvalMask(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.translate(FACE_W / 2, FACE_H / 2);
  ctx.scale(1, FACE_H / FACE_W);
  const grad = ctx.createRadialGradient(0, 0, FACE_W * 0.36, 0, 0, FACE_W * 0.5);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(-FACE_W, -FACE_W, FACE_W * 2, FACE_W * 2);
  ctx.restore();
}

/**
 * @param img   HTMLImageElement (uploaded photo) or null for the default face
 * @param zoom  1 = image fills the plane; >1 zooms in
 * @param ox,oy pan in [-1,1]
 */
export function buildFaceCanvas({ img, zoom = 1, ox = 0, oy = 0, skin = "#e8b89a" }) {
  const c = document.createElement("canvas");
  c.width = FACE_W;
  c.height = FACE_H;
  const ctx = c.getContext("2d");

  if (img) {
    // "Cover" crop to the 3:4 aspect, then apply zoom/pan.
    const aspect = FACE_W / FACE_H;
    let sw = img.width, sh = img.width / aspect;
    if (sh > img.height) { sh = img.height; sw = sh * aspect; }
    sw /= zoom; sh /= zoom;
    const sx = (img.width - sw) / 2 + (ox * (img.width - sw)) / 2;
    const sy = (img.height - sh) / 2 + (oy * (img.height - sh)) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, FACE_W, FACE_H);
  } else {
    // Simple stylised default face.
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, FACE_W, FACE_H);
    ctx.fillStyle = "#fff";
    for (const x of [135, 249]) { ctx.beginPath(); ctx.ellipse(x, 215, 26, 14, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#3b2a20";
    for (const x of [135, 249]) { ctx.beginPath(); ctx.arc(x, 215, 10, 0, 7); ctx.fill(); }
    ctx.strokeStyle = "#4a3326"; ctx.lineWidth = 6; ctx.lineCap = "round";
    for (const [a, b] of [[105, 165], [219, 279]]) { ctx.beginPath(); ctx.moveTo(a, 178); ctx.lineTo(b, 172); ctx.stroke(); }
    ctx.strokeStyle = "#c98a7a"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(192, 230); ctx.lineTo(186, 290); ctx.lineTo(198, 292); ctx.stroke();
    ctx.fillStyle = "#c9566a";
    ctx.beginPath(); ctx.ellipse(192, 355, 34, 9, 0, 0, 7); ctx.fill();
  }
  applyOvalMask(ctx);
  return c;
}
