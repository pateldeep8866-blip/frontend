import type { ReactNode } from "react";

type DashboardShellProps = {
  children: ReactNode;
};

const navItems = ["Overview", "Agents", "Tasks", "Analytics", "Settings"];

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-6 px-5 py-6 md:grid-cols-[220px_1fr] md:px-8">
      <aside className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Nova Core</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">AI Dashboard</p>
        </div>

        <nav className="mt-8 space-y-1">
          {navItems.map((item, index) => (
            <a
              key={item}
              href="#"
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                index === 0
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item}
            </a>
          ))}
        </nav>
      </aside>

      <div className="space-y-6">{children}</div>
    </div>
  );
}
