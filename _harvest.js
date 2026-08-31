// Harvester: collecte tous les quiz de QuizzAPI v2, dédoublonne, sauvegarde raw.json
const fs = require('fs');
const cats = ['musique','culture_generale','art_litterature','tv_cinema','actu_politique','sport','jeux_videos','histoire','geographie','science','gastronomie'];
const diffs = ['facile','normal','difficile'];
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

(async () => {
  const byId = new Map();
  for (const c of cats) {
    for (const d of diffs) {
      try {
        const url = `https://quizzapi.fr/api/v2/quiz?limit=500&category=${c}&difficulty=${d}`;
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        const j = await r.json();
        const qs = j.quizzes || [];
        qs.forEach(q => byId.set(q.id, q));
        console.log(`${c}/${d}: ${qs.length}`);
        await sleep(150);
      } catch (e) {
        console.log(`${c}/${d}: ERR ${e.message}`);
      }
    }
  }
  const all = [...byId.values()];
  fs.writeFileSync('raw.json', JSON.stringify(all));
  console.log('TOTAL UNIQUE:', all.length);
})();
