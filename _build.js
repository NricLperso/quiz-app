// Builder: raw.json -> questions.js (schéma app)
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('raw.json','utf8'));

const THEME = {
  musique:'Musique', culture_generale:'Culture générale', art_litterature:'Arts & Littérature',
  tv_cinema:'Cinéma & Séries', actu_politique:'Actu & Politique', sport:'Sport',
  jeux_videos:'Jeux vidéo', histoire:'Histoire', geographie:'Géographie',
  science:'Sciences', gastronomie:'Gastronomie'
};
const DIFF = { facile:1, normal:2, difficile:3 };

const normalize = (s)=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/['’`]/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const deArticle = (s)=>String(s).replace(/^\s*(l['’])\s*/i,'').replace(/^\s*(le|la|les|un|une|des|du|de|d['’])\s+/i,'').trim();

const seen = new Set();
const out = [];
for (const q of raw) {
  if (!q.question || !q.answer || !Array.isArray(q.badAnswers)) continue;
  const question = String(q.question).trim();
  const answer = String(q.answer).trim();
  if (!question || !answer) continue;
  // mauvaises réponses uniques, distinctes de la bonne
  const bad = [...new Set(q.badAnswers.map(b=>String(b).trim()).filter(Boolean))]
    .filter(b => normalize(b) !== normalize(answer));
  if (bad.length < 3) continue;            // garantit 4 options en mode Carré
  const key = normalize(question);
  if (seen.has(key)) continue;              // dédoublonnage
  seen.add(key);
  const theme = THEME[q.category] || 'Culture générale';
  const difficulty = DIFF[q.difficulty] || 2;
  const accepted = [answer];
  const da = deArticle(answer);
  if (da && normalize(da) !== normalize(answer)) accepted.push(da);
  out.push({
    id: q.id,
    theme,
    difficulty,
    question,
    choices: [answer, bad[0], bad[1], bad[2]],
    acceptedAnswers: accepted,
    explanation: q.anecdote ? String(q.anecdote).trim() : ''
  });
}

// stats
const stats = {};
out.forEach(x=>{ stats[x.theme]=stats[x.theme]||{1:0,2:0,3:0,t:0}; stats[x.theme][x.difficulty]++; stats[x.theme].t++; });
console.log('KEPT:', out.length, '/', raw.length);
for (const t in stats) console.log('  '+t.padEnd(20), 't='+stats[t].t, '★'+stats[t][1], '★★'+stats[t][2], '★★★'+stats[t][3]);

const header = `// Banque de questions FR — source: QuizzAPI v2 (quizzapi.fr, libre), moissonnée le ${new Date().toISOString().slice(0,10)}.
// Schéma extensible : { id, theme, difficulty (1-3), question, choices[0]=bonne réponse, acceptedAnswers[] (mode cash), explanation }
// Régénérable via _harvest.js puis _build.js.
window.QUESTIONS = `;
fs.writeFileSync('questions.js', header + JSON.stringify(out, null, 0) + ';\n', 'utf8');
console.log('questions.js écrit.');
