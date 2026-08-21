# Never Behind

A strength training app for well-rounded athletes — two lifting days, four days free for cycling, running, or swimming. Built on the 5×5 principle with automatic progression, plateau detection, and deload cycles that treat a scaled-back session as normal, not a setback.

> Repo/folder name below is still `2x5strong` (unchanged — renaming the actual GitHub repo is a separate, more disruptive step not done as part of this rebrand). The product itself is now Never Behind.

## Features

- **2-day alternating program** — Workout A (Squat, Bench, Row) and Workout B (Squat, OHP, Deadlift)
- **Automatic progression** — +5 lb lower body, +2.5 lb upper body per successful session
- **Plateau detection** — 3 consecutive failures triggers a 10% deload
- **Full auth** — email/password sign up, per-user data, works from any device
- **Cloud sync** — all data stored in Supabase Postgres

---

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project** — name it `2x5strong` or similar
3. Choose a region close to you
4. Wait ~2 minutes for provisioning

### 2. Run the database schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Open `supabase_schema.sql` from this repo, paste the entire contents, and click **Run**
4. You should see "Success. No rows returned" — that's correct

### 3. Get your API credentials

1. In Supabase, go to **Project Settings → API**
2. Copy your **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
3. Copy your **anon public** key (the long `eyJ...` string)

### 4. Add credentials to the app

Open `js/supabase.js` and replace:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

with your actual values.

### 5. Configure Supabase Auth

In your Supabase dashboard:

1. Go to **Authentication → URL Configuration**
2. Set **Site URL** to your GitHub Pages URL:
   `https://YOUR_GITHUB_USERNAME.github.io/2x5strong`
3. Add the same URL to **Redirect URLs**
4. Also add `http://localhost:3000` to Redirect URLs (for local testing)

### 6. Deploy to GitHub Pages

1. Create a new GitHub repository named `2x5strong`
2. Push this entire folder to the repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/2x5strong.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your GitHub repo
4. Set **Source** to `main` branch, `/ (root)` folder
5. Click Save — your site will be live at:
   `https://YOUR_USERNAME.github.io/2x5strong`

---

## Local Development

Because the app uses ES modules, you need a local server (just opening `index.html` directly won't work):

```bash
# Python 3
python3 -m http.server 3000

# Node (if you have npx)
npx serve .
```

Then open `http://localhost:3000`

---

## Program Details

| | Workout A | Workout B |
|---|---|---|
| **Lift 1** | Squat | Squat |
| **Lift 2** | Bench Press | Overhead Press |
| **Lift 3** | Barbell Row | Deadlift |

**Sets/Reps:** 5 × 5 on all lifts

**Progression:**
- Lower body (Squat, Deadlift): +5 lb per successful session
- Upper body (Bench, OHP, Row): +2.5 lb per successful session

**Plateau / Deload:**
- 3 consecutive failures on any lift → weight drops to 90% (rounded to nearest 2.5 lb)
- Failure count resets after deload
- Deload counter shown in Settings so you can track history

---

## File Structure

```
2x5strong/
├── index.html          ← Login / signup screen
├── app.html            ← Main workout app (requires auth)
├── supabase_schema.sql ← Run once in Supabase SQL editor
├── css/
│   └── style.css       ← All shared styles
├── js/
│   ├── supabase.js     ← Client init — PUT YOUR KEYS HERE
│   ├── auth.js         ← Signup, login, logout, password reset
│   ├── db.js           ← All Supabase data operations
│   └── app.js          ← Workout logic, UI, history, settings
└── README.md
```

---

## Notes

- **Email confirmation**: By default Supabase requires email confirmation on signup. Users will get a confirmation email before they can log in. You can disable this in Supabase → Authentication → Settings if you want frictionless testing.
- **Starting weights**: All lifts default to 45 lb (the bar). Each user can edit their starting weights in Settings after signing up.
- **Supabase free tier**: Projects on the free tier pause after 1 week of inactivity. For production use, upgrade to Pro ($25/month) or keep the project active.
- We had a weird workflow/action hangup in July that looks like it's now resolved. If it gets hung and you can't cancel, you may have to submit a support ticket.
