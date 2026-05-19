// ============================================================
// auth.js — Authentication logic
// ============================================================

import { supabase } from './supabase.js';

const LIFT_IDS = ['squat', 'bench', 'row', 'press', 'deadlift'];

// ── Get current session user ──────────────────────────────────
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ── Sign up ───────────────────────────────────────────────────
export async function signUp({ email, password, displayName, color }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, color }
    }
  });
  if (error) throw error;

  // Seed default lift states for new user
  if (data.user) {
    await seedLiftStates(data.user.id);
  }

  return data;
}

// ── Sign in ───────────────────────────────────────────────────
export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ── Sign out ──────────────────────────────────────────────────
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.href = 'index.html';
}

// ── Seed default lift states on first signup ──────────────────
async function seedLiftStates(userId) {
  const rows = LIFT_IDS.map(liftId => ({
    user_id: userId,
    lift_id: liftId,
    weight: liftId === 'deadlift' ? 65 : 45,
    bar_weight: 45,
    failures: 0,
    deloads: 0
  }));

  // upsert so re-running signup never breaks
  const { error } = await supabase
    .from('lift_states')
    .upsert(rows, { onConflict: 'user_id,lift_id' });

  if (error) console.warn('Seed lift states error:', error.message);
}

// ── Ensure lift states exist (run on login in case seed missed) ─
export async function ensureLiftStates(userId) {
  const { data: existing } = await supabase
    .from('lift_states')
    .select('lift_id')
    .eq('user_id', userId);

  const existingIds = (existing || []).map(r => r.lift_id);
  const missing = LIFT_IDS.filter(id => !existingIds.includes(id));

  if (missing.length > 0) {
    const rows = missing.map(liftId => ({
      user_id: userId,
      lift_id: liftId,
      weight: liftId === 'deadlift' ? 65 : 45,
      failures: 0,
      deloads: 0
    }));
    await supabase.from('lift_states').insert(rows);
  }
}

// ── Auth state change listener ────────────────────────────────
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

// ── Password reset ────────────────────────────────────────────
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/app.html`
  });
  if (error) throw error;
}
