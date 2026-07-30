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
let historySessionCache = {}; // sessionId -> full session object, for edit modal
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

// Default Rogue Monster Band colors, light to heavy assistance.
// Editable in Settings — order matters (used for light-to-heavy display).
const DEFAULT_BAND_COLORS = [
  { name: 'Orange', hex: '#f0923b' },
  { name: 'Red',    hex: '#e05252' },
  { name: 'Blue',   hex: '#5297e0' },
  { name: 'Green',  hex: '#52c97a' },
  { name: 'Black',  hex: '#3a3a3a' },
  { name: 'Purple', hex: '#a07cf8' },
  { name: 'Silver', hex: '#b8b8b8' },
];

function getGlobalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { minIncrement: 5, bandColors: DEFAULT_BAND_COLORS, ...JSON.parse(raw) };
  } catch(e) {}
  return { minIncrement: 5, bandColors: DEFAULT_BAND_COLORS };
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
    // Movement day drafts need the movement renderer, not the regular one —
    // regular renderWorkout() assumes 5-rep prescriptions and was showing "3x5"
    // for movement day exercises that actually have their own rep ranges.
    if (currentSession.isMovementDay) {
      renderMovementWorkout();
    } else {
      renderWorkout();
    }
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
        body: `It has been ${Math.round(daysSince)} ${dayWord} since your last session. Your body may need time to readjust — consider a deload: drop all weights to 90% for this session to ease back in and avoid injury. Or tap "MOVE" for a lighter session instead.`,
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
    // Weight is tap-to-edit (for plate-friendly rounding); check toggles done separately.
    const warmupsHtml = lr.warmups.length === 0 ? '' : `
      <div class="warmup-sets">
        <div class="warmup-label">WARM-UP <span class="warmup-optional">— optional, tap weight to adjust</span></div>
        <div class="warmup-rows">${lr.warmups.map((w, wi) =>
          `<div class="warmup-row ${w.done ? 'warmup-done' : ''}">
            <button class="warmup-check-btn" onclick="toggleWarmup(${idx},${wi})"
                    aria-label="Mark ${w.done ? 'not done' : 'done'}">
              <span class="warmup-check">${w.done ? '✓' : ''}</span>
            </button>
            <span class="warmup-weight" onclick="editWarmupWeight(${idx},${wi})" title="Tap to edit">${w.weight}<span class="warmup-unit">lb</span></span>
            <span class="warmup-reps">${w.reps} rep${w.reps !== 1 ? 's' : ''}</span>
          </div>`
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
    } else if (lr.isRampBack) {
      warningLine = `<div class="lift-warn deload-note">Ramp back — aim for ${lr.recommendedSets} sets, up to 5 available</div>`;
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
  const finishBtn = document.getElementById('finish-btn');
  finishBtn.disabled = !(anyWorkDone || timerStarted);
  finishBtn.textContent = 'FINISH WORKOUT'; // always restore label — confirmFinish swaps it for a spinner while saving
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

window.editWarmupWeight = function(liftIdx, warmupIdx) {
  const lr = currentSession.liftResults[liftIdx];
  const w = lr.warmups[warmupIdx];
  const val = parseFloat(prompt('Warmup weight (lb):', w.weight));
  if (isNaN(val) || val < 0) return;
  // No forced rounding here — this is exactly for "130 might as well be 135" convenience
  w.weight = val;
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
        exercises: currentSession.liftResults.map(lr => {
          // For MetCon, bake the structured details into a readable prescription string for storage
          let prescription = lr.prescription;
          if (lr.category === 'MetCon' && lr.metconDetails) {
            const d = lr.metconDetails;
            const moves = (d.movements || []).map(m => m.movement + ' x' + m.reps).join(', ');
            prescription = (d.format || '') + ' ' + (d.duration || '') + ': ' + moves;
          }
          // Bake bodyweight modifier (band assist or added weight) into prescription for storage
          if (lr.modifierType === 'band' && lr.modifierValue) {
            prescription += ' [' + lr.modifierValue + ' band assist]';
          } else if (lr.modifierType === 'weight' && lr.modifierValue) {
            prescription += ' [+' + lr.modifierValue + 'lb added]';
          }
          return {
            name: lr.name,
            category: lr.category,
            weight: lr.weight,
            prescription,
            sets: lr.sets,
          };
        }),
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

      const recordedSets = lr.sets.filter(s => s !== null && s !== 'locked');
      const allFive = recordedSets.length === lr.sets.length && recordedSets.every(v => v === 5);

      let newWeight   = state.weight;
      let newFailures = state.failures;
      let newDeloads  = state.deloads || 0;

      const settings = getGlobalSettings();
      const effIncrement = effectiveIncrement(lr.increment, settings.minIncrement);

      if (lr.isRampBack) {
        // Ramp back sessions are a deliberate reduced-load rebuild, not a
        // normal progression attempt. A full 5x5 still progresses like usual.
        // Meeting (or missing) the recommended reduced target is expected
        // and should never count as a "failure" toward the deload counter —
        // that would punish exactly the safe behavior we asked for.
        const metRecommendedTarget = recordedSets.length >= (lr.recommendedSets || lr.sets.length)
          && recordedSets.slice(0, lr.recommendedSets || lr.sets.length).every(v => v === 5);

        if (allFive) {
          newWeight   = roundToIncrement(state.weight + effIncrement, settings.minIncrement);
          newFailures = 0;
          if (newDeloads > 0) newDeloads--;
        } else if (metRecommendedTarget) {
          // Hit the plan exactly as recommended — hold weight, no penalty.
          // Next RAMP BACK run will see this clean data and can advance further.
          newFailures = 0;
        }
        // else: fell short of even the reduced target — also no penalty,
        // just leave state as-is so RAMP BACK can reassess next time.
      } else if (allFive) {
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
  historySessionCache = {}; // reset cache on each render

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

        historySessionCache[s.id] = s; // stash for edit modal lookup

        list.insertAdjacentHTML('beforeend', `
          <div class="history-item card card-sm">
            <div class="history-meta">
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="history-day">${s.title || 'Movement Day'}</span>
                <span class="badge badge-info" style="font-size:10px;">MOVEMENT</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <button class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px;" onclick="openEditHistory('${s.id}','movement')">EDIT</button>
                <div class="history-date">${new Date(s.completed_at).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}</div>
              </div>
            </div>
            <div class="history-lifts">${exHtml}</div>
            ${s.tagline ? `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:6px;">"${s.tagline}"</div>` : ''}
          </div>
        `);
        return;
      }

      const liftsHtml = s.session_lifts.map(l => {
        // Legacy data: movement day sessions saved before movement_sessions
        // existed got stored here with lift_id like "movement_...". Those use
        // rep ranges (e.g. 12), not the 5-rep pass/fail model, so the normal
        // "X/5" badge is meaningless for them — show total reps instead.
        const isLegacyMovement = (l.lift_id || '').startsWith('movement_');

        const workSets = (l.sets_json || []).filter(s => s !== null && s !== 'locked');
        const workVolume = workSets.reduce((acc, reps) => acc + (reps * l.weight), 0);

        const warmupVolume = (l.warmups_json || [])
          .filter(w => w.done)
          .reduce((acc, w) => acc + (w.reps * w.weight), 0);

        const totalVolume = workVolume + warmupVolume;
        const volumeStr = totalVolume > 0 ? ` · ${Math.round(totalVolume).toLocaleString()}lb` : '';

        if (isLegacyMovement) {
          const totalReps = workSets.reduce((a, v) => a + v, 0);
          return `<span class="h-lift" style="color:var(--info);">${l.lift_name} ${l.weight > 0 ? l.weight+'lb' : 'BW'} ${totalReps}r${volumeStr}</span>`;
        }

        const cls = l.sets_passed === 5 ? 'h-lift pass' : 'h-lift fail';
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
              if (a.exercise_type === 'assisted') return `${s.reps}r${s.bandColor ? ' ('+s.bandColor+' band)' : ''}`;
              return `${s.reps}r${s.weight ? ' @'+s.weight+'lb' : ''}`;
            }).join(', ');
            return `<span class="h-lift" style="color:var(--muted);">${a.exercise_name}: ${summary}</span>`;
          }).filter(Boolean).join('')
        + '</div>';

      historySessionCache[s.id] = s; // stash for edit modal lookup

      list.insertAdjacentHTML('beforeend', `
        <div class="history-item card card-sm">
          <div class="history-meta">
            <span class="history-day">Workout ${s.workout_day}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px;" onclick="openEditHistory('${s.id}','strength')">EDIT</button>
              <div style="text-align:right;">
                <div class="history-date">${dateStr}</div>
                ${sessionVolume > 0 ? `<div style="font-size:11px;color:var(--muted2);">${Math.round(sessionVolume).toLocaleString()} lb total</div>` : ''}
              </div>
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
        const bandColors = getGlobalSettings().bandColors || DEFAULT_BAND_COLORS;
        const bandOptions = bandColors.map(b =>
          `<option value="${b.name}" ${s.bandColor === b.name ? 'selected' : ''}>${b.name}</option>`
        ).join('');
        inputs = `
          <input class="accessory-input" type="number" min="0" placeholder="reps"
            value="${s.reps || ''}" oninput="updateAccessorySet(${idx},${si},'reps',this.value)">
          <span class="accessory-input-label">reps</span>
          <select class="accessory-input" style="border-color:var(--info);width:auto;"
            onchange="updateAccessorySetField(${idx},${si},'bandColor',this.value)">
            <option value="">No band</option>
            ${bandOptions}
          </select>
          <span class="accessory-input-label" style="color:var(--info);">band</span>`;
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
  let sets = [{ reps: '', weight: '', assistance: '', bandColor: '' }];
  if (lastEntry && lastEntry.sets_json && lastEntry.sets_json.length > 0) {
    sets = lastEntry.sets_json.map(s => ({ ...s }));
  }
  accessoryItems.push({ name, type: type || 'standard', category: category || 'Other', sets });
  renderAccessories();
};

window.addAccessoryFromPicker = function(name, type, category) {
  accessoryItems.push({ name, type, category, sets: [{ reps: '', weight: '', assistance: '', bandColor: '' }] });
  renderAccessories();
  closeExercisePicker();
}

window.removeAccessory = function(idx) {
  accessoryItems.splice(idx, 1);
  saveDraftSession();
  renderAccessories();
};

window.addAccessorySet = function(idx) {
  accessoryItems[idx].sets.push({ reps: '', weight: '', assistance: '', bandColor: '' });
  saveDraftSession();
  renderAccessories();
};

window.removeAccessorySet = function(idx, si) {
  accessoryItems[idx].sets.splice(si, 1);
  if (accessoryItems[idx].sets.length === 0) {
    accessoryItems[idx].sets.push({ reps: '', weight: '', assistance: '', bandColor: '' });
  }
  saveDraftSession();
  renderAccessories();
};

window.updateAccessorySet = function(idx, si, field, value) {
  accessoryItems[idx].sets[si][field] = value === '' ? '' : parseFloat(value) || 0;
  saveDraftSession(); // lightweight localStorage write, fine on keystroke
};

// For string fields like bandColor — no numeric parsing
window.updateAccessorySetField = function(idx, si, field, value) {
  accessoryItems[idx].sets[si][field] = value;
  saveDraftSession();
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

// ── Band color settings ────────────────────────────────────────

window.buildBandColorRows = function() {
  const settings = getGlobalSettings();
  const colors = settings.bandColors || DEFAULT_BAND_COLORS;
  return colors.map((b, i) => {
    return '<div class="settings-row">'
      + '<div style="display:flex;align-items:center;gap:10px;">'
      + '<div style="width:20px;height:20px;border-radius:50%;background:' + b.hex + ';border:1px solid var(--border2);"></div>'
      + '<span class="settings-label">' + b.name + '</span>'
      + '</div>'
      + '<div style="display:flex;gap:6px;">'
      + '<button class="btn btn-ghost btn-sm" onclick="editBandColor(' + i + ')">EDIT</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="removeBandColor(' + i + ')">✕</button>'
      + '</div></div>';
  }).join('');
};

window.editBandColor = function(idx) {
  const settings = getGlobalSettings();
  const colors = settings.bandColors || DEFAULT_BAND_COLORS;
  const band = colors[idx];
  const name = prompt('Band name:', band.name);
  if (!name || !name.trim()) return;
  const hex = prompt('Band color (hex, e.g. #e05252):', band.hex);
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) { toast('Invalid hex color', 'error'); return; }
  colors[idx] = { name: name.trim(), hex };
  settings.bandColors = colors;
  saveGlobalSettings(settings);
  renderSettings();
};

window.addBandColor = function() {
  const settings = getGlobalSettings();
  const colors = settings.bandColors || [...DEFAULT_BAND_COLORS];
  const name = prompt('New band name:', 'Custom');
  if (!name || !name.trim()) return;
  const hex = prompt('Band color (hex, e.g. #e05252):', '#888888');
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) { toast('Invalid hex color', 'error'); return; }
  colors.push({ name: name.trim(), hex });
  settings.bandColors = colors;
  saveGlobalSettings(settings);
  renderSettings();
};

window.removeBandColor = function(idx) {
  const settings = getGlobalSettings();
  const colors = settings.bandColors || [...DEFAULT_BAND_COLORS];
  if (colors.length <= 1) { toast('Keep at least one band color', 'error'); return; }
  colors.splice(idx, 1);
  settings.bandColors = colors;
  saveGlobalSettings(settings);
  renderSettings();
};

// ── Edit History ─────────────────────────────────────────────

let editingSessionId = null;
let editingSessionType = null; // 'strength' | 'movement'
let editingDraft = null; // working copy of lifts/exercises being edited

window.openEditHistory = function(sessionId, type) {
  const session = historySessionCache[sessionId];
  if (!session) { toast('Session data not found', 'error'); return; }

  editingSessionId = sessionId;
  editingSessionType = type;

  const items = type === 'movement'
    ? (session.movement_session_exercises || []).slice().sort((a,b) => a.sort_order - b.sort_order)
    : (session.session_lifts || []);

  // Deep copy into working draft
  editingDraft = items.map(item => ({
    id: item.id,
    name: type === 'movement' ? item.name : item.lift_name,
    weight: item.weight,
    sets: [...(item.sets_json || [])],
  }));

  renderEditHistoryBody();
  document.getElementById('edit-history-modal').classList.add('open');
};

function renderEditHistoryBody() {
  const body = document.getElementById('edit-history-body');
  body.innerHTML = editingDraft.map((item, idx) => {
    const setsHtml = item.sets.map((s, si) => {
      const displayVal = (s === null || s === 'locked') ? '' : s;
      return `<div class="edit-set-cell">
        <label>Set ${si+1}</label>
        <input class="accessory-input" type="number" min="0" max="15" style="width:48px;"
          value="${displayVal}" onchange="updateEditSet(${idx},${si},this.value)">
      </div>`;
    }).join('');

    return `<div class="edit-lift-block">
      <div class="edit-lift-name">${item.name}</div>
      <div class="edit-weight-row">
        <label>Weight</label>
        <input class="accessory-input" type="number" min="0" style="width:70px;"
          value="${item.weight}" onchange="updateEditWeight(${idx},this.value)">
        <span style="font-size:12px;color:var(--muted);">lb</span>
      </div>
      <div class="edit-sets-grid">${setsHtml}</div>
    </div>`;
  }).join('');
}

window.updateEditSet = function(itemIdx, setIdx, value) {
  const val = value === '' ? null : Math.max(0, Math.min(15, parseInt(value) || 0));
  editingDraft[itemIdx].sets[setIdx] = val;
};

window.updateEditWeight = function(itemIdx, value) {
  const val = parseFloat(value);
  if (!isNaN(val) && val >= 0) editingDraft[itemIdx].weight = val;
};

window.closeEditHistory = function() {
  document.getElementById('edit-history-modal').classList.remove('open');
  editingSessionId = null;
  editingSessionType = null;
  editingDraft = null;
};

window.saveEditHistory = async function() {
  if (!editingDraft) return;

  try {
    const { updateSessionLift, updateMovementSessionExercise } = await import('./db.js');

    for (const item of editingDraft) {
      const recordedSets = item.sets.filter(s => s !== null && s !== 'locked');
      const setsPassed = recordedSets.filter(s => s === 5).length;

      if (editingSessionType === 'movement') {
        await updateMovementSessionExercise(item.id, {
          weight: item.weight,
          sets_json: item.sets,
        });
      } else {
        await updateSessionLift(item.id, {
          weight: item.weight,
          sets_json: item.sets,
          sets_passed: setsPassed,
        });
      }
    }

    toast('Session updated', 'success');
    closeEditHistory();
    renderHistory(); // refresh the list to show corrected data

  } catch (e) {
    console.error('Edit save error:', e);
    toast(e.message || 'Failed to save changes', 'error');
  }
};

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
      <div class="settings-section-title">Resistance Bands</div>
      <div class="text-muted" style="font-size:12px;margin-bottom:8px;">Used for band-assisted exercises like pull-ups and dips</div>
      ${buildBandColorRows()}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="addBandColor()">+ ADD BAND</button>
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

// Quick-access version directly from the workout screen — same effect as the
// Settings toggle, but one tap away instead of buried in a menu.
window.quickToggleDay = async function() {
  const anyStarted = currentSession && !currentSession.isMovementDay && currentSession.liftResults.some(lr =>
    lr.sets.some(s => s !== null) || (lr.warmups || []).some(w => w.done)
  );
  if (anyStarted) {
    if (!confirm('You have progress on today\'s workout. Switch days anyway? This will discard the current session.')) return;
  }
  if (currentSession && currentSession.isMovementDay) {
    if (!confirm('Switch back to your regular A/B schedule? This will discard the current Movement Day session.')) return;
  }

  clearDraftSession();
  const next = profile.next_workout === 'A' ? 'B' : 'A';
  const { updateProfile } = await import('./db.js');
  await updateProfile(user.id, { next_workout: next });
  profile.next_workout = next;
  initSession();
  toast(`Switched to Workout ${next}`, 'success');
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

// ── Ramp Back ────────────────────────────────────────────────
// Analyzes lift history to find where the athlete's actual sets/reps have
// slipped below a true 5x5 (or the lift's expected set count), then asks
// Claude for a safe glide path back to full working weight.

let lastRampBackPrompt = '';
let rampBackPlan = null;

// For each lift, find the most recent "true full" session (all sets recorded,
// all at 5 reps) and the most recent session regardless of outcome.
async function analyzeRampBackGaps() {
  const { getSessions } = await import('./db.js');
  const sessions = await getSessions(user.id, 100); // enough history to find full sessions

  const lastFullByLift = {};   // lift_id -> { date, weight }
  const mostRecentByLift = {}; // lift_id -> { date, weight, sets (array of reps) }

  // Sessions come back newest-first
  for (const s of sessions) {
    for (const l of (s.session_lifts || [])) {
      if ((l.lift_id || '').startsWith('movement_')) continue; // skip legacy movement data

      if (!mostRecentByLift[l.lift_id]) {
        mostRecentByLift[l.lift_id] = { date: s.completed_at, weight: l.weight, sets: l.sets_json || [] };
      }

      if (!lastFullByLift[l.lift_id]) {
        const recorded = (l.sets_json || []).filter(v => v !== null && v !== 'locked');
        const isFull = recorded.length > 0 && recorded.length === (l.sets_json || []).length && recorded.every(v => v === 5);
        if (isFull) {
          lastFullByLift[l.lift_id] = { date: s.completed_at, weight: l.weight };
        }
      }
    }
  }

  // Build gap list: lifts with a REAL problem — recent failed reps, no
  // confirmed full 5x5 on record, or a genuine layoff since the last one.
  // NOTE: we deliberately do NOT flag "current weight > last full weight" —
  // that's true after every single normal successful session (progression
  // always adds an increment), so it's not a signal of anything wrong and
  // was previously pulling every recently-clean lift into this list.
  const gaps = [];
  for (const liftId of Object.keys(LIFT_NAMES)) {
    const current = liftStates[liftId];
    if (!current) continue;

    const lastFull = lastFullByLift[liftId];
    const mostRecent = mostRecentByLift[liftId];

    if (!mostRecent) continue; // never lifted this — nothing to ramp back from

    const recentHadFailure = (mostRecent.sets || []).some(v => v !== null && v !== 'locked' && v < 5);
    const daysSinceFull = lastFull ? (Date.now() - new Date(lastFull.date)) / (1000*60*60*24) : null;
    const neverConfirmed = !lastFull;
    const longLayoff = daysSinceFull !== null && daysSinceFull >= 10;

    if (recentHadFailure || longLayoff || neverConfirmed) {
      gaps.push({
        liftId,
        name: LIFT_NAMES[liftId],
        currentWeight: current.weight,
        lastFull,
        mostRecent,
      });
    }
  }

  return gaps;
}

function buildRampBackPrompt(gaps, minIncrement) {
  const now = Date.now();

  const lifts = gaps.map(g => {
    const daysSinceFull = g.lastFull
      ? Math.round((now - new Date(g.lastFull.date)) / (1000*60*60*24))
      : null;
    const daysSinceRecent = Math.round((now - new Date(g.mostRecent.date)) / (1000*60*60*24));

    // Explicit layoff tier — don't make the model do date arithmetic, hand it the answer
    let layoffTier = 'minimal (under a week)';
    if (daysSinceFull !== null) {
      if (daysSinceFull >= 30) layoffTier = 'MAJOR — a month or more since a true full 5x5, treat as a real layoff';
      else if (daysSinceFull >= 14) layoffTier = 'MODERATE — two to four weeks since a true full 5x5';
      else if (daysSinceFull >= 7) layoffTier = 'MILD — about a week since a true full 5x5';
    }

    const lastFullStr = g.lastFull
      ? `Last confirmed full 5x5: ${g.lastFull.weight}lb, ${daysSinceFull} days ago. LAYOFF SEVERITY: ${layoffTier}.`
      : 'No confirmed full 5x5 on record — treat conservatively, no proven baseline.';

    const recentSets = (g.mostRecent.sets || []).filter(v => v !== null && v !== 'locked');
    const recentStr = recentSets.length > 0
      ? `Most recent session (${daysSinceRecent} days ago): ${g.mostRecent.weight}lb, reps per set: [${recentSets.join(', ')}]`
      : `Most recent session (${daysSinceRecent} days ago): ${g.mostRecent.weight}lb, no completed sets recorded`;

    return `${g.name}:\n  Current stored target weight: ${g.currentWeight}lb (do NOT treat this as proven — it may be stale from before a layoff)\n  ${lastFullStr}\n  ${recentStr}`;
  }).join('\n\n');

  return `You are a strength coach helping an athlete safely rebuild back to a standard 5 sets x 5 reps barbell program after a layoff or a rough patch. The goal is STRENGTH — get them back to full 5x5 as efficiently as is SAFE.

Critical: the "current stored target weight" for each lift is just whatever was last saved in the app — it is NOT evidence they can lift it today. It may be stale from before a long layoff. Base your recommendation on the LAYOFF SEVERITY and actual recent performance, never on the stored target alone.

For each lift below, recommend today's session: a weight and a number of sets (1-5, always 5 reps per set — reps stay fixed at 5, only sets and weight are adjusted). Use this exact liftId string for each lift in your response — do not invent your own: squat="squat", bench press="bench", barbell row="row", overhead press="press", deadlift="deadlift".

${lifts}

Rules — follow layoff severity strictly:
1. MAJOR layoff (30+ days since a true full 5x5): recommend roughly 70-85% of the last confirmed full-5x5 weight, and 2-3 sets. Do not recommend the full previous weight even if the "current stored target" says so.
2. MODERATE layoff (14-29 days): roughly 85-95% of last confirmed weight, 3-4 sets.
3. MILD layoff (7-13 days): close to full weight, 4-5 sets.
4. Minimal layoff / recent full pass: use the CURRENT STORED TARGET WEIGHT as-is, full 5 sets. If they just cleanly passed a full 5x5, the stored target has ALREADY been advanced by normal progression to the correct next weight — do not revert to the old pre-progression number, that would undo real progress.
5. If their most recent actual session already shows failed reps at a given weight, weight this more heavily than the layoff tier — don't recommend a weight they just failed.
6. One sentence of reasoning per lift that references the actual days-since-full number.

Respond ONLY with valid JSON, no preamble, no markdown fences:
{
  "recommendations": [
    {
      "liftId": "squat",
      "name": "Squat",
      "weight": 185,
      "sets": 4,
      "note": "one-sentence reasoning referencing the actual layoff length"
    }
  ]
}`;
}

window.openRampBack = async function() {
  document.getElementById('rampback-modal-body').innerHTML = `
    <div class="movement-loading">
      <span class="spinner" style="width:28px;height:28px;border-width:3px;color:var(--accent);"></span>
      <p>Analyzing your training history…</p>
    </div>`;
  document.getElementById('rampback-do-it-btn').style.display = 'none';
  document.getElementById('rampback-modal').classList.add('open');

  try {
    const gaps = await analyzeRampBackGaps();

    if (gaps.length === 0) {
      document.getElementById('rampback-modal-body').innerHTML = `
        <div class="movement-loading">
          <p style="color:var(--success);font-size:32px;">✓</p>
          <p>You're right on track — no ramp back needed. Your working weights match your recent performance.</p>
        </div>`;
      return;
    }

    const settings = getGlobalSettings();
    lastRampBackPrompt = buildRampBackPrompt(gaps, settings.minIncrement);

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-rampback-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSession.access_token}`,
      },
      body: JSON.stringify({ prompt: lastRampBackPrompt, minIncrement: settings.minIncrement }),
    });

    if (!resp.ok) throw new Error('Function returned ' + resp.status);
    const plan = await resp.json();
    if (plan.error) throw new Error(plan.error);

    // Never trust Claude's own liftId string — it's asked to echo one back,
    // but it can guess wrong (e.g. "benchpress" or "barbell_row" instead of
    // our actual internal ids "bench"/"row"), which made Apply silently
    // no-op for any lift where the id didn't match. Re-derive it ourselves
    // from the exercise name instead, which we control completely.
    if (plan.recommendations) {
      plan.recommendations.forEach(r => {
        const match = Object.entries(LIFT_NAMES).find(
          ([id, name]) => name.toLowerCase() === (r.name || '').toLowerCase()
        );
        if (match) r.liftId = match[0];
      });
    }

    rampBackPlan = plan;
    renderRampBackModal(plan);

  } catch (e) {
    console.error('Ramp back error:', e);
    document.getElementById('rampback-modal-body').innerHTML = `
      <div class="movement-loading">
        <p style="color:var(--danger);">Failed to generate a plan. Check your connection and try again.</p>
        <p style="font-size:12px;color:var(--muted2);">${e.message}</p>
      </div>`;
  }
};

function renderRampBackModal(plan) {
  const rows = plan.recommendations.map((r, i) => {
    return `<div class="movement-exercise" id="rampback-rec-${i}">
      <div class="movement-ex-header">
        <span class="movement-ex-name">${r.name}</span>
      </div>
      <div class="movement-ex-prescription">
        <span onclick="editRampBackWeight(${i})" style="cursor:pointer;border-bottom:1px dashed var(--muted2);">${r.weight} lb</span>
        &nbsp;×&nbsp;
        <span onclick="editRampBackSets(${i})" style="cursor:pointer;border-bottom:1px dashed var(--muted2);">${r.sets} sets</span>
        &nbsp;×&nbsp;5 reps
      </div>
      <div class="movement-ex-note">${r.note}</div>
    </div>`;
  }).join('');

  const promptHtml = `
    <div class="movement-prompt-section">
      <button class="movement-prompt-toggle" onclick="toggleRampBackPrompt()">Show prompt ▾</button>
      <div class="movement-prompt-body" id="rampback-prompt-body" style="display:none;">
        <pre class="movement-prompt-text">${lastRampBackPrompt.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
      </div>
    </div>`;

  document.getElementById('rampback-modal-body').innerHTML = rows + promptHtml;
  document.getElementById('rampback-do-it-btn').style.display = 'block';
}

window.editRampBackWeight = function(idx) {
  const r = rampBackPlan.recommendations[idx];
  const val = parseFloat(prompt('Weight for ' + r.name + ' (lb):', r.weight));
  if (isNaN(val) || val <= 0) return;
  r.weight = val;
  renderRampBackModal(rampBackPlan);
};

window.editRampBackSets = function(idx) {
  const r = rampBackPlan.recommendations[idx];
  const val = parseInt(prompt('Sets for ' + r.name + ' (1-5):', r.sets));
  if (isNaN(val) || val < 1 || val > 5) return;
  r.sets = val;
  renderRampBackModal(rampBackPlan);
};

window.toggleRampBackPrompt = function() {
  const body = document.getElementById('rampback-prompt-body');
  const btn = document.querySelector('.movement-prompt-toggle');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.textContent = isHidden ? 'Hide prompt ▴' : 'Show prompt ▾';
};

window.closeRampBack = function() {
  document.getElementById('rampback-modal').classList.remove('open');
};

window.applyRampBack = async function() {
  if (!rampBackPlan) return;
  closeRampBack();

  const settings = getGlobalSettings();
  const updates = [];

  for (const r of rampBackPlan.recommendations) {
    const roundedWeight = roundToIncrement(r.weight, settings.minIncrement);

    // Persist the recommended weight for EVERY lift in the plan, not just the
    // ones in today's A/B workout — otherwise the other day's lifts never
    // benefit from the ramp back until you happen to run it again on that day.
    updates.push(upsertLiftState(user.id, r.liftId, { weight: roundedWeight, failures: 0 }));
    liftStates[r.liftId] = { ...liftStates[r.liftId], weight: roundedWeight, failures: 0 };

    // Only lifts actually in today's session get the live session override
    const idx = currentSession.liftResults.findIndex(lr => lr.liftId === r.liftId);
    if (idx === -1) continue;

    const lr = currentSession.liftResults[idx];
    lr.weight = roundedWeight;
    // Always give 5 tappable sets — the recommendation is a target, not a
    // hard cap, so you can push further on a day you're feeling strong.
    lr.sets = Array(5).fill(null);
    lr.recommendedSets = r.sets;
    lr.isRampBack = true;
    lr.warmups = generateWarmups(roundedWeight, lr.barWeight).map(w => ({ ...w, done: false }));
    lr.failures = 0;
  }

  await Promise.all(updates);
  saveDraftSession();
  renderWorkout();
  toast('Ramp back plan applied', 'success');
};

// ── Movement Day ─────────────────────────────────────────────

const SUPABASE_FUNCTIONS_URL = 'https://aqbrhcdaarpcymhgshuh.supabase.co/functions/v1';

// ── Movement Day State ────────────────────────────────────────
let movementDayWorkout = null;  // current AI-generated workout
let movementLockedExercises = {}; // { index: exerciseObj } — locked in place on reroll
let lastMovementPrompt = '';    // for "show prompt" feature
let includeMetcon = true;       // whether to include a MetCon finisher
let rerolledExerciseNames = new Set(); // exercises generated this session — never reappear on reroll

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
function buildMovementPrompt(weights, recentSummary, minIncrement, lockedExercises, daysSinceLast, includeMetcon, recentMovementExercises = [], rerolledNames = new Set()) {
  const lockedNames = lockedExercises.map(e => e.name);
  const lockedCategories = lockedExercises.map(e => e.category);

  const needed = ['Push', 'Pull', 'Hinge', 'Core'].filter(c => !lockedCategories.includes(c));
  const remainingCount = Math.max(needed.length, 4 - lockedExercises.length);

  const lockedSection = lockedNames.length > 0
    ? `KEPT FROM BEFORE (already chosen, do not generate a replacement for these — just use them as context for the rest of the workout): ${lockedNames.map((n,i) => n + ' [' + lockedExercises[i].category + ']').join(', ')}.`
    : '';

  const neededSection = needed.length > 0
    ? `You only need to generate NEW exercises for these remaining categories (one each): ${needed.join(', ')}.`
    : 'All categories are already covered by the kept exercises — generate complementary movements only if the count requires it.';

  // Exclusion list: previously suggested and rejected/rerolled exercises, plus recent history
  const lockedNameSet = new Set(lockedExercises.map(e => e.name.toLowerCase()));
  const alreadyRejected = [...rerolledNames].filter(name => !lockedNameSet.has(name.toLowerCase()));
  const recentlyUsed = recentMovementExercises.filter(name => !lockedNameSet.has(name.toLowerCase()));
  const allExcluded = [...new Set([...alreadyRejected, ...recentlyUsed])];

  const exclusionSection = allExcluded.length > 0
    ? `PREVIOUSLY REJECTED — the person already saw and passed on these exercises, or did them in a recent session. NEVER suggest any of these again: ${allExcluded.join(', ')}.`
    : '';

  const seed = Math.floor(Math.random() * 10000);

  let daysNote = 'No previous session data.';
  if (daysSinceLast != null) {
    if (daysSinceLast === 0) {
      daysNote = 'They already trained earlier today.';
    } else {
      const d = Math.round(daysSinceLast);
      daysNote = `Their last strength session was ${d} day${d !== 1 ? 's' : ''} ago — the weights above are from that session.`;
    }
  }

  const metconSection = includeMetcon ? `
Also generate ONE MetCon/cardio finisher (5-12 minutes) using dumbbells, kettlebells, or bodyweight — assume access to a pull-up bar. Use AMRAP, rounds-for-time, or EMOM format. Structure it as a list of individual movements with their own rep/time counts (see metconDetails schema below), not a paragraph of prose — this needs to be skimmable mid-workout.` : '';

  return `You are a strength and conditioning coach. The athlete normally trains heavy barbell strength work 2 days per week (squat, bench, row, overhead press, deadlift) and does cycling, running, and swimming on other days.

Today they have chosen a MOVEMENT-FOCUSED session instead of their usual heavy strength work — higher reps, lighter loads, moving well rather than grinding. This is a deliberate training choice, not a fallback for feeling bad. Reps should sit in the 10-12 range, occasionally up to 15 for smaller accessory movements.

Their current strength working weights (for reference, to scale down from):
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
${exclusionSection}
${metconSection}

[Variety seed: ${seed} — use this to pick genuinely different movements than you might default to]

Generate exactly ${remainingCount} NEW exercise${remainingCount !== 1 ? 's' : ''} (not counting any MetCon). STRICT RULES:
1. Do NOT generate exercises for categories already covered by the kept list
2. NEVER use any exercise name listed under "PREVIOUSLY REJECTED" above, under any circumstances
3. Cover each remaining needed category exactly once
4. Loads at 40-60% of working weights, or light dumbbell/kettlebell alternatives
5. Rep scheme as a range like "10-12" (or up to "12-15" for smaller movements)
6. One coaching note per exercise

Respond ONLY with valid JSON, no preamble, no markdown fences:
{
  "title": "Movement Day",
  "tagline": "short motivational line about moving well, not about low energy",
  "exercises": [
    {
      "name": "Exercise Name",
      "category": "Push|Pull|Hinge|Core|MetCon",
      "sets": 3,
      "reps": "10-12",
      "weight": 95,
      "bodyweight": false,
      "note": "one-line coaching cue",
      "metconDetails": null
    }
  ]
}

${exclusionSection ? 'Reminder — do NOT use any of these: ' + allExcluded.join(', ') + '.' : ''}

For the MetCon exercise (if requested): set category to "MetCon", name to a short title, sets to 1, reps to the overall duration (e.g. "10 min AMRAP"), weight to 0, bodyweight to true, and metconDetails to:
{
  "format": "AMRAP" | "RFT" | "EMOM",
  "duration": "10 min",
  "movements": [
    { "movement": "Kettlebell Swings", "reps": "15" },
    { "movement": "Push-ups", "reps": "10" }
  ]
}
For all non-MetCon exercises, set metconDetails to null.
If bodyweight, set bodyweight to true and weight to 0. Round all weights to nearest ${minIncrement}lb.`;
}
// Core fetch function — fetches only the non-locked exercises
async function fetchMovementWorkout(lockedExercises) {
  const settings = getGlobalSettings();
  const { getSessions, getMovementSessions } = await import('./db.js');
  const [recent, recentMovement] = await Promise.all([
    getSessions(user.id, 3),
    getMovementSessions(user.id, 5),
  ]);
  const recentSummary = recent.map(s =>
    s.workout_day + ': ' + s.session_lifts.map(l => l.lift_name + ' ' + l.weight + 'lb ' + l.sets_passed + '/5').join(', ')
  ).join(' | ');

  // Collect recently used movement day exercise names so Claude avoids repeating them
  const recentMovementExercises = recentMovement
    .flatMap(s => (s.movement_session_exercises || []).map(e => e.name))
    .filter((name, i, arr) => arr.indexOf(name) === i) // unique
    .slice(0, 12); // last ~12 unique exercises used

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

  lastMovementPrompt = buildMovementPrompt(weights, recentSummary, settings.minIncrement, lockedExercises, daysSinceLast, includeMetcon, recentMovementExercises, rerolledExerciseNames);

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
    const isMetcon = ex.category === 'MetCon';

    if (isMetcon && ex.metconDetails) {
      const d = ex.metconDetails;
      const movementRows = (d.movements || []).map(m =>
        `<div class="metcon-move-row"><span class="metcon-move-name">${m.movement}</span><span class="metcon-move-reps">${m.reps}</span></div>`
      ).join('');
      return `<div class="movement-exercise" id="movement-ex-${i}">
        <div class="movement-ex-header">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span class="movement-ex-name">${ex.name}</span>
            <span class="movement-ex-cat cat-MetCon">METCON</span>
          </div>
          <button class="movement-lock-btn ${isLocked ? 'locked' : ''}"
                  onclick="toggleMovementLock(${i})"
                  title="${isLocked ? 'Unlock' : 'Lock this exercise'}">
            ${isLocked ? '🔒' : '🔓'}
          </button>
        </div>
        <div class="movement-ex-prescription">${d.format || ''} · ${d.duration || ex.reps}</div>
        <div class="metcon-move-list">${movementRows}</div>
      </div>`;
    }

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
  rerolledExerciseNames = new Set(); // fresh pool for new modal session
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
    // Track all generated exercises so reroll never repeats them
    workout.exercises.forEach(ex => rerolledExerciseNames.add(ex.name.toLowerCase()));
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
    // Safety net: remove any exercises Claude generated that duplicate locked
    // names OR anything already shown this session (rerolledExerciseNames)
    const lockedNameSet = new Set(lockedList.map(e => e.name.toLowerCase()));
    const newExercises = newWorkout.exercises.filter(ex => {
      const lc = ex.name.toLowerCase();
      return !lockedNameSet.has(lc) && !rerolledExerciseNames.has(lc);
    });
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

    // Add newly generated (non-locked) exercises to the exclusion set
    newExercises.forEach(ex => rerolledExerciseNames.add(ex.name.toLowerCase()));

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
        metconDetails: ex.metconDetails || null,
        modifierType: null,
        modifierValue: null,
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

    // MetCon exercises render as a structured movement list — done/not-done toggle
    if (lr.category === 'MetCon') {
      const isDone = lr.sets[0] === true;
      const d = lr.metconDetails;
      const movementRows = d && d.movements
        ? d.movements.map(m => `<div class="metcon-move-row"><span class="metcon-move-name">${m.movement}</span><span class="metcon-move-reps">${m.reps}</span></div>`).join('')
        : '';
      return `<div class="lift-card card ${isDone ? 'lift-done' : ''}" style="border-color:var(--danger);opacity:${isDone?'0.8':'1'};">
        <div class="lift-header">
          <div>
            <div class="lift-name">
              ${lr.name}
              <span class="movement-ex-cat ${catClass}" style="margin-left:8px;font-size:11px;">METCON</span>
            </div>
          </div>
          <div class="lift-weight-block">
            <div class="lift-prescription">${d ? d.format + ' · ' + d.duration : lr.prescription}</div>
          </div>
        </div>
        <div class="metcon-move-list">${movementRows}</div>
        <div class="sets-row" style="margin-top:10px;">
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

    // Bodyweight exercises can optionally get a band-assist or added-weight modifier
    let modifierBadge = '';
    if (lr.weight === 0) {
      if (lr.modifierType === 'band' && lr.modifierValue) {
        modifierBadge = `<div class="lift-warn deload-note" style="color:var(--info);">${lr.modifierValue} band assist</div>`;
      } else if (lr.modifierType === 'weight' && lr.modifierValue) {
        modifierBadge = `<div class="lift-warn deload-note" style="color:var(--accent-dim);">+${lr.modifierValue} lb added</div>`;
      } else {
        modifierBadge = '<div class="lift-warn deload-note">Bodyweight</div>';
      }
    }

    return `<div class="lift-card card ${allDone ? 'lift-done' : ''}">
      <div class="lift-header">
        <div>
          <div class="lift-name">
            ${lr.name}
            <span class="movement-ex-cat ${catClass}" style="margin-left:8px;font-size:11px;">${lr.category}</span>
          </div>
          ${modifierBadge}
        </div>
        <div class="lift-weight-block" onclick="${lr.weight > 0 ? `editMovementWeight(${idx})` : `editMovementModifier(${idx})`}" style="cursor:pointer;" title="Tap to edit">
          ${lr.weight > 0 ? `<div class="lift-weight">${lr.weight}<span>lb</span></div>` : ''}
          <div class="lift-prescription">${lr.sets.length} × ${lr.prescription} <span style="font-size:10px;color:var(--muted2);">✎</span></div>
        </div>
      </div>
      <div class="sets-row">
        ${setButtons}
        <span class="sets-count">${summaryLabel}</span>
      </div>
    </div>`;
  }).join('');

  // Restore the finish button label and enable state — confirmFinish swaps
  // the label for a spinner while saving, so every render pass must restore it
  const anyDone = currentSession.liftResults.some(lr => lr.sets.some(s => s !== null));
  const finishBtn = document.getElementById('finish-btn');
  finishBtn.disabled = !anyDone;
  finishBtn.textContent = 'FINISH WORKOUT';
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
  renderMovementWorkout(); // handles finish button state/label itself now
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

// For bodyweight exercises (weight === 0) — offer band assist or added weight
window.editMovementModifier = function(liftIdx) {
  const lr = currentSession.liftResults[liftIdx];
  const settings = getGlobalSettings();
  const bandColors = settings.bandColors || DEFAULT_BAND_COLORS;

  const bandNames = bandColors.map(b => b.name).join(', ');
  const choice = prompt(
    lr.name + ' — add a modifier?\n\n' +
    'Type a band color for assistance (' + bandNames + '),\n' +
    'or a number for added weight in lb,\n' +
    'or leave blank to clear.',
    lr.modifierType === 'band' ? lr.modifierValue : (lr.modifierType === 'weight' ? lr.modifierValue : '')
  );

  if (choice === null) return; // cancelled

  const trimmed = choice.trim();
  if (trimmed === '') {
    lr.modifierType = null;
    lr.modifierValue = null;
  } else if (!isNaN(parseFloat(trimmed))) {
    lr.modifierType = 'weight';
    lr.modifierValue = roundToIncrement(parseFloat(trimmed), settings.minIncrement);
  } else {
    const match = bandColors.find(b => b.name.toLowerCase() === trimmed.toLowerCase());
    if (!match) { toast('Unknown band color — try: ' + bandNames, 'error'); return; }
    lr.modifierType = 'band';
    lr.modifierValue = match.name;
  }

  saveDraftSession();
  renderMovementWorkout();
  toast(lr.name + ' updated', 'success');
};

// ── Boot ──────────────────────────────────────────────────────
init();
