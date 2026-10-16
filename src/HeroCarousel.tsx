import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

export type BannerSlide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  desktopImage?: string;
  mobileImage?: string;
  video?: string;
  endsAt?: string;
  onSelect: () => void;
};

const AUTOPLAY_MS = 5000;

function useCountdown(endsAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return null;
  const remaining = new Date(endsAt).getTime() - now;
  if (Number.isNaN(remaining) || remaining <= 0) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 86400))}d ${pad(Math.floor((totalSeconds % 86400) / 3600))}h ${pad(Math.floor((totalSeconds % 3600) / 60))}m ${pad(totalSeconds % 60)}s`;
}

function Countdown({ endsAt }: { endsAt?: string }) {
  const label = useCountdown(endsAt);
  if (!label) return null;
  return <p className="banner-countdown" aria-label={`Offer ends in ${label}`}>Ends in <strong>{label}</strong></p>;
}

export default function HeroCarousel({ slides }: { slides: BannerSlide[] }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const count = slides.length;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);
  const playing = count > 1 && !hovered && !focused && !userPaused && !reducedMotion;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => go(index + 1), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, go]);

  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  }

  if (!count) return null;

  return (
    <section
      className="banner-carousel"
      id="home"
      aria-roledescription="carousel"
      aria-label="Featured campaigns"
      data-playing={playing}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') go(index - 1);
        if (event.key === 'ArrowRight') go(index + 1);
      }}
    >
      {slides.map((slide, slideIndex) => {
        const active = slideIndex === index;
        return (
          <article
            key={slide.id}
            className={`banner-slide${active ? ' is-active' : ''}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slideIndex + 1} of ${count}`}
            aria-hidden={!active}
          >
            {slide.video && !reducedMotion
              ? <video className="banner-media" src={slide.video} poster={slide.desktopImage} autoPlay muted loop playsInline preload={slideIndex === 0 ? 'auto' : 'none'} />
              : <picture>
                {slide.mobileImage && <source media="(max-width: 760px)" srcSet={slide.mobileImage} />}
                <img className="banner-media" src={slide.desktopImage || slide.mobileImage} alt="" loading={slideIndex === 0 ? 'eager' : 'lazy'} fetchPriority={slideIndex === 0 ? 'high' : 'auto'} />
              </picture>}
            <div className="banner-shade" />
            <div className="banner-copy">
              <p className="banner-eyebrow">{slide.eyebrow}</p>
              <h1 className="banner-title">{slide.title}</h1>
              <p className="banner-description">{slide.description}</p>
              <Countdown endsAt={slide.endsAt} />
              <span className="banner-cta">{slide.cta} <ArrowRight size={16} /></span>
            </div>
            <button type="button" className="banner-hit" tabIndex={active ? 0 : -1} aria-label={`${slide.title}. ${slide.cta}`} onClick={slide.onSelect} />
          </article>
        );
      })}
      {count > 1 && <>
        <button type="button" className="banner-arrow banner-prev" aria-label="Previous slide" onClick={() => go(index - 1)}><ChevronLeft size={22} /></button>
        <button type="button" className="banner-arrow banner-next" aria-label="Next slide" onClick={() => go(index + 1)}><ChevronRight size={22} /></button>
        <div className="banner-controls">
          <button type="button" className="banner-pause" aria-label={userPaused ? 'Play slideshow' : 'Pause slideshow'} onClick={() => setUserPaused((value) => !value)}>{userPaused ? <Play size={13} /> : <Pause size={13} />}</button>
          <div className="banner-dots" role="tablist" aria-label="Choose slide">
            {slides.map((slide, dotIndex) => (
              <button key={slide.id} type="button" role="tab" aria-selected={dotIndex === index} aria-label={`Go to slide ${dotIndex + 1}`} className={dotIndex === index ? 'is-active' : ''} onClick={() => go(dotIndex)} />
            ))}
          </div>
        </div>
        <p className="sr-only" aria-live={playing ? 'off' : 'polite'}>Slide {index + 1} of {count}</p>
      </>}
    </section>
  );
}
