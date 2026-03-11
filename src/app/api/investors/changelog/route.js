import { NextResponse } from "next/server";
import { getSystemLog } from "@/app/api/_lib/trade-db";

export async function GET() {

  const log = getSystemLog(500);

  const accepted = log.filter(r => r.event_type === "PICK_ACCEPTED").length;
  const rejected = log.filter(r => r.event_type === "PICK_REJECTED").length;

  const byReason = {};
  for (const r of log.filter(r => r.event_type === "PICK_REJECTED")) {
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    asOf: new Date().toISOString(),
    summary: { accepted, rejected, total: log.length, byReason },
    fixes: [
      {
        date: "2026-03-09",
        title: "Confidence Floor Added",
        problem: "29 picks below 60% confidence had a 0% win rate and -4.59% average return. ASTRA was executing low-conviction signals with no edge.",
        fix: "All BUY/SELL picks below 70% confidence are now blocked before reaching the trade log.",
        impact: "Eliminates the worst-performing tier. High confidence (80+) picks historically show 97% win rate.",
        stat_before: "0% win rate on 29 low-confidence picks",
        stat_after: "Only 70%+ confidence picks accepted",
      },
      {
        date: "2026-03-09",
        title: "Duplicate Pick Guard Added",
        problem: "ASTRA's signal loop was emitting the same pick on every cycle. XOM BUY appeared 17 times in one day, GDXJ BUY 11 times — inflating pick count and distorting the track record.",
        fix: "One BUY or SELL per ticker per day. Any duplicate is blocked and logged.",
        impact: "Pick count now reflects unique decisions, not loop noise.",
        stat_before: "Up to 17 identical picks per ticker per day",
        stat_after: "Maximum 1 pick per ticker per day",
      },
      {
        date: "2026-03-09",
        title: "Direction Conflict Lock Added",
        problem: "ASTRA generated both BUY and SELL signals on XLK on the same day. The SELL was correct (100% win rate). The BUY was wrong (0% win rate). Conflicting signals cancelled each other out.",
        fix: "If a BUY exists for a ticker today, a SELL is blocked, and vice versa. First signal wins.",
        impact: "Eliminates contradictory positions on the same ticker.",
        stat_before: "BUY and SELL on same ticker same day possible",
        stat_after: "Direction locked per ticker per day",
      },
    ],
    recentLog: log.slice(0, 50),
  });
}
