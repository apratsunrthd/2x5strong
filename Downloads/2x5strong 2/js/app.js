// ============================================================
// app.js — Main workout app logic
// ============================================================

import { supabase } from './supabase.js';
import { getSession, signOut, ensureLiftStates } from './auth.js';
import { getProfile, getLiftStates, upsertLiftState, saveSession, getPersonalRecords } from './db.js';

// ── Program Definition ────────────────────────────────────────

const WORKOUT_A = [
  { id: 'squat',  name: 'Squat',        increment: 5,   reps: 5 },
  { id: 'bench',  name: 'Bench Press',  increment: 2.5, reps: 5 },
  { id: 'row',    name: 'Barbell Row',  increment: 2.5, reps: 5 },
];
const WORKOUT_B = [
  { id: 'squat',    name: 'Squat',           increment: 5,   reps: 5 },
  { id: 'press',    name: 'Overhead Press',  increment: 2.5, reps: 5 },
  { id: 'deadlift', name: 'Deadlift',        increment: 5,   reps: 5 },
];

// ── App State ─────────────────────────────────────────────────

let user = null;
let profile = null;
let liftStates = null;
let personalRecords = null;
let currentSession = null;

// ── Toast helper ──────────────────────────────────────────────

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ` ${type}` : '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Init ──────────────────────────────────────────────────────

async function init() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  user = session.user;

  try {
    await ensureLiftStates(user.id);
    [profile, liftStates, personalRecords] = await Promise.all([
      getProfile(user.id),
      getLiftStates(user.id),
      getPersonalRecords(user.id)
    ]);
  } catch (e) {
    toast('Failed to load your data. Please refresh.', 'error');
    console.error(e);
    return;
  }

  renderNav();
  initSession();
  showTab('workout');
  document.getElementById('app-loading').style.display = 'none';
  document.getElementById('app-content').style.display = 'block';
}

// ── Nav ───────────────────────────────────────────────────────

function renderNav() {
  const initials = profile.display_name.slice(0, 2).toUpperCase();
  const av = document.getElementById('nav-avatar');
  av.textContent = initials;
  av.style.background = profile.color;
  av.style.color = isLight(profile.color) ? '#000' : '#fff';
  document.getElementById('nav-name').textContent = profile.display_name;
}

function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 128;
}

// ── Session init ──────────────────────────────────────────────

function initSession() {
  const day = profile.next_workout || 'A';
  const lifts = day === 'A' ? WORKOUT_A : WORKOUT_B;

  currentSession = {
    day,
    liftResults: lifts.map(lift => ({
      liftId: lift.id,
      name: lift.name,
      increment: lift.increment,
      weight: liftStates[lift.id]?.weight ?? 45,
      // null = unrecorded, 0–5 = reps completed
      sets: [null, null, null, null, null],
      // locked = true when 3 consecutive failed sets end this lift early
      locked: false,
    }))
  };

  renderWorkout();
}

// ── Rep counting helpers ──────────────────────────────────────

// A set is "failed" if it was recorded and got fewer than 5 reps
function setFailed(val) { return val !== null && val < 5; }
function setDone(val)   { return val === 5; }

// Count consecutive failed sets from the end of recorded sets
function consecutiveFails(sets) {
  let count = 0;
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i] === null) break;      // unrecorded — stop
    if (setFailed(sets[i])) count++;
    else break;                        // a passing set breaks the streak
  }
  return count;
}

// After recording a set, check if 3 consecutive fails have occurred
// and lock the remaining sets if so
function applyLockout(lr) {
  const recorded = lr.sets.filter(s => s !== null);
  if (recorded.length === 0) { lr.locked = false; return; }

  // Find the last 3 recorded sets (or fewer if not enough done yet)
  const recordedVals = lr.sets.filter(s => s !== null);
  const lastThree = recordedVals.slice(-3);
  const threeFails = lastThree.length === 3 && lastThree.every(v => setFailed(v));

  if (threeFails) {
    lr.locked = true;
    // Null out any remaining unrecorded sets — they're locked out
    lr.sets = lr.sets.map(s => s === null ? 'locked' : s);
  } else {
    lr.locked = false;
  }
}

// ── Workout render ────────────────────────────────────────────

function renderWorkout() {
  const day = currentSession.day;
  document.getElementById('workout-day').textContent = `WORKOUT ${day}`;

  const container = document.getElementById('lifts-container');
  container.innerHTML = '';

  currentSession.liftResults.forEach((lr, idx) => {
    const state = liftStates[lr.liftId] || {};
    const failures = state.failures || 0;
    const isDeload = (state.deloads || 0) > 0;

    const recordedSets = lr.sets.filter(s => s !== null && s !== 'locked');
    const allFive     = recordedSets.length === 5 && recordedSets.every(v => v === 5);
    const anyFail     = recordedSets.some(v => setFailed(v));
    const isPR        = allFive && (personalRecords[lr.liftId] ?? 0) > 0 && lr.weight > (personalRecords[lr.liftId] ?? 0);

    let cardClass = 'lift-card card';
    if (lr.locked)    cardClass += ' lift-locked';
    else if (allFive) cardClass += ' lift-done';
    else if (anyFail) cardClass += ' lift-fail';

    let badge = '';
    if (isPR)              badge += `<span class="badge badge-accent" style="margin-left:8px;">PR</span>`;
    if (lr.locked)         badge += `<span class="badge badge-danger" style="margin-left:8px;">STOPPED</span>`;
    else if (isDeload)     badge += `<span class="badge badge-info" style="margin-left:8px;">DELOAD</span>`;
    else if (failures >= 2) badge += `<span class="badge badge-danger" style="margin-left:8px;">${failures} FAILS</span>`;

    const setButtons = lr.sets.map((s, si) => {
      if (s === 'locked') {
        return `<button class="set-btn locked" disabled aria-label="Set ${si+1} locked">—</button>`;
      }
      // Determine button class and label
      let cls = 'set-btn';
      let label = String(si + 1); // default: set number when unrecorded
      if (s === null) {
        cls = 'set-btn';
        label = String(si + 1);
      } else if (s === 5) {
        cls = 'set-btn done';
        label = '5';
      } else if (s === 0) {
        cls = 'set-btn fail';
        label = '0';
      } else {
        cls = 'set-btn partial';
        label = String(s);
      }
      return `<button class="${cls}" onclick="cycleSet(${idx},${si})" aria-label="Set ${si+1}: ${s === null ? 'not recorded' : s + ' reps'}">${label}</button>`;
    }).join('');

    // Summary: total reps out of 25
    const totalReps = recordedSets.reduce((a, v) => a + v, 0);
    const maxReps = recordedSets.length * 5;
    const summaryLabel = recordedSets.length === 0
      ? 'tap to record'
      : lr.locked
        ? `stopped — ${totalReps} reps`
        : `${totalReps}/${maxReps} reps`;

    let warningLine = '';
    if (lr.locked) {
      warningLine = `<div class="lift-warn">3 consecutive failures — lift ended for today</div>`;
    } else if (failures >= 2 && !isDeload) {
      warningLine = `<div class="lift-warn">Next session failure triggers deload</div>`;
    } else if (isDeload) {
      warningLine = `<div class="lift-warn deload-note">Deloaded — working back up</div>`;
    }

    container.insertAdjacentHTML('beforeend', `
      <div class="${cardClass}" id="lift-card-${idx}">
        <div class="lift-header">
          <div>
            <div class="lift-name">${lr.name}${badge}</div>
            ${warningLine}
          </div>
          <div class="lift-weight-block">
            <div class="lift-weight">${lr.weight}<span>lb</span></div>
            <div class="lift-prescription">5 × 5</div>
          </div>
        </div>
        <div class="sets-row">
          ${setButtons}
          <span class="sets-count">${summaryLabel}</span>
        </div>
      </div>
    `);
  });

  // Enable finish button once at least one set is recorded on any lift
  const anyStarted = currentSession.liftResults.some(lr =>
    lr.sets.some(s => s !== null)
  );
  document.getElementById('finish-btn').disabled = !anyStarted;
}

// Expose to HTML onclick
// Cycles: null → 5 → 4 → 3 → 2 → 1 → 0 → null
window.cycleSet = function(liftIdx, setIdx) {
  const lr = currentSession.liftResults[liftIdx];
  if (lr.locked || lr.sets[setIdx] === 'locked') return;

  const cur = lr.sets[setIdx];
  if (cur === null)     lr.sets[setIdx] = 5;
  else if (cur === 0)   lr.sets[setIdx] = null;
  else                  lr.sets[setIdx] = cur - 1;

  applyLockout(lr);
  renderWorkout();
};

// ── Finish workout ────────────────────────────────────────────

window.openFinishModal = function() {
  const failedLifts = currentSession.liftResults.filter(lr =>
    lr.sets.some(s => s !== null && s !== 'locked' && setFailed(s))
  );
  const lockedLifts = currentSession.liftResults.filter(lr => lr.locked);
  const allPerfect  = currentSession.liftResults.every(lr =>
    lr.sets.every(s => s === 5)
  );

  let title = allPerfect ? '💪 PERFECT SESSION' : 'SAVE SESSION?';
  let body  = '';

  if (allPerfect) {
    body = 'All 25 reps completed. Weights go up next session.';
  } else {
    const parts = [];
    if (lockedLifts.length > 0) {
      parts.push(`${lockedLifts.map(l=>l.name).join(', ')} stopped early after 3 consecutive failed sets.`);
    }
    if (failedLifts.length > 0) {
      parts.push(`Missed reps on: ${failedLifts.map(l=>l.name).join(', ')}. No weight increase — failure counter ticks up.`);
    }
    body = parts.join(' ');
  }

  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('finish-modal').classList.add('open');
};

window.closeFinishModal = function() {
  document.getElementById('finish-modal').classList.remove('open');
};

window.confirmFinish = async function() {
  closeFinishModal();
  document.getElementById('finish-btn').disabled = true;
  document.getElementById('finish-btn').innerHTML = '<span class="spinner"></span>';

  try {
    // Build liftResults shaped for db.js: sets_passed = number of sets where reps === 5
    const liftResultsForDb = currentSession.liftResults.map(lr => ({
      ...lr,
      // db.js reads sets array and counts s === true; we adapt: pass reps as-is,
      // and override sets_passed count in saveSession call below
      sets: lr.sets,
    }));

    await saveSession(user.id, currentSession.day, liftResultsForDb);

    // Update lift states
    const updates = [];
    for (const lr of currentSession.liftResults) {
      const state = liftStates[lr.liftId] || { failures: 0, deloads: 0, weight: lr.weight };

      // A lift passes only if all 5 sets were completed at 5 reps
      const recordedSets = lr.sets.filter(s => s !== null && s !== 'locked');
      const allFive = recordedSets.length === 5 && recordedSets.every(v => v === 5);

      let newWeight   = state.weight;
      let newFailures = state.failures;
      let newDeloads  = state.deloads || 0;

      if (allFive) {
        newWeight   = Math.round((state.weight + lr.increment) * 10) / 10;
        newFailures = 0;
        if (newDeloads > 0) newDeloads--;
      } else {
        newFailures = state.failures + 1;
        if (newFailures >= 3) {
          newWeight   = Math.round(state.weight * 0.9 / 2.5) * 2.5;
          newFailures = 0;
          newDeloads++;
        }
      }

      updates.push(upsertLiftState(user.id, lr.liftId, {
        weight: newWeight,
        failures: newFailures,
        deloads: newDeloads,
      }));

      liftStates[lr.liftId] = { ...state, weight: newWeight, failures: newFailures, deloads: newDeloads };
    }

    const nextDay = currentSession.day === 'A' ? 'B' : 'A';
    updates.push(
      import('./db.js').then(({ updateProfile }) =>
        updateProfile(user.id, { next_workout: nextDay })
      )
    );
    profile.next_workout = nextDay;

    await Promise.all(updates);
    personalRecords = await getPersonalRecords(user.id);

    toast('Session saved!', 'success');
    initSession();

  } catch (e) {
    console.error(e);
    toast('Failed to save. Please try again.', 'error');
    document.getElementById('finish-btn').disabled = false;
    document.getElementById('finish-btn').textContent = 'FINISH WORKOUT';
  }
};

// ── Tab navigation ────────────────────────────────────────────

window.showTab = function(name) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).style.display = 'block';
  document.getElementById(`bnav-${name}`).classList.add('active');

  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
};

// ── History ───────────────────────────────────────────────────

async function renderHistory() {
  const container = document.getElementById('history-container');
  container.innerHTML = '<div class="loading-msg">Loading history…</div>';

  try {
    const { getSessions } = await import('./db.js');
    const sessions = await getSessions(user.id, 100);

    const totalWorkouts = sessions.length;
    const totalSets = sessions.reduce((acc, s) =>
      acc + s.session_lifts.reduce((a, l) => a + l.sets_passed, 0), 0);
    const successRate = totalWorkouts === 0 ? 0
      : Math.round(totalSets / (totalWorkouts * 15) * 100);

    const squatMax = sessions.reduce((max, s) => {
      const sq = s.session_lifts.find(l => l.lift_id === 'squat' && l.sets_passed === 5);
      return sq ? Math.max(max, sq.weight) : max;
    }, 0);

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Sessions</div>
          <div class="stat-val">${totalWorkouts}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sets Done</div>
          <div class="stat-val">${totalSets}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Success</div>
          <div class="stat-val">${successRate}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Squat PR</div>
          <div class="stat-val">${squatMax || '—'}<span style="font-size:14px;color:var(--muted);"> lb</span></div>
        </div>
      </div>
      <div class="history-list" id="history-list"></div>
    `;

    const list = document.getElementById('history-list');

    if (sessions.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>No sessions yet</h3>
        <p>Complete your first workout to start tracking progress.</p>
      </div>`;
      return;
    }

    sessions.forEach(s => {
      const date = new Date(s.completed_at);
      const dateStr = date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
      const liftsHtml = s.session_lifts.map(l => {
        const cls = l.sets_passed === 5 ? 'h-lift pass' : 'h-lift fail';
        return `<span class="${cls}">${l.lift_name} ${l.weight}lb ${l.sets_passed}/5</span>`;
      }).join('');

      list.insertAdjacentHTML('beforeend', `
        <div class="history-item card card-sm">
          <div class="history-meta">
            <span class="history-day">Workout ${s.workout_day}</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-lifts">${liftsHtml}</div>
        </div>
      `);
    });

  } catch (e) {
    container.innerHTML = '<div class="loading-msg text-danger">Failed to load history.</div>';
  }
}

// ── Settings ──────────────────────────────────────────────────

const LIFT_NAMES = { squat:'Squat', bench:'Bench Press', row:'Barbell Row', press:'Overhead Press', deadlift:'Deadlift' };

function renderSettings() {
  const container = document.getElementById('settings-container');

  const weightsHtml = Object.entries(LIFT_NAMES).map(([id, name]) => {
    const s = liftStates[id] || {};
    return `
      <div class="settings-row">
        <div>
          <div class="settings-label">${name}</div>
          <div class="text-muted" style="font-size:12px;">${s.failures||0} failures · ${s.deloads||0} deloads</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-family:var(--font-d);font-weight:700;color:var(--accent);">${s.weight||45} lb</span>
          <button class="btn btn-ghost btn-sm" onclick="editWeight('${id}','${name}')">EDIT</button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Profile</div>
      <div class="settings-row">
        <div class="settings-label">Name</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="color:var(--muted);">${profile.display_name}</span>
          <button class="btn btn-ghost btn-sm" onclick="editName()">EDIT</button>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-label">Email</div>
        <span style="color:var(--muted);font-size:13px;">${user.email}</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Current Weights</div>
      ${weightsHtml}
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Program</div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Next Workout</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-family:var(--font-d);font-weight:700;color:var(--accent);">Workout ${profile.next_workout}</span>
          <button class="btn btn-ghost btn-sm" onclick="toggleDay()">TOGGLE</button>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-label">Deload rule</div>
        <span style="color:var(--muted);font-size:13px;">3 fails → −10%</span>
      </div>
      <div class="settings-row">
        <div class="settings-label">Upper body increment</div>
        <span style="color:var(--muted);font-size:13px;">+2.5 lb / session</span>
      </div>
      <div class="settings-row">
        <div class="settings-label">Lower body increment</div>
        <span style="color:var(--muted);font-size:13px;">+5 lb / session</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Account</div>
      <div class="settings-row">
        <div class="settings-label">Sign out</div>
        <button class="btn btn-ghost btn-sm" onclick="handleSignOut()">SIGN OUT</button>
      </div>
    </div>
  `;
}

window.editWeight = async function(liftId, liftName) {
  const current = liftStates[liftId]?.weight ?? 45;
  const val = parseFloat(prompt(`New weight for ${liftName} (lb):`, current));
  if (isNaN(val) || val <= 0) return;
  const rounded = Math.round(val * 10) / 10;
  await upsertLiftState(user.id, liftId, { weight: rounded, failures: 0 });
  liftStates[liftId] = { ...liftStates[liftId], weight: rounded, failures: 0 };
  toast(`${liftName} set to ${rounded} lb`, 'success');
  renderSettings();
  initSession();
};

window.editName = async function() {
  const val = prompt('Display name:', profile.display_name);
  if (!val || !val.trim()) return;
  const { updateProfile } = await import('./db.js');
  await updateProfile(user.id, { display_name: val.trim() });
  profile.display_name = val.trim();
  renderNav();
  renderSettings();
  toast('Name updated', 'success');
};

window.toggleDay = async function() {
  const next = profile.next_workout === 'A' ? 'B' : 'A';
  const { updateProfile } = await import('./db.js');
  await updateProfile(user.id, { next_workout: next });
  profile.next_workout = next;
  renderSettings();
  initSession();
  toast(`Next workout set to Workout ${next}`, 'success');
};

window.handleSignOut = async function() {
  if (!confirm('Sign out?')) return;
  await signOut();
};

// ── Boot ──────────────────────────────────────────────────────
init();
