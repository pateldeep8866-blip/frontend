const FLAME_IDS = Array.from({ length: 8 }, (_, index) => index + 1);
const LIGHTNING_IDS = Array.from({ length: 18 }, (_, index) => index + 1);

export default function AzulaThemeBackground({
  active,
  className = "pointer-events-none absolute inset-0 z-[1] overflow-hidden azula-scene",
  keyPrefix = "azula",
}) {
  if (!active) return null;

  return (
    <div className={className} aria-hidden="true">
      {FLAME_IDS.map((flameId) => (
        <span key={`${keyPrefix}-flame-${flameId}`} className={`azula-flame azula-flame-${flameId}`} />
      ))}
      {LIGHTNING_IDS.map((boltId) => (
        <span key={`${keyPrefix}-bolt-${boltId}`} className={`azula-lightning azula-lightning-${boltId}`} />
      ))}
    </div>
  );
}
