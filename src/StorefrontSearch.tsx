import { useState } from 'react';

export default function StorefrontSearch() {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase();
  const matches = term ? Array.from(document.querySelectorAll<HTMLElement>('.studio-content-form h2, .studio-content-form legend, .studio-content-form label'))
    .map((element) => ({ element, label: (element.textContent || '').trim().replace(/\s+/g, ' ') }))
    .filter(({ label }) => label.toLocaleLowerCase().includes(term))
    .slice(0, 100) : [];

  function navigate(element: HTMLElement) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const control = element.querySelector<HTMLElement>('input:not([type="file"]), textarea, select');
    control?.focus({ preventScroll: true });
  }

  return <section className="studio-panel studio-storefront-search" aria-label="Search storefront editor">
    <label htmlFor="storefront-editor-search">Search storefront settings and text</label>
    <input id="storefront-editor-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings, images or text fields" />
    {term && <div role="status" aria-live="polite">
      {matches.length ? <ul>{matches.map(({ element, label }, index) => <li key={`${label}-${index}`}><button type="button" onClick={() => navigate(element)}>{label}</button></li>)}</ul> : <p>No matching storefront settings</p>}
    </div>}
  </section>;
}
