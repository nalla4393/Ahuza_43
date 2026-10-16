import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  id?: string;
  eyebrow: string;
  title: string;
  linkLabel: string;
  onLink: () => void;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
};

export default function ProductRail({ id, eyebrow, title, linkLabel, onLink, children, style, className }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => setEdges({
      start: element.scrollLeft <= 4,
      end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 4,
    });
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', update); observer.disconnect(); };
  }, [children]);

  const scrollBy = (direction: 1 | -1) => {
    const element = track.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className={`product-rail section-wrap${className ? ` ${className}` : ''}`} id={id} aria-label={title}>
      <div className="section-heading">
        <div><p className="eyebrow dark-eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        <div className="rail-actions">
          <button className="text-link" type="button" onClick={onLink}>{linkLabel} <ArrowUpRight size={15} /></button>
        </div>
      </div>
      <div className="rail-frame">
        <button type="button" className="rail-arrow rail-side rail-side-left" aria-label={`Scroll ${title} left`} disabled={edges.start} onClick={() => scrollBy(-1)}><ChevronLeft size={22} /></button>
        <div className="rail-track" ref={track} style={style} tabIndex={0} role="group" aria-roledescription="carousel">{children}</div>
        <button type="button" className="rail-arrow rail-side rail-side-right" aria-label={`Scroll ${title} right`} disabled={edges.end} onClick={() => scrollBy(1)}><ChevronRight size={22} /></button>
      </div>
    </section>
  );
}
