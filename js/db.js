// ============================================================
// db.js — All database read/write operations
// ============================================================

import { supabase } from './supabase.js';

// ── Profile ───────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);
  if (error) throw error;
}

// ── Lift States ───────────────────────────────────────────────

export async function getLiftStates(userId) {
  const { data, error } = await supabase
    .from('lift_states')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  // Return as { squat: {...}, bench: {...}, ... }
  return Object.fromEntries(data.map(r => [r.lift_id, r]));
}

export async function upsertLiftState(userId, liftId, updates) {
  const { error } = await supabase
    .from('lift_states')
    .upsert({
      user_id: userId,
      lift_id: liftId,
      ...updates,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,lift_id' });
  if (error) throw error;
}

// ── Sessions ──────────────────────────────────────────────────

export async function getSessions(userId, limit = 50) {
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      workout_day,
      completed_at,
      session_lifts (
        lift_id,
        lift_name,
        weight,
        sets_json,
        sets_passed
      )
    `)
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function saveSession(userId, workoutDay, liftResults) {
  // Insert session
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      workout_day: workoutDay,
      completed_at: new Date().toISOString()
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  // Insert lift results
  // sets_json stores work set rep counts; warmups_json stores warmup { weight, reps, done }
  const liftRows = liftResults.map(l => ({
    session_id: session.id,
    user_id: userId,
    lift_id: l.liftId,
    lift_name: l.name,
    weight: l.weight,
    sets_json: l.sets,
    sets_passed: l.sets.filter(s => s === 5).length,
    warmups_json: (l.warmups || [])
  }));

  const { error: liftError } = await supabase
    .from('session_lifts')
    .insert(liftRows);

  if (liftError) throw liftError;

  return session;
}

// ── Stats helpers ─────────────────────────────────────────────

export async function getPersonalRecords(userId) {
  const { data, error } = await supabase
    .from('session_lifts')
    .select('lift_id, weight, sets_passed')
    .eq('user_id', userId)
    .eq('sets_passed', 5); // Only count fully passed lifts as PRs
  if (error) throw error;

  const records = {};
  data.forEach(row => {
    if (!records[row.lift_id] || row.weight > records[row.lift_id]) {
      records[row.lift_id] = row.weight;
    }
  });
  return records;
}
