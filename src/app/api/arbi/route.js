// src/app/api/arbi/route.js
// Serves live ARBI bot data to the dashboard from Supabase

import { createClient } from "@supabase/supabase-js";

const ARBI_SUPABASE_URL =
  process.env.SUPABASE_URL_ARBI ||
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const ARBI_SUPABASE_KEY =
  process.env.SUPABASE_KEY_ARBI ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = ARBI_SUPABASE_URL && ARBI_SUPABASE_KEY
  ? createClient(ARBI_SUPABASE_URL, ARBI_SUPABASE_KEY)
  : null;

export async function GET() {
  try {
    if (!supabase) {
      return Response.json(
        {
          status: "error",
          message: "ARBI Supabase is not configured. Set SUPABASE_URL_ARBI and SUPABASE_KEY_ARBI.",
          signals: [],
          stats: { total_signals: 0, win_rate: 0, collective: { total_trades: 0 } },
        },
        { status: 500 }
      );
    }

    // Fetch latest signals
    const { data: signals, error: sigErr } = await supabase
      .from("signals")
      .select("*")
      .neq("ticker", "COLLECTIVE")
      .order("created_at", { ascending: false })
      .limit(20);

    if (sigErr) throw sigErr;

    // Fetch collective stats
    const { data: collective } = await supabase
      .from("signals")
      .select("*")
      .eq("ticker", "COLLECTIVE")
      .order("created_at", { ascending: false })
      .limit(1);

    // Fetch portfolio
    const { data: portfolio } = await supabase
      .from("portfolio")
      .select("*")
      .order("updated_at", { ascending: false });

    // Compute stats from signals
    const total   = signals?.length || 0;
    const wins    = signals?.filter(s => s.confidence > 50).length || 0;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

    // Parse collective stats if available
    let collectiveStats = { total_trades: 0, win_rate: 0 };
    if (collective?.[0]?.signal) {
      const match = collective[0].signal.match(/trades=(\d+) winrate=([\d.]+)%/);
      if (match) {
        collectiveStats = {
          total_trades: parseInt(match[1]),
          win_rate:     parseFloat(match[2]),
        };
      }
    }

    // Format signals for dashboard
    const formattedSignals = (signals || [])
      .filter(s => s.ticker !== "COLLECTIVE")
      .map(s => ({
        id:         s.id,
        ticker:     s.ticker,
        signal:     s.signal,
        confidence: s.confidence,
        created_at: s.created_at,
      }));

    return Response.json({
      status:     "online",
      signals:    formattedSignals,
      portfolio:  portfolio || [],
      stats: {
        total_signals: total,
        win_rate:      winRate,
        collective:    collectiveStats,
      },
      updated_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error("ARBI API error:", err);
    return Response.json({
      status:  "error",
      message: err.message,
      signals: [],
      stats:   { total_signals: 0, win_rate: 0, collective: { total_trades: 0 } },
    }, { status: 500 });
  }
}
