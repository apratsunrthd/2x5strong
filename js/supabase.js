// ============================================================
// supabase.js — Supabase client initialization
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your values
// from: Supabase Dashboard → Project Settings → API
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://aqbrhcdaarpcymhgshuh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxYnJoY2RhYXJwY3ltaGdzaHVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzU0ODAsImV4cCI6MjA5NDUxMTQ4MH0.gkqDRUIEsfpxPetsxiC40ccplQhGLCF-jYSSA9HX9qk';


if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;font-family:sans-serif;background:#0e0e0e;color:#f0ede6;">
      <div style="max-width:400px;text-align:center;">
        <p style="font-size:32px;margin-bottom:16px;">⚙️</p>
        <h2 style="margin-bottom:12px;font-size:20px;">Setup Required</h2>
        <p style="color:#888;font-size:14px;line-height:1.6;">
          Open <code style="background:#1f1f1f;padding:2px 6px;border-radius:4px;">js/supabase.js</code>
          and replace <code style="background:#1f1f1f;padding:2px 6px;border-radius:4px;">YOUR_SUPABASE_URL</code>
          and <code style="background:#1f1f1f;padding:2px 6px;border-radius:4px;">YOUR_SUPABASE_ANON_KEY</code>
          with your project credentials from the Supabase dashboard.
        </p>
      </div>
    </div>
  `;
  throw new Error('Supabase not configured');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
