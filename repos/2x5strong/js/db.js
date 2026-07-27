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
      ),
      accessory_logs (
        exercise_name,
        exercise_type,
        sets_json,
        sort_order
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

// ── Accessory Exercises ───────────────────────────────────────

export async function getCustomExercises(userId) {
  const { data, error } = await supabase
    .from('accessory_exercises')
    .select('*')
    .eq('user_id', userId)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function addCustomExercise(userId, { name, category, exercise_type }) {
  const { data, error } = await supabase
    .from('accessory_exercises')
    .insert({ user_id: userId, name, category, exercise_type })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCustomExercise(userId, id) {
  const { error } = await supabase
    .from('accessory_exercises')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Accessory Logs ────────────────────────────────────────────

export async function saveAccessoryLogs(sessionId, userId, accessories) {
  if (!accessories || accessories.length === 0) return;
  const rows = accessories.map((a, i) => ({
    session_id: sessionId,
    user_id: userId,
    exercise_name: a.name,
    exercise_type: a.type,
    category: a.category,
    sets_json: a.sets,
    sort_order: i,
  }));
  const { error } = await supabase.from('accessory_logs').insert(rows);
  if (error) throw error;
}

export async function getLastAccessoryLogs(userId) {
  // Get the most recent session with accessories, then fetch its logs
  const { data: recentSessions, error: sErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(5);
  if (sErr) throw sErr;
  if (!recentSessions || recentSessions.length === 0) return [];

  // Find the most recent session that has accessory logs
  for (const session of recentSessions) {
    const { data, error } = await supabase
      .from('accessory_logs')
      .select('*')
      .eq('session_id', session.id)
      .eq('user_id', userId)
      .order('sort_order');
    if (error) throw error;
    if (data && data.length > 0) return data;
  }
  return [];
}

// ── Movement Sessions ─────────────────────────────────────────

export async function saveMovementSession(userId, { title, tagline, promptUsed, exercises }) {
  // Insert session row
  const { data: session, error: sErr } = await supabase
    .from('movement_sessions')
    .insert({
      user_id: userId,
      title,
      tagline,
      prompt_used: promptUsed,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (sErr) throw sErr;

  // Insert exercises
  const rows = exercises.map((ex, i) => ({
    session_id: session.id,
    user_id: userId,
    name: ex.name,
    category: ex.category,
    weight: ex.weight || 0,
    prescription: ex.prescription,
    sets_json: ex.sets,
    sort_order: i,
  }));

  const { error: eErr } = await supabase
    .from('movement_session_exercises')
    .insert(rows);
  if (eErr) throw eErr;

  return session;
}

export async function getMovementSessions(userId, limit = 50) {
  const { data, error } = await supabase
    .from('movement_sessions')
    .select(`
      id, title, tagline, prompt_used, completed_at,
      movement_session_exercises (
        name, category, weight, prescription, sets_json, sort_order
      )
    `)
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
