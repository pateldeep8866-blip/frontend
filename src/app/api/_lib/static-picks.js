/**
 * Static snapshot of evaluated picks — deduplicated to 1 per ticker per day.
 * Used as production fallback when the local trades DB is unavailable.
 * Last updated: 2026-03-10
 */

export const STATIC_PICKS = [
  // 2026-02-27
  { ticker: "GDXJ", entryPrice: 154.04,  date: "2026-02-27", confidence: 64, outcome: "loss", returnPct: -10.9128 },
  // 2026-02-26
  { ticker: "XOM",  entryPrice: 150.13,  date: "2026-02-26", confidence: 95, outcome: "win",  returnPct:  0.2065  },
  { ticker: "SLV",  entryPrice:  78.748, date: "2026-02-26", confidence: 25, outcome: "loss", returnPct: -0.6197  },
  { ticker: "GDXJ", entryPrice: 149.68,  date: "2026-02-26", confidence: 45, outcome: "loss", returnPct: -8.3177  },
  { ticker: "XLK",  entryPrice: 140.13,  date: "2026-02-26", confidence: 65, outcome: "win",  returnPct:  0.264   },
  { ticker: "BTC",  entryPrice: 67850.0, date: "2026-02-26", confidence: 62, outcome: "win",  returnPct:  1.717   },
  { ticker: "DIA",  entryPrice: 494.82,  date: "2026-02-26", confidence:  5, outcome: "loss", returnPct: -3.4235  },
  { ticker: "GLD",  entryPrice: 473.42,  date: "2026-02-26", confidence: 60, outcome: "loss", returnPct: -0.188   },
  { ticker: "XLP",  entryPrice:  89.01,  date: "2026-02-26", confidence: 56, outcome: "loss", returnPct: -3.4153  },
  // 2026-02-25
  { ticker: "XLK",  entryPrice: 143.0,   date: "2026-02-25", confidence: 45, outcome: "loss", returnPct: -2.2657  },
  { ticker: "SLV",  entryPrice:  80.07,  date: "2026-02-25", confidence: 28, outcome: "loss", returnPct: -2.2605  },
  { ticker: "XOM",  entryPrice: 149.06,  date: "2026-02-25", confidence: 95, outcome: "win",  returnPct:  0.9258  },
  { ticker: "SPY",  entryPrice: 692.3,   date: "2026-02-25", confidence: 95, outcome: "win",  returnPct:  2.0266  },
  { ticker: "ORCL", entryPrice: 149.38,  date: "2026-02-25", confidence: 80, outcome: "loss", returnPct: -1.4594  },
];

function computeStats(picks) {
  const wins = picks.filter((p) => p.outcome === "win").length;
  const returns = picks.map((p) => p.returnPct).filter((v) => v != null && !isNaN(v));
  const avgReturn = returns.length > 0
    ? parseFloat((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2))
    : null;
  const cumReturn = returns.length > 0
    ? parseFloat(returns.reduce((a, b) => a + b, 0).toFixed(2))
    : null;
  const winRate = picks.length > 0 ? parseFloat(((wins / picks.length) * 100).toFixed(1)) : null;
  return { wins, winRate, avgReturn, cumReturn };
}

const allStats = computeStats(STATIC_PICKS);

export const STATIC_BRIEFING = {
  ok: true,
  days: Math.floor((Date.now() - new Date("2026-02-08").getTime()) / 86400000),
  totalPicks: STATIC_PICKS.length,
  winRatePct: allStats.winRate,
  avgReturnPct: allStats.avgReturn,
  cumulativeReturnPct: allStats.cumReturn,
  waitlistCount: null,
  picks: STATIC_PICKS,
  monthlyWinRates: [{ month: "02", rate: allStats.winRate ?? 0 }],
  winRate: allStats.winRate,
  count: STATIC_PICKS.length,
  avgReturn: allStats.avgReturn,
};
