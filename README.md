# 🎯 Quiz — Solo & Duel

Application web (PWA) de quiz en français : joue en **solo** ou en **duel local** (deux joueurs sur le même téléphone, à tour de rôle), avec un système de **prise de risque** sur les réponses.

**▶️ Jouer / installer : https://nriclperso.github.io/quiz-app/**

## Fonctionnalités

- **Deux modes de jeu** : Solo, ou Duel local *pass-and-play* (chacun répond à son tour sans voir la réponse de l'autre).
- **Modes de réponse à risque** pour chaque question :
  | Mode | Propositions | Points |
  |------|--------------|--------|
  | Duel | 2 choix | 1 pt |
  | Carré | 4 choix | 2 pts |
  | Cash | saisie libre | 4 pts |
  Aucune pénalité en cas d'erreur.
- **Chrono 15 s** par question et par joueur.
- **Compteur de série** (streak) incitatif.
- **Config** : thème(s), difficulté (★ à ★★★), nombre de questions (5/10/15/20).
- **Deux sources de questions** :
  - 📦 **Banque locale** (~850 questions, fonctionne **hors-ligne**).
  - 🌐 **En direct** : questions tirées de [QuizzAPI](https://quizzapi.fr) à chaque partie.
- **PWA installable** sur iPhone/Android (« Ajouter à l'écran d'accueil »), plein écran, offline.

## Installer sur iPhone

1. Ouvre **https://nriclperso.github.io/quiz-app/** dans **Safari**.
2. Bouton **Partager** → **Sur l'écran d'accueil**.
3. L'icône 🎯 apparaît : l'app s'ouvre en plein écran comme une vraie application.

## Technique

- HTML / CSS / JavaScript **vanilla**, zéro dépendance, zéro build.
- Machine à états : accueil → config → (passation) → question → correction → résultats.
- Service worker (`sw.js`) pour le mode hors-ligne.

## Régénérer la banque de questions

La banque locale est moissonnée depuis QuizzAPI (libre de droits) :

```bash
node _harvest.js   # collecte l'API → raw.json
node _build.js     # nettoie + génère questions.js
```

## Crédits

Questions : [QuizzAPI v2](https://quizzapi.fr) par Jonathan Moreschi (libre).

## Licence

MIT — voir [LICENSE](LICENSE).
