import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPhotoAvatar, type Frame, type Gesture, type PhotoAvatar } from './photoAvatar';

export type BeulahAvatarHandle = {
  play: (gesture: Gesture, seconds: number) => void;
  setSpeaking: (value: boolean) => void;
  pulse: () => void;
};

export const AVATAR_IMAGE = '/beulah-avatar.jpg';

const FACE_FRAME: Frame = { centerY: 0.6, zoom: 1.12 };

// Round animated portrait; falls back to the still photo if WebGL is unavailable.
// Calls made before the image has loaded are remembered and applied once it is ready.
const BeulahAvatar = forwardRef<BeulahAvatarHandle, { imageUrl?: string }>(function BeulahAvatar({ imageUrl }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<PhotoAvatar | null>(null);
  const pending = useRef<{ speaking: boolean; gesture?: [Gesture, number] }>({ speaking: false });
  const [failed, setFailed] = useState(false);
  const [customFailed, setCustomFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    play: (gesture, seconds) => {
      pending.current.gesture = [gesture, seconds];
      avatarRef.current?.play(gesture, seconds);
    },
    setSpeaking: (value) => {
      pending.current.speaking = value;
      avatarRef.current?.setSpeaking(value);
    },
    pulse: () => avatarRef.current?.pulse(),
  }), []);

  useEffect(() => {
    if (imageUrl) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      try {
        const avatar = createPhotoAvatar(canvas, img, FACE_FRAME);
        avatarRef.current = avatar;
        avatar.setSpeaking(pending.current.speaking);
        if (pending.current.gesture) avatar.play(...pending.current.gesture);
        observer = new ResizeObserver(() => avatar.setSize(canvas.clientWidth, canvas.clientHeight));
        observer.observe(canvas);
      } catch (error) {
        console.error('Unable to start chatbot avatar:', error);
        setFailed(true);
      }
    };
    img.onerror = () => { console.error('Unable to load default chatbot portrait'); setFailed(true); };
    img.src = AVATAR_IMAGE;
    return () => {
      disposed = true;
      observer?.disconnect();
      avatarRef.current?.dispose();
      avatarRef.current = null;
    };
  }, [imageUrl]);

  return <div className="beulah-avatar" aria-hidden="true">
    {imageUrl ? <img className={customFailed ? undefined : 'beulah-custom-avatar'} src={customFailed ? AVATAR_IMAGE : imageUrl} alt="" onError={() => { console.error('Unable to load chatbot portrait'); if (!customFailed) setCustomFailed(true); }} /> : failed ? <img src={AVATAR_IMAGE} alt="" /> : <canvas ref={canvasRef} />}
  </div>;
});

export default BeulahAvatar;
