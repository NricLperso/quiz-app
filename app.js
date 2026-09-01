'use strict';

/* ============================================================
   Quiz — Solo & Duel local (pass-and-play)
   State machine: home → config → (pass) → question → reveal → results
   ============================================================ */

const POINTS = { binary: 1, square: 2, cash: 4 };
const MODE_LABEL = { binary: 'Duel', square: 'Carré', cash: 'Cash' };
const COUNTS = [5, 10, 15, 20];
const TIMER_SECONDS = 30;

const BANK = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];

/* ---------- Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')                       // ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function stars(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

/* ---------- Mode Cash : matching tolérant + indice de format ---------- */
const CASH_STOPWORDS = new Set(['le','la','les','l','un','une','des','du','de','d','a','au','aux','the','of','et','ou','en','dans','sur']);

// Tokens significatifs (hors articles/prépositions) d'une réponse normalisée.
function significantTokens(str) {
  return normalize(str).split(' ').filter((t) => t && !CASH_STOPWORDS.has(t));
}

// La réponse cash est-elle acceptée ? Tolère nom de famille / mot-clé principal.
function cashMatches(given, answer, acceptedAnswers) {
  const g = normalize(given);
  if (!g) return false;

  // 1) correspondances exactes (réponse, alias, réponse sans article)
  const exact = new Set([answer, ...(acceptedAnswers || [])].map(normalize));
  const noArticle = normalize(answer).replace(/^(le|la|les|l|un|une|des|du|de|d) /, '');
  exact.add(noArticle);
  if (exact.has(g)) return true;

  // 2) forme compacte (réponse sans articles/prépositions internes) : "bataille de waterloo" -> "bataille waterloo"
  const sig = significantTokens(answer);
  if (sig.length && g === sig.join(' ')) return true;

  // 3) dernier mot significatif = nom de famille / mot-clé (ex. "Albert Einstein" -> "einstein")
  const last = sig[sig.length - 1];
  if (last && last.length >= 3 && g === last) return true;

  // 4) premier mot significatif si la réponse est un nom composé de 2 mots (ex. "Marie Curie" -> "marie")
  if (sig.length === 2 && sig[0].length >= 3 && g === sig[0]) return true;

  return false;
}

// Indice de format affiché en mode cash, sans révéler les lettres.
function cashHint(answer) {
  const raw = String(answer).trim();
  if (/^[0-9\s.,]+$/.test(raw)) return 'Réponse attendue : un nombre.';
  const words = raw.split(/\s+/).filter(Boolean);
  const counts = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length).filter((n) => n > 0);
  const lettres = counts.join(' · ');
  const nb = words.length;
  const base = `Format : ${nb} mot${nb > 1 ? 's' : ''} (${lettres} lettre${counts.length > 1 || counts[0] > 1 ? 's' : ''}).`;
  return nb > 1 ? base + ' Le nom de famille ou mot-clé suffit.' : base;
}

/* ---------- State ---------- */
const state = {
  source: 'local',            // 'local' | 'live'
  gameMode: 'solo',           // 'solo' | 'duel'
  themes: [],                 // selected themes
  difficulty: 'all',          // 'all' | 1 | 2 | 3
  count: 10,
  players: [],                // [{name, score, byMode, streak, maxStreak}]
  questions: [],
  qIndex: 0,
  turn: 0,                    // which player answers current question
  roundAnswers: [],           // per-player results for current question
  timerId: null,
};

/* ---------- Base "en direct" (QuizzAPI v2) ---------- */
const API_BASE = 'https://quizzapi.fr/api/v2/quiz';
const API_CATS = {
  'Musique':'musique', 'Culture générale':'culture_generale', 'Arts & Littérature':'art_litterature',
  'Cinéma & Séries':'tv_cinema', 'Actu & Politique':'actu_politique', 'Sport':'sport',
  'Jeux vidéo':'jeux_videos', 'Histoire':'histoire', 'Géographie':'geographie',
  'Sciences':'science', 'Gastronomie':'gastronomie'
};
const API_DIFF = { 1:'facile', 2:'normal', 3:'difficile' };

// Renvoie les questions "live" au schéma app, ou null si échec/insuffisant.
async function fetchLiveQuestions(themes, difficulty, count) {
  const diffs = difficulty === 'all' ? ['facile','normal','difficile'] : [API_DIFF[difficulty]];
  const jobs = [];
  themes.forEach((theme) => {
    const cat = API_CATS[theme];
    if (!cat) return;
    diffs.forEach((d) => {
      jobs.push(fetch(`${API_BASE}?limit=200&category=${cat}&difficulty=${d}`, { headers: { Accept: 'application/json' } })
        .then((r) => r.ok ? r.json() : { quizzes: [] })
        .then((j) => (j.quizzes || []).map((q) => mapLive(q)))
        .catch(() => []));
    });
  });
  const chunks = await Promise.all(jobs);
  const seen = new Set();
  const pool = [];
  chunks.flat().forEach((q) => {
    if (!q) return;
    const k = normalize(q.question);
    if (seen.has(k)) return;
    seen.add(k);
    pool.push(q);
  });
  if (pool.length < count) return null; // pas assez → on laissera le fallback local
  return shuffle(pool).slice(0, count);
}

function mapLive(q) {
  if (!q || !q.question || !q.answer || !Array.isArray(q.badAnswers)) return null;
  const answer = String(q.answer).trim();
  const bad = [...new Set(q.badAnswers.map((b) => String(b).trim()).filter(Boolean))]
    .filter((b) => normalize(b) !== normalize(answer));
  if (bad.length < 3) return null;
  const theme = Object.keys(API_CATS).find((t) => API_CATS[t] === q.category) || 'Culture générale';
  const difficulty = ({ facile:1, normal:2, difficile:3 })[q.difficulty] || 2;
  const accepted = [answer];
  const da = answer.replace(/^\s*(l['’])\s*/i, '').replace(/^\s*(le|la|les|un|une|des|du|de|d['’])\s+/i, '').trim();
  if (da && normalize(da) !== normalize(answer)) accepted.push(da);
  return { id: q.id, theme, difficulty, question: String(q.question).trim(),
    choices: [answer, bad[0], bad[1], bad[2]], acceptedAnswers: accepted, explanation: '' };
}

/* ---------- Navigation ---------- */
function show(screenId) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $('#screen-' + screenId).classList.add('active');
  window.scrollTo(0, 0);
}

/* ---------- Pool computation ---------- */
function availableThemes() {
  return [...new Set(BANK.map((q) => q.theme))];
}
function poolFor(themes, difficulty) {
  return BANK.filter((q) =>
    themes.includes(q.theme) &&
    (difficulty === 'all' || q.difficulty === difficulty)
  );
}
function availableDifficulties(themes) {
  const set = new Set(BANK.filter((q) => themes.includes(q.theme)).map((q) => q.difficulty));
  return [...set].sort();
}

/* ============================================================
   HOME
   ============================================================ */
$$('.mode-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.gameMode = btn.dataset.mode;
    openConfig();
  });
});
$$('[data-nav="home"]').forEach((b) => b.addEventListener('click', () => show('home')));

/* ============================================================
   CONFIG
   ============================================================ */
function openConfig() {
  $('#config-title').textContent = state.gameMode === 'duel' ? 'Duel — configuration' : 'Solo — configuration';
  $('#pseudos-block').classList.toggle('hidden', state.gameMode !== 'duel');

  // themes: all selected by default
  state.themes = availableThemes();
  state.difficulty = 'all';

  renderSource();
  renderThemes();
  renderDifficulties();
  renderCounts();
  validateConfig();
  show('config');
}

function renderSource() {
  const list = $('#source-list');
  const hint = $('#source-hint');
  list.innerHTML = '';
  const opts = [
    { v: 'local', label: '📦 Banque locale', desc: `${BANK.length} questions, fonctionne hors-ligne.` },
    { v: 'live', label: '🌐 En direct', desc: 'Questions tirées de la base QuizzAPI (connexion requise).' },
  ];
  opts.forEach((o) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.source === o.v ? ' selected' : '');
    chip.textContent = o.label;
    chip.addEventListener('click', () => {
      state.source = o.v;
      renderSource();
    });
    list.appendChild(chip);
  });
  hint.textContent = opts.find((o) => o.v === state.source).desc;
}

function renderThemes() {
  const list = $('#theme-list');
  list.innerHTML = '';
  availableThemes().forEach((theme) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.themes.includes(theme) ? ' selected' : '');
    chip.textContent = theme;
    chip.addEventListener('click', () => {
      if (state.themes.includes(theme)) {
        if (state.themes.length > 1) state.themes = state.themes.filter((t) => t !== theme);
      } else {
        state.themes.push(theme);
      }
      // difficulty may become unavailable
      if (state.difficulty !== 'all' && !availableDifficulties(state.themes).includes(state.difficulty)) {
        state.difficulty = 'all';
      }
      renderThemes(); renderDifficulties(); renderCounts(); validateConfig();
    });
    list.appendChild(chip);
  });
}

function renderDifficulties() {
  const list = $('#difficulty-list');
  list.innerHTML = '';
  const avail = availableDifficulties(state.themes);
  const opts = [{ v: 'all', label: 'Toutes' }, ...avail.map((d) => ({ v: d, label: stars(d) }))];
  opts.forEach((o) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.difficulty === o.v ? ' selected' : '');
    chip.textContent = o.label;
    chip.addEventListener('click', () => {
      state.difficulty = o.v;
      renderDifficulties(); renderCounts(); validateConfig();
    });
    list.appendChild(chip);
  });
}

function renderCounts() {
  const list = $('#count-list');
  list.innerHTML = '';
  const poolSize = poolFor(state.themes, state.difficulty).length;
  // if current count unavailable, pick largest available
  const available = COUNTS.filter((c) => c <= poolSize);
  if (!available.includes(state.count)) state.count = available.length ? available[available.length - 1] : null;
  COUNTS.forEach((c) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.count === c ? ' selected' : '');
    chip.textContent = c;
    chip.disabled = c > poolSize;
    chip.addEventListener('click', () => {
      if (chip.disabled) return;
      state.count = c;
      renderCounts(); validateConfig();
    });
    list.appendChild(chip);
  });
}

function validateConfig() {
  const poolSize = poolFor(state.themes, state.difficulty).length;
  const hint = $('#config-hint');
  const startBtn = $('#start-btn');
  let ok = true; let msg = '';

  if (poolSize === 0) { ok = false; msg = 'Aucune question pour cette sélection.'; }
  else if (!state.count) { ok = false; msg = 'Pas assez de questions disponibles.'; }
  else { msg = `${poolSize} question(s) disponible(s).`; }

  hint.style.color = ok ? 'var(--muted)' : 'var(--warn)';
  hint.textContent = msg;
  startBtn.disabled = !ok;
}

$('#start-btn').addEventListener('click', () => {
  if (state.gameMode === 'duel') {
    const n1 = $('#p1-name').value.trim() || 'Joueur 1';
    const n2 = $('#p2-name').value.trim() || 'Joueur 2';
    if (normalize(n1) === normalize(n2)) {
      const h = $('#config-hint');
      h.style.color = 'var(--warn)';
      h.textContent = 'Les deux pseudos doivent être différents.';
      return;
    }
    state.players = [mkPlayer(n1), mkPlayer(n2)];
  } else {
    state.players = [mkPlayer('Toi')];
  }
  startGame();
});

function mkPlayer(name) {
  return { name, score: 0, byMode: { binary: 0, square: 0, cash: 0 }, streak: 0, maxStreak: 0 };
}

/* ============================================================
   GAME START
   ============================================================ */
async function startGame() {
  const startBtn = $('#start-btn');
  const hint = $('#config-hint');
  let questions = null;

  if (state.source === 'live') {
    startBtn.disabled = true;
    startBtn.textContent = 'Chargement des questions…';
    try {
      questions = await fetchLiveQuestions(state.themes, state.difficulty, state.count);
    } catch (_) { questions = null; }
    if (!questions) {
      hint.style.color = 'var(--warn)';
      hint.textContent = 'Base en direct indisponible → banque locale utilisée.';
    }
    startBtn.disabled = false;
    startBtn.textContent = 'Commencer';
  }

  if (!questions) {
    const pool = poolFor(state.themes, state.difficulty);
    questions = shuffle(pool).slice(0, state.count);
  }

  state.questions = questions;
  state.qIndex = 0;
  beginQuestion();
}

function beginQuestion() {
  state.turn = 0;
  state.roundAnswers = [];
  nextTurn();
}

function nextTurn() {
  if (state.turn >= state.players.length) { showReveal(); return; }
  if (state.gameMode === 'duel') showPass();
  else renderQuestion();
}

/* ---------- Passation ---------- */
function showPass() {
  const p = state.players[state.turn];
  $('#pass-title').textContent = `Au tour de ${p.name}`;
  $('#pass-sub').textContent = `Passe l'appareil à ${p.name}. Personne ne doit voir la réponse de l'autre.`;
  show('pass');
}
$('#ready-btn').addEventListener('click', renderQuestion);

/* ============================================================
   QUESTION
   ============================================================ */
function renderQuestion() {
  const q = state.questions[state.qIndex];
  const p = state.players[state.turn];

  $('#q-player').textContent = state.gameMode === 'duel' ? p.name : '';
  $('#q-index').textContent = `Question ${state.qIndex + 1}/${state.questions.length}`;
  $('#q-theme').textContent = q.theme;
  $('#q-diff').textContent = stars(q.difficulty);
  $('#q-text').textContent = q.question;

  const streakBadge = $('#streak-badge');
  streakBadge.textContent = p.streak >= 2 ? `🔥 Série de ${p.streak} !` : '';

  // reset answer UI
  $('#mode-choice').classList.remove('hidden');
  const zone = $('#answer-zone');
  zone.classList.add('hidden');
  zone.innerHTML = '';
  $$('.risk-btn').forEach((b) => {
    b.disabled = false;
    b.onclick = () => chooseAnswerMode(b.dataset.answermode);
  });

  resetTimer();
  show('question');
  startTimer();
}

function chooseAnswerMode(answerMode) {
  const q = state.questions[state.qIndex];
  $('#mode-choice').classList.add('hidden');
  const zone = $('#answer-zone');
  zone.classList.remove('hidden');
  zone.innerHTML = '';

  if (answerMode === 'cash') {
    const row = document.createElement('div');
    row.className = 'cash-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.placeholder = 'Ta réponse…';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    const btn = document.createElement('button');
    btn.className = 'primary-btn';
    btn.textContent = 'Valider (4 pts)';
    const submit = () => finalizeAnswer(answerMode, input.value);
    btn.onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const hint = document.createElement('p');
    hint.className = 'cash-hint';
    hint.textContent = cashHint(q.choices[0]);
    row.append(input, btn, hint);
    zone.appendChild(row);
    input.focus();
  } else {
    const n = answerMode === 'binary' ? 2 : 4;
    const correct = q.choices[0];
    const wrong = shuffle(q.choices.slice(1)).slice(0, n - 1);
    const options = shuffle([correct, ...wrong]);
    options.forEach((opt) => {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.textContent = opt;
      b.onclick = () => finalizeAnswer(answerMode, opt);
      zone.appendChild(b);
    });
  }
}

/* ---------- Timer ---------- */
function resetTimer() {
  clearInterval(state.timerId);
  const t = $('#timer');
  t.textContent = TIMER_SECONDS;
  t.className = 'timer';
}
function startTimer() {
  let left = TIMER_SECONDS;
  const t = $('#timer');
  state.timerId = setInterval(() => {
    left--;
    t.textContent = left;
    t.classList.toggle('warn', left <= 10 && left > 5);
    t.classList.toggle('danger', left <= 5);
    if (left <= 0) {
      clearInterval(state.timerId);
      finalizeAnswer(null, null, true); // timeout
    }
  }, 1000);
}

/* ---------- Finalize a player's answer ---------- */
function finalizeAnswer(answerMode, given, timedOut = false) {
  clearInterval(state.timerId);
  const q = state.questions[state.qIndex];
  const p = state.players[state.turn];

  let correct = false;
  if (!timedOut && answerMode) {
    if (answerMode === 'cash') {
      correct = cashMatches(given, q.choices[0], q.acceptedAnswers);
    } else {
      correct = normalize(given) === normalize(q.choices[0]);
    }
  }

  const pts = correct ? POINTS[answerMode] : 0;
  if (correct) {
    p.score += pts;
    p.byMode[answerMode] += 1;
    p.streak += 1;
    p.maxStreak = Math.max(p.maxStreak, p.streak);
  } else {
    p.streak = 0;
  }

  state.roundAnswers.push({
    player: p.name,
    answerMode,
    given: timedOut ? null : given,
    correct,
    pts,
    timedOut,
  });

  state.turn++;
  nextTurn();
}

/* ============================================================
   REVEAL (correction)
   ============================================================ */
function showReveal() {
  const q = state.questions[state.qIndex];
  $('#reveal-question').textContent = q.question;
  $('#reveal-correct').textContent = q.choices[0];
  $('#reveal-explanation').textContent = q.explanation || '';

  const box = $('#reveal-players');
  box.innerHTML = '';
  state.roundAnswers.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'reveal-player ' + (a.correct ? 'correct' : 'wrong');
    let detail;
    if (a.timedOut) detail = '⏱️ Temps écoulé';
    else detail = `${MODE_LABEL[a.answerMode]} · ${a.given ? '« ' + a.given + ' »' : '—'}`;
    div.innerHTML = `
      <div class="rp-left">
        <span class="rp-name">${escapeHtml(a.player)}</span>
        <span class="rp-detail">${escapeHtml(detail)}</span>
      </div>
      <span class="rp-pts ${a.correct ? 'correct' : 'wrong'}">${a.correct ? '+' + a.pts : '0'}</span>`;
    box.appendChild(div);
  });

  const isLast = state.qIndex >= state.questions.length - 1;
  $('#next-btn').textContent = isLast ? 'Voir les résultats' : 'Question suivante';
  show('reveal');
}

$('#next-btn').addEventListener('click', () => {
  if (state.qIndex >= state.questions.length - 1) {
    showResults();
  } else {
    state.qIndex++;
    beginQuestion();
  }
});

/* ============================================================
   RESULTS
   ============================================================ */
function showResults() {
  const winnerEl = $('#results-winner');
  const body = $('#results-body');
  body.innerHTML = '';

  let winnerIdx = -1;
  if (state.gameMode === 'duel') {
    const [a, b] = state.players;
    if (a.score > b.score) { winnerEl.textContent = `🏆 ${a.name} gagne !`; winnerIdx = 0; }
    else if (b.score > a.score) { winnerEl.textContent = `🏆 ${b.name} gagne !`; winnerIdx = 1; }
    else winnerEl.textContent = '🤝 Égalité !';
  } else {
    winnerEl.textContent = `Score : ${state.players[0].score} pts`;
  }

  state.players.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'result-card' + (i === winnerIdx ? ' winner' : '');
    card.innerHTML = `
      <div class="rc-head">
        <span class="rc-name">${escapeHtml(p.name)}</span>
        <span class="rc-score">${p.score} pts</span>
      </div>
      <div class="rc-breakdown">
        <span class="rc-pill">Cash ✔ ${p.byMode.cash}</span>
        <span class="rc-pill">Carré ✔ ${p.byMode.square}</span>
        <span class="rc-pill">Duel ✔ ${p.byMode.binary}</span>
        <span class="rc-pill">🔥 max ${p.maxStreak}</span>
      </div>`;
    body.appendChild(card);
  });

  show('results');
}

$('#replay-btn').addEventListener('click', openConfig);

/* ============================================================
   BOOT
   ============================================================ */
(function boot() {
  if (BANK.length === 0) {
    document.body.innerHTML = '<div style="padding:40px;color:#fff;font-family:sans-serif">Banque de questions introuvable ou vide.</div>';
    return;
  }
  show('home');
})();
