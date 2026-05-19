// ============================================================
// supabase.js — Supabase client initialization
// 
// SETUP: Copy this file to js/supabase.js and fill in your
// credentials from: Supabase Dashboard → Project Settings → API
//
// js/supabase.js is in .gitignore and will never be committed.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;font-family:sans-serif;background:#0e0e0e;color:#f0ede6;">
      <div style="max-width:400px;text-align:center;">
        <p style="font-size:32px;margin-bottom:16px;">⚙️</p>
        <h2 style="margin-bottom:12px;font-size:20px;">Setup Required</h2>
        <p style="color:#888;font-size:14px;line-height:1.6;">
          Copy <code style="background:#1f1f1f;padding:2px 6px;border-radius:4px;">js/supabase.example.js</code>
          to <code style="background:#1f1f1f;padding:2px 6px;border-radius:4px;">js/supabase.js</code>
          and replace the placeholder values with your project credentials
          from the Supabase dashboard.
        </p>
      </div>
    </div>
  `;
  throw new Error('Supabase not configured');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
