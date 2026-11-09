import { useEffect, useRef, useState, type CSSProperties } from 'react';
import ShoppingCharacterFallback from './ShoppingCharacterFallback';
import './shopping-assistant.css';

export type AssistantTrip = {
  id: number;
  mode: 'preview' | 'pack';
  productName: string;
  imageUrl: string;
  productX: number;
  productY: number;
  bagX: number;
  bagY: number;
};

function Character() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    void import('./avatar/shoppingCharacter').then(({ createShoppingCharacter }) => {
      if (!disposed && canvas.current) {
        dispose = createShoppingCharacter(canvas.current);
        setReady(true);
      }
    }).catch((error: unknown) => {
      console.error('Unable to start the 3D shopping assistant:', error);
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  return <>
    {!ready && <ShoppingCharacterFallback />}
    {!failed && <canvas ref={canvas} className="shopping-character-3d" aria-hidden="true" style={{ display: ready ? 'block' : 'none' }} />}
  </>;
}

export default function ShoppingAssistant({ trip, onOpenBag }: { trip: AssistantTrip | null; onOpenBag: () => void }) {
  const [packedId, setPackedId] = useState<number | null>(null);
  const [animatingId, setAnimatingId] = useState<number | null>(null);

  useEffect(() => {
    setPackedId(null);
    setAnimatingId(null);
    if (!trip) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setAnimatingId(trip.id);
    const timer = window.setTimeout(() => {
      setAnimatingId(null);
      if (trip.mode === 'pack') setPackedId(trip.id);
    }, reduced ? 2400 : trip.mode === 'pack' ? 2400 : 1400);
    return () => window.clearTimeout(timer);
  }, [trip]);

  if (!trip) return null;
  const style = {
    '--product-x': `${trip.productX}px`,
    '--product-y': `${trip.productY}px`,
    '--bag-x': `${trip.bagX}px`,
    '--bag-y': `${trip.bagY}px`,
  } as CSSProperties;

  return <>
    {animatingId === trip.id && <div key={trip.id} className={`shopping-assistant-trip ${trip.mode}`} style={style} aria-hidden="true">
      <div className="shopping-assistant-mover">
        <Character />
        {trip.mode === 'pack' && <img className="shopping-assistant-item" src={trip.imageUrl} alt="" />}
      </div>
      {trip.mode === 'pack' && <div className="shopping-assistant-receiver"><Character /></div>}
    </div>
    }
    {packedId === trip.id && <div className="shopping-assistant-prompt" role="status">
      <span>{trip.productName} added to your bag</span>
      <button type="button" onClick={onOpenBag}>View bag and checkout</button>
      <button type="button" aria-label="Dismiss bag prompt" onClick={() => setPackedId(null)}>×</button>
    </div>}
  </>;
}
