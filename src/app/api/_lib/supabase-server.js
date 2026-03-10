/**
 * Server-side Supabase client using the service role key.
 * NEVER import this in client components — service role key bypasses RLS.
 * Use only in API routes and server-side logic.
 */

import { createClient } from "@supabase/supabase-js";

let instance = null;

export function getSupabaseServer() {
  if (instance) return instance;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  instance = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  return instance;
}
