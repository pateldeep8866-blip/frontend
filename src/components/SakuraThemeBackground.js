"use client";

const SAKURA_PETAL_IDS = Array.from({ length: 14 }, (_, index) => index + 1);

export default function SakuraThemeBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden sakura-scene sakura-scene-pro" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sakura-ink-branch-vertical.svg" alt="" className="sakura-ink-feature sakura-ink-feature-left" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sakura-ink-branch-vertical.svg" alt="" className="sakura-ink-feature sakura-ink-feature-right" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sakura-tree.svg" alt="" className="sakura-tree sakura-tree-left" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sakura-tree.svg" alt="" className="sakura-tree sakura-tree-canopy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sakura-tree.svg" alt="" className="sakura-tree sakura-tree-right" />
      {SAKURA_PETAL_IDS.map((petalId) => (
        <span key={petalId} className={`sakura-petal sakura-petal-${petalId}`} />
      ))}
    </div>
  );
}
