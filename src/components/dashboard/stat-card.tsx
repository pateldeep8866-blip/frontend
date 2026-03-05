import type { Stat } from "@/lib/dashboard-data";

type StatCardProps = {
  stat: Stat;
};

export function StatCard({ stat }: StatCardProps) {
  return (
    <article className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur">
      <p className="text-sm font-medium text-slate-500">{stat.label}</p>
      <div className="mt-4 flex items-end justify-between">
        <p className="text-2xl font-semibold tracking-tight text-slate-900">{stat.value}</p>
        <p className="text-xs font-semibold text-emerald-600">{stat.delta}</p>
      </div>
    </article>
  );
}
