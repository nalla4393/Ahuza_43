export default function ShoppingCharacterFallback() {
  return <div className="shopping-character" aria-hidden="true">
    <span className="shopping-character-arm left" />
    <span className="shopping-character-arm right" />
    <span className="shopping-character-body" />
    <span className="shopping-character-leg left" />
    <span className="shopping-character-leg right" />
    <img className="shopping-assistant-face" src="/beulah-avatar.jpg" alt="" />
  </div>;
}
