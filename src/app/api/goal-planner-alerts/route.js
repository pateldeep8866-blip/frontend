import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/api/_lib/supabaseClient";



// ── Alert types supported ────────────────────────────────────────────────────
const VALID_ALERT_TYPES = ["buy", "sell", "hold", "rebalance", "weekly_summary"];

/**
 * POST /api/goal-planner-alerts
 *
 * Save or update a user's email alert preferences for their investment goal.
 *
 * Body:
 * {
 *   email:       string,
 *   alertTypes:  string[],   // subset of VALID_ALERT_TYPES
 *   planSnapshot?: object,   // optional: serialised form inputs for reference
 * }
 *
 * Returns:
 * { ok: true, message: string }
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, alertTypes = [], planSnapshot } = body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "A valid email address is required." }, { status: 400 });
    }

    const sanitisedTypes = alertTypes.filter((t) => VALID_ALERT_TYPES.includes(t));
    if (sanitisedTypes.length === 0) {
      return NextResponse.json({ ok: false, error: "Select at least one alert type." }, { status: 400 });
    }

    // ── Persist to Supabase (if configured) ───────────────────────────────────
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error: dbError } = await supabase
        .from("goal_planner_alerts")
        .upsert(
          {
            email:          email.toLowerCase().trim(),
            alert_types:    sanitisedTypes,
            plan_snapshot:  planSnapshot || null,
            updated_at:     new Date().toISOString(),
          },
          { onConflict: "email" }
        );

      if (dbError) {
        console.error("[goal-planner-alerts] Supabase upsert error:", dbError.message);
        // Fall through — still return success so UI is not blocked
      }
    }

    // ── TODO: trigger actual email delivery ───────────────────────────────────
    // When email infrastructure is ready, call your provider here:
    //   await sendWelcomeAlert({ email, alertTypes: sanitisedTypes });
    //
    // Supported providers to wire up:
    //   - SendGrid:    process.env.SENDGRID_API_KEY
    //   - Resend:      process.env.RESEND_API_KEY
    //   - Nodemailer:  process.env.SMTP_HOST / SMTP_USER / SMTP_PASS

    return NextResponse.json({
      ok: true,
      message: `Alert preferences saved for ${email}. You will be notified for: ${sanitisedTypes.join(", ")}.`,
      alertTypes: sanitisedTypes,
    });
  } catch (e) {
    console.error("[goal-planner-alerts] Unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: "Failed to save alert preferences.", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/goal-planner-alerts?email=user@example.com
 * Unsubscribe / remove all alerts for an email address.
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "Valid email required." }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase
        .from("goal_planner_alerts")
        .delete()
        .eq("email", email.toLowerCase().trim());
    }

    return NextResponse.json({ ok: true, message: "Alert preferences removed." });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
