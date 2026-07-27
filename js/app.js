// ============================================================
// app.js — Main workout app logic
// ============================================================

import { supabase } from './supabase.js';
import { getSession, signOut, ensureLiftStates } from './auth.js';
import { getProfile, getLiftStates, upsertLiftState, saveSession, getPersonalRecords, saveMovementSession } from './db.js';

// ── Program Definition ────────────────────────────────────────

const WORKOUT_A = [
  { id: 'squat',  name: 'Squat',        increment: 5,   reps: 5 },
  { id: 'bench',  name: 'Bench Press',  increment: 2.5, reps: 5 },
  { id: 'row',    name: 'Barbell Row',  increment: 2.5, reps: 5 },
];
const WORKOUT_B = [
  { id: 'squat',    name: 'Squat',           increment: 5,   reps: 5 },
  { id: 'press',    name: 'Overhead Press',  increment: 2.5, reps: 5 },
  { id: 'deadlift', name: 'Deadlift',        increment: 10,  reps: 5 },
];

// ── App State ─────────────────────────────────────────────────

let user = null;
let profile = null;
let liftStates = null;
let personalRecords = null;
let currentSession = null;

// ── Timer state ───────────────────────────────────────────────
let timerInterval = null;
let sessionStartTime = null;
let lastSetTime = null;

window.startTimer = function() {
  if (timerInterval) return; // already running
  sessionStartTime = sessionStartTime || Date.now();
  timerInterval = setInterval(updateTimerDisplay, 1000);
  document.getElementById('timer-start-btn').style.display = 'none';
  document.getElementById('timer-display').classList.add('running');
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const now = Date.now();
  // Total session time
  const totalSecs = sessionStartTime ? Math.floor((now - sessionStartTime) / 1000) : 0;
  document.getElementById('timer-total').textContent = formatTime(totalSecs);
  // Time since last set
  if (lastSetTime) {
    const setSecs = Math.floor((now - lastSetTime) / 1000);
    document.getElementById('timer-rest').textContent = formatTime(setSecs);
    document.getElementById('timer-rest-label').style.display = 'flex';
    document.getElementById('timer-divider-rest').style.display = 'block';
  }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function recordSetTime() {
  if (!sessionStartTime) startTimer();
  lastSetTime = Date.now();
  updateTimerDisplay();
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  sessionStartTime = null;
  lastSetTime = null;
  document.getElementById('timer-total').textContent = '00:00';
  document.getElementById('timer-rest').textContent = '00:00';
  document.getElementById('timer-rest-label').style.display = 'none';
  document.getElementById('timer-divider-rest').style.display = 'none';
  document.getElementById('timer-start-btn').style.display = 'flex';
  document.getElementById('timer-display').classList.remove('running');
}

// ── Global settings (stored in localStorage) ─────────────────
const SETTINGS_KEY = '2x5strong_settings';

function getGlobalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { minIncrement: 5, ...JSON.parse(raw) };
  } catch(e) {}
  return { minIncrement: 5 };
}

function saveGlobalSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Round weight to nearest minIncrement (0.5 rounds up)
// ── Session persistence (survives page reload) ───────────────
const SESSION_DRAFT_KEY = '2x5strong_draft';

function saveDraftSession() {
  if (!user || !currentSession) return;
  try {
    localStorage.setItem(SESSION_DRAFT_KEY + '_' + user.id, JSON.stringify({
      session: currentSession,
      accessories: accessoryItems,
      timerStart: sessionStartTime,
      timerLast: lastSetTime,
      savedAt: Date.now(),
    }));
  } catch(e) { console.warn('Draft save failed:', e); }
}

function loadDraftSession() {
  if (!user) return null;
  try {
    const raw = localStorage.getItem(SESSION_DRAFT_KEY + '_' + user.id);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    // Discard drafts older than 24 hours
    if (Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) {
      clearDraftSession();
      return null;
    }
    return draft;
  } catch(e) { return null; }
}

function clearDraftSession() {
  if (!user) return;
  localStorage.removeItem(SESSION_DRAFT_KEY + '_' + user.id);
}

function roundToIncrement(weight, minIncrement) {
  return Math.round(weight / minIncrement) * minIncrement;
}

// Effective increment for a lift: natural increment floored up to minIncrement
function effectiveIncrement(naturalIncrement, minIncrement) {
  return Math.max(naturalIncrement, minIncrement);
}

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
  loadAccessoryData();

  // Restore draft session if one exists, otherwise start fresh
  const draft = loadDraftSession();
  if (draft && draft.session && draft.session.day) {
    currentSession = draft.session;
    accessoryItems = draft.accessories || [];
    // Restore timer state
    if (draft.timerStart) {
      sessionStartTime = draft.timerStart;
      lastSetTime = draft.timerLast;
      startTimer();
    }
    renderWorkout();
    renderAccessories();
    toast('Session restored', 'success');
  } else {
    initSession();
  }

  showTab('workout');
  document.getElementById('app-loading').style.display = 'none';
  document.getElementById('app-content').style.display = 'block';

  // Check session timing after a brief delay so UI is visible first
  setTimeout(() => checkSessionTiming(), 300);
}

// ── Session timing check ──────────────────────────────────────

async function checkSessionTiming() {
  try {
    const { getSessions } = await import('./db.js');
    const recent = await getSessions(user.id, 1);
    if (!recent || recent.length === 0) return; // first session ever

    const lastDate = new Date(recent[0].completed_at);
    const now = new Date();
    const daysSince = (now - lastDate) / (1000 * 60 * 60 * 24);

    // Same calendar day
    const sameDay = lastDate.toDateString() === now.toDateString();

    if (sameDay) {
      showTimingModal({
        title: '⚠️ SAME DAY WARNING',
        body: "Your last session was earlier today. Your muscles need time to recover — lifting twice in one day works against you. Rest up and come back tomorrow.",
        confirmLabel: 'DO IT ANYWAY',
        confirmStyle: 'background: var(--danger); color: #fff;',
        cancelLabel: "GOT IT, I'LL WAIT",
        onConfirm: null, // just close, session already initialized
        onCancel: null,
      });
    } else if (daysSince >= 7) {
      // Skip deload suggestion if a movement day is already selected —
      // movement day IS the deload in that case
      if (currentSession && currentSession.isMovementDay) return;

      const dayWord = Math.round(daysSince) === 1 ? 'day' : 'days';
      showTimingModal({
        title: '📅 BEEN A WHILE',
        body: `It has been ${Math.round(daysSince)} ${dayWord} since your last session. Your body may need time to readjust — consider a deload: drop all weights to 90% for this session to ease back in and avoid injury. Or tap "Not feeling it?" for a lighter movement day instead.`,
        confirmLabel: 'DELOAD THIS SESSION',
        confirmStyle: 'background: var(--info); color: #fff;',
        cancelLabel: 'LIFT FULL WEIGHT',
        onConfirm: applySessionDeload,
        onCancel: null,
      });
    }
  } catch(e) {
    console.warn('Session timing check failed:', e);
  }
}

function applySessionDeload() {
  // Drop all working weights by 10% for this session only (don't save to DB)
  const settings = getGlobalSettings();
  currentSession.liftResults.forEach(lr => {
    lr.weight = roundToIncrement(Math.round(lr.weight * 0.9 / 2.5) * 2.5, settings.minIncrement);
    // Regenerate warmups with new weight
    lr.warmups = generateWarmups(lr.weight, lr.barWeight).map(w => ({ ...w, done: false }));
  });
  currentSession.isSessionDeload = true;
  renderWorkout();
  toast('Weights reduced 10% for this session', 'info');
}

let timingModalCallbacks = { onConfirm: null, onCancel: null };

function showTimingModal({ title, body, confirmLabel, confirmStyle, cancelLabel, onConfirm, onCancel }) {
  timingModalCallbacks = { onConfirm, onCancel };
  document.getElementById('timing-modal-title').textContent = title;
  document.getElementById('timing-modal-body').textContent = body;
  const confirmBtn = document.getElementById('timing-modal-confirm');
  confirmBtn.textContent = confirmLabel;
  confirmBtn.style.cssText = confirmStyle;
  document.getElementById('timing-modal-cancel').textContent = cancelLabel;
  document.getElementById('timing-modal').classList.add('open');
}

window.timingModalConfirm = function() {
  document.getElementById('timing-modal').classList.remove('open');
  if (timingModalCallbacks.onConfirm) timingModalCallbacks.onConfirm();
};
window.timingModalCancel = function() {
  document.getElementById('timing-modal').classList.remove('open');
  if (timingModalCallbacks.onCancel) timingModalCallbacks.onCancel();
};

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

// ── Deadlift progression rules ───────────────────────────────
// Under 225lb: 5×5, +10lb per session
// 225lb and over: 1×5, +5lb per session
const DEADLIFT_HEAVY_THRESHOLD = 225;

function deadliftSetsCount(weight) {
  return weight >= DEADLIFT_HEAVY_THRESHOLD ? 1 : 5;
}

function deadliftIncrement(weight) {
  return weight >= DEADLIFT_HEAVY_THRESHOLD ? 5 : 10;
}

// ── Warmup set generator ──────────────────────────────────────
// Returns array of { weight, reps } for warmup sets.
// Skips any step within MIN_GAP lb of bar, working weight, or each other.
const MIN_GAP = 10;

function generateWarmups(workingWeight, barWeight) {
  if (workingWeight <= barWeight) return [];

  const candidates = [
    { pct: 0,    reps: 5 },   // bar only
    { pct: 0.40, reps: 5 },
    { pct: 0.60, reps: 3 },
    { pct: 0.80, reps: 2 },
  ].map(c => ({
    weight: c.pct === 0 ? barWeight : Math.round(workingWeight * c.pct / 5) * 5,
    reps: c.reps,
  }));

  // Filter: must be >= barWeight, must be < workingWeight,
  // must be far enough from working weight and from previous kept set
  const kept = [];
  for (const c of candidates) {
    if (c.weight < barWeight) continue;
    if (workingWeight - c.weight < MIN_GAP) continue;
    if (kept.length > 0 && c.weight - kept[kept.length-1].weight < MIN_GAP) continue;
    // Deduplicate identical weights
    if (kept.length > 0 && c.weight === kept[kept.length-1].weight) continue;
    kept.push(c);
  }
  return kept;
}

// ── Session init ──────────────────────────────────────────────

function initSession() {
  const day = profile.next_workout || 'A';
  const lifts = day === 'A' ? WORKOUT_A : WORKOUT_B;

  accessoryItems = [];
  renderAccessories();

  currentSession = {
    day,
    liftResults: lifts.map(lift => ({
      liftId: lift.id,
      name: lift.name,
      increment: lift.increment,
      weight: liftStates[lift.id]?.weight ?? 45,
      barWeight: liftStates[lift.id]?.bar_weight ?? 45,
      increment: effectiveIncrement(
        lift.id === 'deadlift' ? deadliftIncrement(liftStates[lift.id]?.weight ?? 45) : lift.increment,
        getGlobalSettings().minIncrement
      ),
      // null = unrecorded, 0–5 = reps completed
      // deadlift uses 1 set above threshold, 5 sets below
      sets: Array(lift.id === 'deadlift' ? deadliftSetsCount(liftStates[lift.id]?.weight ?? 45) : 5).fill(null),
      // locked = true when 3 consecutive failed sets end this lift early
      locked: false,
      // warmups generated once at session start, toggled done/undone
      // each: { weight, reps, done }
      warmups: generateWarmups(liftStates[lift.id]?.weight ?? 45, liftStates[lift.id]?.bar_weight ?? 45)
                 .map(w => ({ ...w, done: false })),
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

window.renderWorkout = function() {
  const day = currentSession.day;
  document.getElementById('workout-day').textContent = `WORKOUT ${day}`;

  const container = document.getElementById('lifts-container');
  container.innerHTML = '';

  currentSession.liftResults.forEach((lr, idx) => {
    const state = liftStates[lr.liftId] || {};
    const failures = state.failures || 0;
    const isDeload = (state.deloads || 0) > 0;

    const recordedSets = lr.sets.filter(s => s !== null && s !== 'locked');
    const totalSets   = lr.sets.length;
    const allFive     = recordedSets.length === totalSets && recordedSets.every(v => v === 5);
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

    // Generate warmup sets display (interactive, optional)
    const warmupsHtml = lr.warmups.length === 0 ? '' : `
      <div class="warmup-sets">
        <div class="warmup-label">WARM-UP <span class="warmup-optional">— optional</span></div>
        <div class="warmup-rows">${lr.warmups.map((w, wi) =>
          `<button class="warmup-row ${w.done ? 'warmup-done' : ''}"
                   onclick="toggleWarmup(${idx},${wi})"
                   aria-label="${w.weight}lb × ${w.reps} reps, ${w.done ? 'done' : 'not done'}">
            <span class="warmup-check">${w.done ? '✓' : ''}</span>
            <span class="warmup-weight">${w.weight}<span class="warmup-unit">lb</span></span>
            <span class="warmup-reps">${w.reps} rep${w.reps !== 1 ? 's' : ''}</span>
          </button>`
        ).join('')}</div>
      </div>
    `;

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
    const maxReps = totalSets * 5;
    const summaryLabel = recordedSets.length === 0
      ? 'tap to record'
      : lr.locked
        ? `stopped — ${totalReps} reps`
        : `${totalReps}/${maxReps} reps`;

    let warningLine = '';
    if (lr.locked) {
      warningLine = `<div class="lift-warn">3 consecutive failures — lift ended for today</div>`;
    } else if (lr.liftId === 'deadlift' && lr.weight >= DEADLIFT_HEAVY_THRESHOLD) {
      warningLine = `<div class="lift-warn deload-note">Heavy deadlift — 1 work set, +5 lb progression</div>`;
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
          <div class="lift-weight-block" onclick="editLiftWeight(${idx})" title="Tap to edit weight" style="cursor:pointer;">
            <div class="lift-weight">${lr.weight}<span>lb</span></div>
            <div class="lift-prescription">${totalSets} × 5 <span style="font-size:10px;color:var(--muted2);">✎</span></div>
          </div>
        </div>
        ${warmupsHtml}
        <div class="work-sets-label">WORK SETS</div>
        <div class="sets-row">
          ${setButtons}
          <span class="sets-count">${summaryLabel}</span>
        </div>
      </div>
    `);
  });

  // Enable finish button as soon as anything has been done
  const anyWorkDone = currentSession.liftResults.some(lr =>
    lr.sets.some(s => s !== null) || lr.warmups.some(w => w.done)
  );
  const timerStarted = sessionStartTime !== null;
  document.getElementById('finish-btn').disabled = !(anyWorkDone || timerStarted);
}

// Expose to HTML onclick
// Cycles: null → 5 → 4 → 3 → 2 → 1 → 0 → null
window.cycleSet = function(liftIdx, setIdx) {
  const lr = currentSession.liftResults[liftIdx];
  if (lr.locked || lr.sets[setIdx] === 'locked') return;

  const cur = lr.sets[setIdx];
  if (cur === null) {
    lr.sets[setIdx] = 5;
    recordSetTime(); // starting a set — record time
  } else if (cur === 0) {
    lr.sets[setIdx] = null;
  } else {
    lr.sets[setIdx] = cur - 1;
  }

  applyLockout(lr);
  saveDraftSession();
  renderWorkout();
};

window.toggleWarmup = function(liftIdx, warmupIdx) {
  const lr = currentSession.liftResults[liftIdx];
  lr.warmups[warmupIdx].done = !lr.warmups[warmupIdx].done;
  saveDraftSession();
  renderWorkout();
};

window.editLiftWeight = async function(liftIdx) {
  const lr = currentSession.liftResults[liftIdx];
  const val = parseFloat(prompt(`Weight for ${lr.name} (lb):`, lr.weight));
  if (isNaN(val) || val <= 0) return;

  const settings = getGlobalSettings();
  const rounded = roundToIncrement(val, settings.minIncrement);

  // Update current session
  lr.weight = rounded;
  lr.warmups = generateWarmups(rounded, lr.barWeight).map(w => ({ ...w, done: false }));

  // Save to profile
  await upsertLiftState(user.id, lr.liftId, { weight: rounded, failures: 0 });
  liftStates[lr.liftId] = { ...liftStates[lr.liftId], weight: rounded, failures: 0 };

  saveDraftSession();
  renderWorkout();
  toast(`${lr.name} updated to ${rounded} lb`, 'success');
};

// ── Finish workout ────────────────────────────────────────────

window.openFinishModal = function() {
  let title, body;

  if (currentSession.isMovementDay) {
    // Movement day — just confirm save, no failure logic
    const totalRecorded = currentSession.liftResults.reduce((acc, lr) =>
      acc + lr.sets.filter(s => s !== null).length, 0);
    const totalSets = currentSession.liftResults.reduce((acc, lr) => acc + lr.sets.length, 0);
    const allDone = totalRecorded === totalSets;
    title = allDone ? '💪 MOVEMENT DAY DONE' : 'SAVE SESSION?';
    body = allDone
      ? 'Great work — movement logged. No progression changes.'
      : `${totalRecorded} of ${totalSets} sets recorded. Movement day — no progression changes.`;
  } else {
    // Regular strength session
    const failedLifts = currentSession.liftResults.filter(lr =>
      lr.sets.some(s => s !== null && s !== 'locked' && setFailed(s))
    );
    const lockedLifts = currentSession.liftResults.filter(lr => lr.locked);
    const allPerfect  = currentSession.liftResults.every(lr => {
      const recorded = lr.sets.filter(s => s !== null && s !== 'locked');
      return recorded.length === lr.sets.length && recorded.every(v => v === 5);
    });

    title = allPerfect ? '💪 PERFECT SESSION' : 'SAVE SESSION?';

    if (allPerfect) {
      body = 'All sets completed. Weights go up next session.';
    } else {
      const parts = [];
      if (lockedLifts.length > 0) {
        parts.push(`${lockedLifts.map(l=>l.name).join(', ')} stopped early after 3 consecutive failed sets.`);
      }
      if (failedLifts.length > 0) {
        parts.push(`Missed reps on: ${failedLifts.map(l=>l.name).join(', ')}. No weight increase — failure counter ticks up.`);
      }
      body = parts.join(' ') || 'Session recorded.';
    }
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

    let savedSession = null;

    if (currentSession.isMovementDay) {
      // Save to movement_sessions + movement_session_exercises
      savedSession = await saveMovementSession(user.id, {
        title: movementDayWorkout?.title || 'Movement Day',
        tagline: movementDayWorkout?.tagline || '',
        promptUsed: lastMovementPrompt,
        exercises: currentSession.liftResults.map(lr => ({
          name: lr.name,
          category: lr.category,
          weight: lr.weight,
          prescription: lr.prescription,
          sets: lr.sets,
        })),
      });
    } else {
      // Save to sessions + session_lifts (normal path)
      savedSession = await saveSession(user.id, currentSession.day, liftResultsForDb);

      // Save accessory logs if any were recorded
      const filledAccessories = accessoryItems.filter(a =>
        a.sets.some(s => s.reps !== '' && s.reps !== undefined)
      );
      if (filledAccessories.length > 0 && savedSession) {
        const { saveAccessoryLogs } = await import('./db.js');
        await saveAccessoryLogs(savedSession.id, user.id, filledAccessories);
      }
    }

    // Update lift states
    const updates = [];
    for (const lr of currentSession.liftResults) {
      // Skip progression for movement day exercises
      if (currentSession.isMovementDay || lr.movementDay) continue;

      const state = liftStates[lr.liftId] || { failures: 0, deloads: 0, weight: lr.weight };

      // A lift passes only if all sets were completed at 5 reps
      const recordedSets = lr.sets.filter(s => s !== null && s !== 'locked');
      const allFive = recordedSets.length === lr.sets.length && recordedSets.every(v => v === 5);

      let newWeight   = state.weight;
      let newFailures = state.failures;
      let newDeloads  = state.deloads || 0;

      const settings = getGlobalSettings();
      const effIncrement = effectiveIncrement(lr.increment, settings.minIncrement);
      if (allFive) {
        newWeight   = roundToIncrement(state.weight + effIncrement, settings.minIncrement);
        newFailures = 0;
        if (newDeloads > 0) newDeloads--;
      } else {
        newFailures = state.failures + 1;
        if (newFailures >= 3) {
          newWeight   = roundToIncrement(state.weight * 0.9, settings.minIncrement);
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

    // Movement days don't advance the A/B alternation or affect progression
    if (!currentSession.isMovementDay) {
      const nextDay = currentSession.day === 'A' ? 'B' : 'A';
      updates.push(
        import('./db.js').then(({ updateProfile }) =>
          updateProfile(user.id, { next_workout: nextDay })
        )
      );
      profile.next_workout = nextDay;
    }

    await Promise.all(updates);
    personalRecords = await getPersonalRecords(user.id);

    clearDraftSession();
    toast('Session saved!', 'success');
    resetTimer();
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

window.renderHistory = async function() {
  const container = document.getElementById('history-container');
  container.innerHTML = '<div class="loading-msg">Loading history…</div>';

  try {
    const { getSessions, getCustomExercises, getMovementSessions } = await import('./db.js');
    const [sessions, movementSessions] = await Promise.all([
      getSessions(user.id, 100),
      getMovementSessions(user.id, 50),
    ]);

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

    if (sessions.length === 0 && movementSessions.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>No sessions yet</h3>
        <p>Complete your first workout to start tracking progress.</p>
      </div>`;
      return;
    }

    // Merge and sort all sessions by date descending
    const allSessions = [
      ...sessions.map(s => ({ ...s, type: 'strength' })),
      ...movementSessions.map(s => ({ ...s, type: 'movement' })),
    ].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

    allSessions.forEach(s => {
      const date = new Date(s.completed_at);
      const dateStr = date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

      // Movement day sessions render differently
      if (s.type === 'movement') {
        const exHtml = (s.movement_session_exercises || [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(ex => {
            const sets = ex.sets_json || [];
            const totalReps = sets.filter(r => r !== null).reduce((a, v) => a + (v || 0), 0);
            const volume = ex.weight > 0 ? totalReps * ex.weight : 0;
            const volStr = volume > 0 ? ` · ${Math.round(volume).toLocaleString()}lb` : '';
            return `<span class="h-lift" style="color:var(--info);">${ex.name} ${ex.weight > 0 ? ex.weight+'lb' : 'BW'} ${totalReps}r${volStr}</span>`;
          }).join('');

        list.insertAdjacentHTML('beforeend', `
          <div class="history-item card card-sm">
            <div class="history-meta">
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="history-day">${s.title || 'Movement Day'}</span>
                <span class="badge badge-info" style="font-size:10px;">MOVEMENT</span>
              </div>
              <div class="history-date">${new Date(s.completed_at).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}</div>
            </div>
            <div class="history-lifts">${exHtml}</div>
            ${s.tagline ? `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:6px;">"${s.tagline}"</div>` : ''}
          </div>
        `);
        return;
      }

      const liftsHtml = s.session_lifts.map(l => {
        const cls = l.sets_passed === 5 ? 'h-lift pass' : 'h-lift fail';

        // Work volume: only sets where reps === 5 count as full sets,
        // but include actual reps for partial sets too
        const workSets = (l.sets_json || []).filter(s => s !== null && s !== 'locked');
        const workVolume = workSets.reduce((acc, reps) => acc + (reps * l.weight), 0);

        // Warmup volume: only completed warmup sets
        const warmupVolume = (l.warmups_json || [])
          .filter(w => w.done)
          .reduce((acc, w) => acc + (w.reps * w.weight), 0);

        const totalVolume = workVolume + warmupVolume;
        const volumeStr = totalVolume > 0 ? ` · ${Math.round(totalVolume).toLocaleString()}lb` : '';

        const expectedSets = l.lift_id === 'deadlift' && l.weight >= 225 ? 1 : 5;
        return `<span class="${cls}">${l.lift_name} ${l.weight}lb ${l.sets_passed}/${expectedSets}${volumeStr}</span>`;
      }).join('');

      // Session total volume
      const sessionVolume = s.session_lifts.reduce((acc, l) => {
        const workVol = (l.sets_json || []).filter(s => s !== null && s !== 'locked')
          .reduce((a, reps) => a + (reps * l.weight), 0);
        const warmupVol = (l.warmups_json || []).filter(w => w.done)
          .reduce((a, w) => a + (w.reps * w.weight), 0);
        return acc + workVol + warmupVol;
      }, 0);

      // Accessories summary
      const accessories = (s.accessory_logs || [])
        .sort((a,b) => a.sort_order - b.sort_order);
      const accessoriesHtml = accessories.length === 0 ? '' :
        '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">'
        + accessories.map(a => {
            const sets = (a.sets_json || []).filter(s => s.reps);
            if (sets.length === 0) return '';
            const summary = sets.map(s => {
              if (a.exercise_type === 'assisted') return `${s.reps}r${s.assistance ? ' -'+s.assistance+'lb' : ''}`;
              return `${s.reps}r${s.weight ? ' @'+s.weight+'lb' : ''}`;
            }).join(', ');
            return `<span class="h-lift" style="color:var(--muted);">${a.exercise_name}: ${summary}</span>`;
          }).filter(Boolean).join('')
        + '</div>';

      list.insertAdjacentHTML('beforeend', `
        <div class="history-item card card-sm">
          <div class="history-meta">
            <span class="history-day">Workout ${s.workout_day}</span>
            <div style="text-align:right;">
              <div class="history-date">${dateStr}</div>
              ${sessionVolume > 0 ? `<div style="font-size:11px;color:var(--muted2);">${Math.round(sessionVolume).toLocaleString()} lb total</div>` : ''}
            </div>
          </div>
          <div class="history-lifts">${liftsHtml}</div>
          ${accessoriesHtml}
        </div>
      `);
    });

  } catch (e) {
    container.innerHTML = '<div class="loading-msg text-danger">Failed to load history.</div>';
  }
}

// ── Settings ──────────────────────────────────────────────────

const LIFT_NAMES = { squat:'Squat', bench:'Bench Press', row:'Barbell Row', press:'Overhead Press', deadlift:'Deadlift' };

// ── Built-in exercise library ─────────────────────────────────
const BUILTIN_EXERCISES = [
  // Core
  { name: 'Hanging Leg Raises',     category: 'Core', type: 'standard' },
  { name: 'Ab Wheel Rollouts',      category: 'Core', type: 'standard' },
  { name: 'Cable Crunches',         category: 'Core', type: 'standard' },
  { name: 'Plank',                  category: 'Core', type: 'standard' },
  { name: 'Pallof Press',           category: 'Core', type: 'standard' },
  { name: 'Dead Bug',               category: 'Core', type: 'standard' },
  // Pull
  { name: 'Pull-Ups',               category: 'Pull', type: 'assisted' },
  { name: 'Chin-Ups',               category: 'Pull', type: 'assisted' },
  { name: 'Dips',                   category: 'Push', type: 'assisted' },
  { name: 'Face Pulls',             category: 'Pull', type: 'standard' },
  { name: 'Band Pull-Aparts',       category: 'Pull', type: 'standard' },
  { name: 'Cable Rows',             category: 'Pull', type: 'standard' },
  { name: 'Lat Pulldowns',          category: 'Pull', type: 'standard' },
  // Push
  { name: 'Push-Ups',               category: 'Push', type: 'standard' },
  { name: 'Cable Flyes',            category: 'Push', type: 'standard' },
  { name: 'DB Shoulder Press',      category: 'Push', type: 'standard' },
  { name: 'Lateral Raises',         category: 'Push', type: 'standard' },
  { name: 'Front Raises',           category: 'Push', type: 'standard' },
  // Legs
  { name: 'Lunges',                 category: 'Legs', type: 'standard' },
  { name: 'Box Step-Ups',           category: 'Legs', type: 'standard' },
  { name: 'Box Jumps',              category: 'Legs', type: 'standard' },
  { name: 'Bulgarian Split Squats', category: 'Legs', type: 'standard' },
  { name: 'Leg Press',              category: 'Legs', type: 'standard' },
  { name: 'Leg Curls',              category: 'Legs', type: 'standard' },
  { name: 'Calf Raises',            category: 'Legs', type: 'standard' },
  // Arms
  { name: 'Barbell Curls',          category: 'Arms', type: 'standard' },
  { name: 'Hammer Curls',           category: 'Arms', type: 'standard' },
  { name: 'Incline DB Curls',       category: 'Arms', type: 'standard' },
  { name: 'Tricep Pushdowns',       category: 'Arms', type: 'standard' },
  { name: 'Skull Crushers',         category: 'Arms', type: 'standard' },
  { name: 'DB Lateral Raises',      category: 'Arms', type: 'standard' },
];

const ACCESSORY_CATEGORIES = ['All', 'Core', 'Pull', 'Push', 'Legs', 'Arms', 'Other'];

// ── Accessory session state ───────────────────────────────────
let accessoryItems  = [];   // current session accessories
let customExercises = [];   // user's custom exercises from DB
let lastAccessories = [];   // from previous session for suggestions
let pickerCategory  = 'All';

// ── Load accessories data ─────────────────────────────────────
async function loadAccessoryData() {
  try {
    const { getCustomExercises, getLastAccessoryLogs } = await import('./db.js');
    const [custom, last] = await Promise.all([
      getCustomExercises(user.id),
      getLastAccessoryLogs(user.id),
    ]);
    customExercises = custom;
    lastAccessories = last;
    renderSuggestions();
  } catch(e) {
    console.warn('Failed to load accessory data:', e);
  }
}

// ── Suggestions ───────────────────────────────────────────────
window.renderSuggestions = function() {
  const strip = document.getElementById('accessory-suggestions');
  if (!strip) return;

  // Group last accessories by name, take unique ones
  const seen = new Set();
  const suggestions = lastAccessories
    .filter(a => { if (seen.has(a.exercise_name)) return false; seen.add(a.exercise_name); return true; })
    .slice(0, 6);

  if (suggestions.length === 0) { strip.innerHTML = ''; return; }

  strip.innerHTML = '<div style="font-size:11px;color:var(--muted2);font-family:var(--font-d);font-weight:700;letter-spacing:0.8px;text-transform:uppercase;width:100%;margin-bottom:2px;">From last session</div>'
    + suggestions.map(s => {
      const alreadyAdded = accessoryItems.some(a => a.name === s.exercise_name);
      if (alreadyAdded) return '';
      // Suggest with last session's sets as starting point
      return `<button class="suggestion-chip suggested" onclick="addSuggestedAccessory('${s.exercise_name.replace(/'/g,"\'")}', '${s.exercise_type}', '${s.category}')">${s.exercise_name}</button>`;
    }).filter(Boolean).join('');
}

// ── Accessory rendering ───────────────────────────────────────
window.renderAccessories = function() {
  const list = document.getElementById('accessory-list');
  if (!list) return;

  if (accessoryItems.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = accessoryItems.map((item, idx) => {
    const typeBadgeClass = item.type === 'assisted' ? 'type-assisted' : item.type === 'weighted' ? 'type-weighted' : 'type-standard';
    const typeBadgeLabel = item.type === 'assisted' ? 'ASSISTED' : item.type === 'weighted' ? 'WEIGHTED' : '';

    const setsHtml = item.sets.map((s, si) => {
      let inputs = '';
      if (item.type === 'assisted') {
        inputs = `
          <input class="accessory-input" type="number" min="0" placeholder="reps"
            value="${s.reps || ''}" oninput="updateAccessorySet(${idx},${si},'reps',this.value)">
          <span class="accessory-input-label">reps</span>
          <input class="accessory-input" type="number" min="0" placeholder="band"
            value="${s.assistance || ''}" oninput="updateAccessorySet(${idx},${si},'assistance',this.value)"
            style="border-color:var(--info);">
          <span class="accessory-input-label" style="color:var(--info);">lb assist</span>`;
      } else {
        inputs = `
          <input class="accessory-input" type="number" min="0" placeholder="reps"
            value="${s.reps || ''}" oninput="updateAccessorySet(${idx},${si},'reps',this.value)">
          <span class="accessory-input-label">reps</span>
          <input class="accessory-input" type="number" min="0" placeholder="lb"
            value="${s.weight || ''}" oninput="updateAccessorySet(${idx},${si},'weight',this.value)">
          <span class="accessory-input-label">lb</span>`;
      }
      return `<div class="accessory-set-row">
        <span class="accessory-set-num">${si+1}</span>
        ${inputs}
        <button class="accessory-set-remove" onclick="removeAccessorySet(${idx},${si})">✕</button>
      </div>`;
    }).join('');

    return `<div class="accessory-card">
      <div class="accessory-card-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="accessory-name">${item.name}</span>
          ${typeBadgeLabel ? `<span class="accessory-type-badge ${typeBadgeClass}">${typeBadgeLabel}</span>` : ''}
        </div>
        <button class="accessory-remove" onclick="removeAccessory(${idx})" title="Remove">✕</button>
      </div>
      <div class="accessory-sets">${setsHtml}</div>
      <button class="add-set-btn" onclick="addAccessorySet(${idx})">+ ADD SET</button>
    </div>`;
  }).join('');

  renderSuggestions();
}

// ── Accessory actions ─────────────────────────────────────────
window.addSuggestedAccessory = function(name, type, category) {
  // Pre-populate with last session's data nudged slightly
  const lastEntry = lastAccessories.find(a => a.exercise_name === name);
  let sets = [{ reps: '', weight: '', assistance: '' }];
  if (lastEntry && lastEntry.sets_json && lastEntry.sets_json.length > 0) {
    sets = lastEntry.sets_json.map(s => ({ ...s }));
  }
  accessoryItems.push({ name, type: type || 'standard', category: category || 'Other', sets });
  renderAccessories();
};

window.addAccessoryFromPicker = function(name, type, category) {
  accessoryItems.push({ name, type, category, sets: [{ reps: '', weight: '', assistance: '' }] });
  renderAccessories();
  closeExercisePicker();
}

window.removeAccessory = function(idx) {
  accessoryItems.splice(idx, 1);
  saveDraftSession();
  renderAccessories();
};

window.addAccessorySet = function(idx) {
  accessoryItems[idx].sets.push({ reps: '', weight: '', assistance: '' });
  saveDraftSession();
  renderAccessories();
};

window.removeAccessorySet = function(idx, si) {
  accessoryItems[idx].sets.splice(si, 1);
  if (accessoryItems[idx].sets.length === 0) {
    accessoryItems[idx].sets.push({ reps: '', weight: '', assistance: '' });
  }
  saveDraftSession();
  renderAccessories();
};

window.updateAccessorySet = function(idx, si, field, value) {
  accessoryItems[idx].sets[si][field] = value === '' ? '' : parseFloat(value) || 0;
  saveDraftSession(); // lightweight localStorage write, fine on keystroke
};

// ── Exercise picker ───────────────────────────────────────────
window.openExercisePicker = function() {
  pickerCategory = 'All';
  document.getElementById('picker-search').value = '';
  renderPickerCategories();
  renderPickerList();
  document.getElementById('exercise-picker-modal').classList.add('open');
};

window.closeExercisePicker = function() {
  document.getElementById('exercise-picker-modal').classList.remove('open');
};

window.renderPickerCategories = function() {
  const el = document.getElementById('picker-categories');
  el.innerHTML = ACCESSORY_CATEGORIES.map(c =>
    `<button class="cat-btn ${c === pickerCategory ? 'active' : ''}" onclick="setPickerCategory('${c}')">${c}</button>`
  ).join('');
}

window.setPickerCategory = function(cat) {
  pickerCategory = cat;
  renderPickerCategories();
  renderPickerList();
};

window.filterPicker = function() { renderPickerList(); };

window.renderPickerList = function() {
  const search = document.getElementById('picker-search').value.toLowerCase();
  const all = [
    ...BUILTIN_EXERCISES,
    ...customExercises.map(e => ({ name: e.name, category: e.category, type: e.exercise_type, custom: true, id: e.id }))
  ];

  const filtered = all.filter(e => {
    const matchCat = pickerCategory === 'All' || e.category === pickerCategory;
    const matchSearch = !search || e.name.toLowerCase().includes(search);
    const notAdded = !accessoryItems.some(a => a.name === e.name);
    return matchCat && matchSearch && notAdded;
  });

  // Group by category
  const grouped = {};
  filtered.forEach(e => {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e);
  });

  const el = document.getElementById('picker-list');
  if (filtered.length === 0) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:14px;">No exercises found</div>';
    return;
  }

  el.innerHTML = Object.entries(grouped).map(([cat, exercises]) => `
    <div class="picker-category-label">${cat}</div>
    ${exercises.map(e => `
      <div class="picker-exercise" onclick="addAccessoryFromPicker('${e.name.replace(/'/g,"\'")}','${e.type}','${e.category}')">
        <span class="picker-ex-name">${e.name}${e.custom ? ' <span style="color:var(--muted2);font-size:11px;">(custom)</span>' : ''}</span>
        <span class="picker-ex-type type-${e.type}">${e.type === 'standard' ? '' : e.type === 'assisted' ? 'ASSISTED' : 'WEIGHTED'}</span>
      </div>
    `).join('')}
  `).join('');
}

// ── Custom exercise modal ─────────────────────────────────────
window.openAddCustomExercise = function() {
  document.getElementById('exercise-picker-modal').classList.remove('open');
  document.getElementById('custom-ex-name').value = '';
  document.getElementById('custom-exercise-modal').classList.add('open');
};

window.closeCustomExercise = function() {
  document.getElementById('custom-exercise-modal').classList.remove('open');
  document.getElementById('exercise-picker-modal').classList.add('open');
};

window.saveCustomExercise = async function() {
  const name = document.getElementById('custom-ex-name').value.trim();
  const category = document.getElementById('custom-ex-category').value;
  const exercise_type = document.getElementById('custom-ex-type').value;
  if (!name) { toast('Enter an exercise name', 'error'); return; }

  try {
    const { addCustomExercise } = await import('./db.js');
    const newEx = await addCustomExercise(user.id, { name, category, exercise_type });
    customExercises.push(newEx);
    closeCustomExercise();
    toast(`${name} added`, 'success');
    renderPickerList();
  } catch(e) {
    toast('Failed to save exercise', 'error');
  }
};

// ── Builds the per-lift increment rows for the settings panel
window.buildIncrementRows = function() {
  const settings = getGlobalSettings();
  const allLifts = [...WORKOUT_A, ...WORKOUT_B].filter((l, i, a) => a.findIndex(x => x.id === l.id) === i);
  return allLifts.map(l => {
    const eff = effectiveIncrement(l.increment, settings.minIncrement);
    const capped = eff > l.increment
      ? ' <span style="color:var(--muted2);font-size:11px;">(natural ' + l.increment + ' lb)</span>'
      : '';
    return '<div class="settings-row">'
      + '<div><div class="settings-label">' + l.name + ' increment</div></div>'
      + '<span style="font-family:var(--font-d);font-weight:700;color:var(--accent);">+' + eff + ' lb' + capped + '</span>'
      + '</div>';
  }).join('');
}

window.renderSettings = function() {
  const container = document.getElementById('settings-container');

  const weightsHtml = Object.entries(LIFT_NAMES).map(([id, name]) => {
    const s = liftStates[id] || {};
    return `
      <div class="settings-row settings-row-lift">
        <div>
          <div class="settings-label">${name}</div>
          <div class="text-muted" style="font-size:12px;">${s.failures||0} failures · ${s.deloads||0} deloads</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="text-align:right;">
            <div style="font-family:var(--font-d);font-weight:700;color:var(--accent);">${s.weight||45} lb</div>
            <div style="font-size:11px;color:var(--muted);">bar: ${s.bar_weight||45} lb</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="editLift('${id}','${name}')">EDIT</button>
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
        <div>
          <div class="settings-label">Minimum weight increment</div>
          <div class="text-muted" style="font-size:12px;">Floor for all weight increases</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-family:var(--font-d);font-weight:700;color:var(--accent);">${getGlobalSettings().minIncrement} lb</span>
          <button class="btn btn-ghost btn-sm" onclick="editMinIncrement()">EDIT</button>
        </div>
      </div>
      ${buildIncrementRows()}
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

window.editLift = async function(liftId, liftName) {
  // Working weight
  const currentWeight = liftStates[liftId]?.weight ?? 45;
  const newWeightRaw = prompt(`Working weight for ${liftName} (lb):`, currentWeight);
  if (newWeightRaw === null) return; // cancelled
  const newWeight = parseFloat(newWeightRaw);
  if (isNaN(newWeight) || newWeight <= 0) { toast('Invalid weight', 'error'); return; }

  // Bar weight
  const currentBar = liftStates[liftId]?.bar_weight ?? 45;
  const newBarRaw = prompt(`Bar weight for ${liftName} (lb):\n(Standard = 45, Women's = 35, Technique bar = 15)`, currentBar);
  if (newBarRaw === null) return; // cancelled
  const newBar = parseFloat(newBarRaw);
  if (isNaN(newBar) || newBar <= 0) { toast('Invalid bar weight', 'error'); return; }
  if (newBar > newWeight) { toast('Bar weight cannot exceed working weight', 'error'); return; }

  const roundedWeight = Math.round(newWeight * 10) / 10;
  const roundedBar    = Math.round(newBar * 10) / 10;

  await upsertLiftState(user.id, liftId, { weight: roundedWeight, bar_weight: roundedBar, failures: 0 });
  liftStates[liftId] = { ...liftStates[liftId], weight: roundedWeight, bar_weight: roundedBar, failures: 0 };
  toast(`${liftName} updated`, 'success');
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

window.editMinIncrement = function() {
  const current = getGlobalSettings().minIncrement;
  const val = parseFloat(prompt(
    'Minimum weight increment (lb):\n\nWeights will round up to this when increasing.\nCommon values: 2.5 (fractional plates), 5 (standard), 10 (limited plates)',
    current
  ));
  if (isNaN(val) || val <= 0) return;
  const settings = getGlobalSettings();
  settings.minIncrement = val;
  saveGlobalSettings(settings);
  toast(`Minimum increment set to ${val} lb`, 'success');
  renderSettings();
};

window.handleSignOut = async function() {
  if (!confirm('Sign out?')) return;
  await signOut();
};

// ── Movement Day ─────────────────────────────────────────────

const SUPABASE_FUNCTIONS_URL = 'https://aqbrhcdaarpcymhgshuh.supabase.co/functions/v1';

// ── Movement Day State ────────────────────────────────────────
let movementDayWorkout = null;  // current AI-generated workout
let movementLockedExercises = {}; // { index: exerciseObj } — locked in place on reroll
let lastMovementPrompt = '';    // for "show prompt" feature
let includeMetcon = true;       // whether to include a MetCon finisher

// Parse the max reps from a range string like "10-12" → 12, or "10" → 10
function parseMaxReps(repsStr) {
  const parts = String(repsStr).split('-').map(Number);
  return Math.max(...parts.filter(n => !isNaN(n))) || 10;
}

// Cycle: null → maxReps → maxReps-1 → ... → 0 → null
function cycleMovementRep(current, maxReps) {
  if (current === null) return maxReps;
  if (current === 0)    return null;
  return current - 1;
}

// Build the prompt, used both for generation and "show prompt"
function buildMovementPrompt(weights, recentSummary, minIncrement, lockedExercises, daysSinceLast, includeMetcon) {
  const lockedNames = lockedExercises.map(e => e.name);
  const lockedCategories = lockedExercises.map(e => e.category);

  // Full required categories: Push, Pull, Hinge, Core
  const needed = ['Push', 'Pull', 'Hinge', 'Core'].filter(c => !lockedCategories.includes(c));
  const remainingCount = Math.max(needed.length, 4 - lockedExercises.length);

  const lockedSection = lockedNames.length > 0
    ? 'LOCKED (do NOT duplicate or replace): ' + lockedNames.map((n,i) => n + ' [' + lockedExercises[i].category + ']').join(', ') + '.'
    : '';

  const neededSection = needed.length > 0
    ? 'New exercises MUST cover these categories (one each, no more): ' + needed.join(', ') + '.'
    : 'All required categories covered by locked exercises. Pick complementary movements.';

  let daysNote = 'No previous session data.';
  if (daysSinceLast != null) {
    if (daysSinceLast === 0) {
      daysNote = 'They trained earlier today.';
    } else {
      const d = Math.round(daysSinceLast);
      daysNote = `Their last session was ${d} day${d !== 1 ? 's' : ''} ago — the weights above are from that session.`;
    }
  }

  const metconSection = includeMetcon ? `
Also generate ONE MetCon/cardio finisher. This is a short conditioning piece (5-12 minutes) appropriate for someone who has access to dumbbells, kettlebells, and a pull-up bar. Use AMRAP, rounds for time, or EMOM format. If they cannot do the movement, suggest a substitution. Add it as the last exercise in the array with category "MetCon" and use the prescription field for the time/format description instead of sets/reps.` : '';

  return `You are a strength and conditioning coach designing a movement day workout for an athlete who trains 2 days per week with barbell strength work and does cycling, running, and swimming on other days.

The athlete is having a low-energy day. Current working weights:
- Squat: ${weights.squat}lb
- Bench Press: ${weights.bench}lb
- Barbell Row: ${weights.row}lb
- Overhead Press: ${weights.press}lb
- Deadlift: ${weights.deadlift}lb

${daysNote}
Recent sessions: ${recentSummary || 'No recent data'}.
Minimum weight increment: ${minIncrement}lb.
${lockedSection}
${neededSection}
${metconSection}

Generate exactly ${remainingCount} NEW exercise${remainingCount !== 1 ? 's' : ''} (not counting any MetCon). STRICT RULES:
1. NEVER repeat any exercise name from the locked list or from your own new exercises
2. Cover each needed category exactly once — no doubling up on any category
3. Loads at 40-60% of working weights, or light dumbbell/kettlebell alternatives
4. Rep scheme as a range like "10-12" — movement quality over load today
5. One coaching note per exercise

Respond ONLY with valid JSON, no preamble, no markdown fences:
{
  "title": "Movement Day",
  "tagline": "short motivational line",
  "exercises": [
    {
      "name": "Exercise Name",
      "category": "Push|Pull|Hinge|Core|MetCon",
      "sets": 3,
      "reps": "10-12",
      "weight": 95,
      "bodyweight": false,
      "note": "one-line coaching cue",
      "metconPrescription": null
    }
  ]
}

For MetCon: set category to "MetCon", sets to 1, reps to the time/format (e.g. "10 min AMRAP"), weight to 0, bodyweight to true, and metconPrescription to the full description of the workout.
For all other exercises: set metconPrescription to null.
If bodyweight set bodyweight to true and weight to 0. Round all weights to nearest ${minIncrement}lb.`;
}
// Core fetch function — fetches only the non-locked exercises
async function fetchMovementWorkout(lockedExercises) {
  const settings = getGlobalSettings();
  const { getSessions } = await import('./db.js');
  const recent = await getSessions(user.id, 3);
  const recentSummary = recent.map(s =>
    s.workout_day + ': ' + s.session_lifts.map(l => l.lift_name + ' ' + l.weight + 'lb ' + l.sets_passed + '/5').join(', ')
  ).join(' | ');

  // Calculate days since last session for prompt context
  let daysSinceLast = null;
  if (recent.length > 0) {
    const lastDate = new Date(recent[0].completed_at);
    daysSinceLast = (Date.now() - lastDate) / (1000 * 60 * 60 * 24);
  }

  const weights = {
    squat:    liftStates.squat?.weight    ?? 45,
    bench:    liftStates.bench?.weight    ?? 45,
    row:      liftStates.row?.weight      ?? 45,
    press:    liftStates.press?.weight    ?? 45,
    deadlift: liftStates.deadlift?.weight ?? 45,
  };

  lastMovementPrompt = buildMovementPrompt(weights, recentSummary, settings.minIncrement, lockedExercises, daysSinceLast, includeMetcon);

  const { data: { session: authSession } } = await supabase.auth.getSession();
  const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-movement-workout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authSession.access_token}`,
    },
    body: JSON.stringify({
      prompt: lastMovementPrompt,
      weights,
      recentSessions: recentSummary,
      minIncrement: settings.minIncrement,
      lockedExercises: lockedExercises.map(e => e.name),
    }),
  });

  if (!resp.ok) throw new Error('Function returned ' + resp.status);
  const workout = await resp.json();
  if (workout.error) throw new Error(workout.error);
  return workout;
}

// Render the movement modal body with exercises, lock buttons, reroll, prompt
function renderMovementModal(workout, locked) {
  document.getElementById('movement-modal-title').textContent = workout.title || 'MOVEMENT DAY';
  document.getElementById('movement-tagline').textContent = workout.tagline || '';

  const allExercises = workout.exercises;

  const exercisesHtml = allExercises.map((ex, i) => {
    const isLocked = !!locked[i];
    const prescription = ex.bodyweight
      ? `${ex.sets} sets × ${ex.reps} reps`
      : `${ex.sets} sets × ${ex.reps} reps @ ${ex.weight} lb`;

    return `<div class="movement-exercise" id="movement-ex-${i}">
      <div class="movement-ex-header">
        <div style="display:flex;align-items:center;gap:8px;flex:1;">
          <span class="movement-ex-name">${ex.name}</span>
          <span class="movement-ex-cat cat-${ex.category}">${ex.category}</span>
        </div>
        <button class="movement-lock-btn ${isLocked ? 'locked' : ''}"
                onclick="toggleMovementLock(${i})"
                title="${isLocked ? 'Unlock' : 'Lock this exercise'}">
          ${isLocked ? '🔒' : '🔓'}
        </button>
      </div>
      <div class="movement-ex-prescription">${prescription}</div>
      <div class="movement-ex-note">${ex.note}</div>
    </div>`;
  }).join('');

  const promptHtml = `
    <div class="movement-prompt-section">
      <button class="movement-prompt-toggle" onclick="toggleMovementPrompt()">
        Show prompt ▾
      </button>
      <div class="movement-prompt-body" id="movement-prompt-body" style="display:none;">
        <pre class="movement-prompt-text">${lastMovementPrompt.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
      </div>
    </div>`;

  document.getElementById('movement-modal-body').innerHTML = exercisesHtml + promptHtml;
  document.getElementById('movement-do-it-btn').style.display = 'block';
  document.getElementById('movement-reroll-btn').style.display = 'block';
  // Show MetCon toggle
  const metconRow = document.getElementById('movement-metcon-row');
  if (metconRow) {
    metconRow.style.display = 'block';
    const toggle = document.getElementById('metcon-toggle');
    if (toggle) toggle.checked = includeMetcon;
  }
}

window.openMovementDay = async function() {
  movementDayWorkout = null;
  movementLockedExercises = {};
  lastMovementPrompt = '';
  includeMetcon = true;
  document.getElementById('movement-modal-title').textContent = 'MOVEMENT DAY';
  document.getElementById('movement-tagline').textContent = '';
  document.getElementById('movement-do-it-btn').style.display = 'none';
  document.getElementById('movement-reroll-btn').style.display = 'none';
  document.getElementById('movement-modal-body').innerHTML = `
    <div class="movement-loading">
      <span class="spinner" style="width:28px;height:28px;border-width:3px;color:var(--accent);"></span>
      <p>Generating your workout…</p>
    </div>`;
  document.getElementById('movement-modal').classList.add('open');

  try {
    const workout = await fetchMovementWorkout([]);
    movementDayWorkout = workout;
    renderMovementModal(workout, movementLockedExercises);
  } catch(e) {
    console.error('Movement day error:', e);
    document.getElementById('movement-modal-body').innerHTML = `
      <div class="movement-loading">
        <p style="color:var(--danger);">Failed to generate workout. Check your connection and try again.</p>
        <p style="font-size:12px;color:var(--muted2);">${e.message}</p>
      </div>`;
  }
};

window.toggleMovementLock = function(idx) {
  if (movementLockedExercises[idx]) {
    delete movementLockedExercises[idx];
  } else {
    movementLockedExercises[idx] = movementDayWorkout.exercises[idx];
  }
  // Update just the lock button without re-fetching
  const btn = document.querySelector(`#movement-ex-${idx} .movement-lock-btn`);
  if (btn) {
    const isNowLocked = !!movementLockedExercises[idx];
    btn.textContent = isNowLocked ? '🔒' : '🔓';
    btn.classList.toggle('locked', isNowLocked);
  }
};

window.rerollMovementDay = async function() {
  const lockedList = Object.values(movementLockedExercises);
  document.getElementById('movement-reroll-btn').disabled = true;
  document.getElementById('movement-reroll-btn').innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>';

  try {
    const newWorkout = await fetchMovementWorkout(lockedList);

    // Build final exercise list: locked exercises in their original positions,
    // new exercises filling the remaining slots in order
    const lockedIndices = Object.keys(movementLockedExercises).map(Number).sort();
    const newExercises = [...newWorkout.exercises]; // only the newly generated ones
    const finalExercises = [];
    let newIdx = 0;

    // Reconstruct: for each slot, use locked if available, otherwise take next new exercise
    const totalSlots = lockedList.length + newExercises.length;
    for (let i = 0; i < totalSlots; i++) {
      if (movementLockedExercises[i]) {
        finalExercises.push(movementLockedExercises[i]);
      } else {
        if (newIdx < newExercises.length) {
          finalExercises.push(newExercises[newIdx++]);
        }
      }
    }

    const merged = { ...newWorkout, exercises: finalExercises };
    movementDayWorkout = merged;

    // Lock map stays the same — indices don't change
    renderMovementModal(merged, movementLockedExercises);
  } catch(e) {
    toast('Reroll failed — try again', 'error');
  } finally {
    const btn = document.getElementById('movement-reroll-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'REROLL'; }
  }
};

window.toggleMovementPrompt = function() {
  const body = document.getElementById('movement-prompt-body');
  const btn = document.querySelector('.movement-prompt-toggle');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.textContent = isHidden ? 'Hide prompt ▴' : 'Show prompt ▾';
};

window.toggleMetcon = async function() {
  const toggle = document.getElementById('metcon-toggle');
  includeMetcon = toggle ? toggle.checked : true;
  // Reroll to include/exclude MetCon
  await rerollMovementDay();
};

window.closeMovementDay = function() {
  document.getElementById('movement-modal').classList.remove('open');
};

window.doMovementDay = function() {
  if (!movementDayWorkout) return;
  closeMovementDay();

  currentSession = {
    day: profile.next_workout,
    isMovementDay: true,
    liftResults: movementDayWorkout.exercises.map(ex => {
      const isMetcon = ex.category === 'MetCon';
      const maxReps = isMetcon ? 1 : parseMaxReps(ex.reps);
      return {
        liftId: 'movement_' + ex.name.toLowerCase().replace(/\s+/g, '_'),
        name: ex.name,
        increment: 0,
        weight: ex.weight || 0,
        barWeight: 0,
        // MetCon: single true/null toggle; others: rep count
        sets: isMetcon ? [null] : Array(ex.sets).fill(null),
        warmups: [],
        locked: false,
        movementDay: true,
        prescription: isMetcon ? ex.reps : ex.reps,
        metconPrescription: ex.metconPrescription || null,
        maxReps,
        category: ex.category,
      };
    })
  };

  accessoryItems = [];
  saveDraftSession();
  renderMovementWorkout();
  toast('Movement day loaded — time to move!', 'success');
};

window.renderMovementWorkout = function() {
  document.getElementById('workout-day').textContent = 'MOVEMENT DAY';

  const container = document.getElementById('lifts-container');
  container.innerHTML = currentSession.liftResults.map((lr, idx) => {
    const catClass = 'cat-' + lr.category;

    // MetCon exercises render differently — just a done/not-done toggle
    if (lr.category === 'MetCon') {
      const isDone = lr.sets[0] === true;
      return `<div class="lift-card card ${isDone ? 'lift-done' : ''}" style="border-color:var(--danger);opacity:${isDone?'0.8':'1'};">
        <div class="lift-header">
          <div>
            <div class="lift-name">
              ${lr.name}
              <span class="movement-ex-cat ${catClass}" style="margin-left:8px;font-size:11px;">METCON</span>
            </div>
            <div class="lift-warn deload-note" style="color:var(--muted);font-style:normal;">${lr.metconPrescription || lr.prescription}</div>
          </div>
          <div class="lift-weight-block">
            <div class="lift-prescription">${lr.prescription}</div>
          </div>
        </div>
        <div class="sets-row">
          <button class="set-btn ${isDone ? 'done' : ''}" style="width:auto;padding:0 16px;"
            onclick="toggleMetconDone(${idx})">${isDone ? '✓ DONE' : 'MARK DONE'}</button>
        </div>
      </div>`;
    }

    // Regular movement exercises
    const recordedSets = lr.sets.filter(s => s !== null);
    const allDone = recordedSets.length === lr.sets.length && recordedSets.every(v => v !== null);

    const setButtons = lr.sets.map((s, si) => {
      let cls = 'set-btn';
      let label = String(si + 1);
      if (s === null) { cls = 'set-btn'; label = String(si + 1); }
      else if (s === 0) { cls = 'set-btn fail'; label = '0'; }
      else if (s === lr.maxReps) { cls = 'set-btn done'; label = String(s); }
      else { cls = 'set-btn partial'; label = String(s); }
      return `<button class="${cls}" onclick="cycleMovementSet(${idx},${si})">${label}</button>`;
    }).join('');

    const totalReps = recordedSets.reduce((a, v) => a + (v || 0), 0);
    const summaryLabel = recordedSets.length === 0 ? 'tap to record' : `${totalReps} reps done`;

    return `<div class="lift-card card ${allDone ? 'lift-done' : ''}">
      <div class="lift-header">
        <div>
          <div class="lift-name">
            ${lr.name}
            <span class="movement-ex-cat ${catClass}" style="margin-left:8px;font-size:11px;">${lr.category}</span>
          </div>
          ${lr.weight === 0 ? '<div class="lift-warn deload-note">Bodyweight</div>' : ''}
        </div>
        <div class="lift-weight-block" ${lr.weight > 0 ? `onclick="editMovementWeight(${idx})" style="cursor:pointer;" title="Tap to edit weight"` : ''}>
          ${lr.weight > 0 ? `<div class="lift-weight">${lr.weight}<span>lb</span></div>` : ''}
          <div class="lift-prescription">${lr.sets.length} × ${lr.prescription} ${lr.weight > 0 ? '<span style="font-size:10px;color:var(--muted2);">✎</span>' : ''}</div>
        </div>
      </div>
      <div class="sets-row">
        ${setButtons}
        <span class="sets-count">${summaryLabel}</span>
      </div>
    </div>`;
  }).join('');
};

window.toggleMetconDone = function(liftIdx) {
  const lr = currentSession.liftResults[liftIdx];
  lr.sets[0] = lr.sets[0] === true ? null : true;
  saveDraftSession();
  renderMovementWorkout();
};

window.cycleMovementSet = function(liftIdx, setIdx) {
  const lr = currentSession.liftResults[liftIdx];
  lr.sets[setIdx] = cycleMovementRep(lr.sets[setIdx], lr.maxReps);
  saveDraftSession();
  renderMovementWorkout();
  const anyDone = currentSession.liftResults.some(lr => lr.sets.some(s => s !== null));
  document.getElementById('finish-btn').disabled = !anyDone;
};

window.editMovementWeight = function(liftIdx) {
  const lr = currentSession.liftResults[liftIdx];
  const settings = getGlobalSettings();
  const val = parseFloat(prompt('Weight for ' + lr.name + ' (lb):', lr.weight));
  if (isNaN(val) || val < 0) return;
  lr.weight = roundToIncrement(val, settings.minIncrement);
  saveDraftSession();
  renderMovementWorkout();
  toast(lr.name + ' updated to ' + lr.weight + ' lb', 'success');
};

// ── Boot ──────────────────────────────────────────────────────
init();
