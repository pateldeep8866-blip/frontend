import type { Activity } from "@/lib/dashboard-data";

type ActivityFeedProps = {
  items: Activity[];
};

export function ActivityFeed({ items }: ActivityFeedProps) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Live Activity</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          real-time
        </span>
      </header>

      <ul className="mt-5 space-y-4">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
              </div>
              <span className="text-xs font-medium text-slate-400">{item.time}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
