# ARTHASTRA DEPLOYMENT GUIDE
# Mac + GitHub + Railway + Vercel
# Estimated time: 20 minutes

═══════════════════════════════════════════════════
STEP 1 — Set up Supabase (5 min)
═══════════════════════════════════════════════════

1. Go to supabase.com
2. Sign up (free) → New Project
3. Name it "arthastra" → pick any password → create
4. Wait ~2 minutes for it to spin up
5. Go to Settings → API
6. Copy two things:
   - Project URL  (looks like: https://abcxyz.supabase.co)
   - anon/public key  (long string starting with "eyJ...")
7. Keep these open — you'll need them in Step 3

In Supabase SQL Editor, run this to create the tables:

  CREATE TABLE sim_trades (
    id          BIGSERIAL PRIMARY KEY,
    ts          FLOAT NOT NULL,
    sim_user    TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    strategy    TEXT NOT NULL,
    side        TEXT NOT NULL,
    entry_price FLOAT NOT NULL,
    exit_price  FLOAT,
    pnl_pct     FLOAT,
    profitable  INT,
    hold_hrs    FLOAT,
    features    JSONB,
    status      TEXT DEFAULT 'OPEN'
  );

  CREATE TABLE sim_signals (
    id        BIGSERIAL PRIMARY KEY,
    ts        FLOAT NOT NULL,
    sim_user  TEXT NOT NULL,
    symbol    TEXT NOT NULL,
    strategy  TEXT NOT NULL,
    signal    TEXT NOT NULL,
    score     FLOAT,
    features  JSONB
  );

═══════════════════════════════════════════════════
STEP 2 — Push quant_bot to GitHub (5 min)
═══════════════════════════════════════════════════

Open Terminal on your Mac:

  # Navigate to the quant_bot folder (adjust path if needed)
  cd ~/Downloads/quant_bot

  # Initialize git
  git init
  git add .
  git commit -m "Initial Arthastra bot"

  # Create a new repo on github.com called "arthastra-bot" (make it PRIVATE)
  # Then connect and push:
  git remote add origin https://github.com/YOUR_USERNAME/arthastra-bot.git
  git branch -M main
  git push -u origin main

═══════════════════════════════════════════════════
STEP 3 — Deploy to Railway (5 min)
═══════════════════════════════════════════════════

1. Go to railway.app → your account
2. New Project → Deploy from GitHub repo
3. Select "arthastra-bot"
4. Railway will detect the Procfile automatically

Set environment variables (Variables tab in Railway):
  SUPABASE_URL      = (paste from Step 1)
  SUPABASE_ANON_KEY = (paste from Step 1)
  SIM_USER          = arthastra_global
  USE_LIVE_DATA     = true

5. Click Deploy
6. Watch the logs — you should see:
   "SimulationEngine started: user=arthastra_global"

That's it. The bot is now running 24/7 on Railway.
It will restart automatically if it crashes.

═══════════════════════════════════════════════════
STEP 4 — Put the website live on Vercel (5 min)
═══════════════════════════════════════════════════

The website is a single HTML file → easiest deploy possible.

Option A: Drag and drop (fastest)
  1. Go to vercel.com → sign in with GitHub
  2. New Project → drag the arthastra_website.html file
  3. Vercel gives you a URL instantly

Option B: Via GitHub (recommended — auto-updates)
  1. Create a new GitHub repo called "arthastra-website" (can be public)
  2. Put arthastra_website.html in it, rename to index.html
  3. Go to vercel.com → Import from GitHub → select it
  4. Deploy → done

Connect your domain:
  1. In Vercel → your project → Settings → Domains
  2. Add "arthastraai.com"
  3. Vercel shows you DNS records to add
  4. Go to wherever you bought your domain → DNS settings
  5. Add the records Vercel shows you
  6. Wait 5-30 min for DNS to propagate

═══════════════════════════════════════════════════
AFTER DEPLOYMENT — What you have
═══════════════════════════════════════════════════

  arthastraai.com     → live website (Vercel, free)
  Bot simulation      → running 24/7 (Railway, ~$5/mo)
  All data            → saved permanently (Supabase, free)

To check the bot is running:
  Railway dashboard → your project → Logs
  Should see new entries every 15 seconds

To see simulation data accumulating:
  Supabase → Table Editor → sim_trades
  Rows appear in real time as the bot trades

═══════════════════════════════════════════════════
TROUBLESHOOTING
═══════════════════════════════════════════════════

Bot crashes on Railway:
  → Check Logs tab for the error
  → Most common: missing env variable
  → Fix: add it in Variables tab → redeploy

Website not showing on domain:
  → DNS takes up to 48h (usually 30 min)
  → Check Vercel → Domains → shows status

"Module not found" error:
  → Make sure requirements.txt is in the root folder
  → Run: git add . && git commit -m "fix" && git push

═══════════════════════════════════════════════════
COSTS SUMMARY
═══════════════════════════════════════════════════

  Vercel:    FREE (hobby tier, more than enough)
  Supabase:  FREE (500MB, handles years of data)
  Railway:   ~$5/month (based on usage, first $5 is free credit)
  Domain:    Already owned

Total monthly cost to run Arthastra: ~$5
