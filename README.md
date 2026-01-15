## 20_insightv2 – Architecture de base

Plateforme modulaire pour « discuter avec les données » (chatbot, dashboard, actions).

- Frontend: React (Vite). Tout ce qui est visuel vit ici.
- Backend: Python (FastAPI), packagé avec `uv`. Toute la logique, l’accès aux données et les services.
- Data: stockage des données sources et dérivées (pas de code ici).

## Dossiers

- `frontend/` – UI React, pages, composants, services d’appel API.
- `backend/` – API FastAPI, routes -> services -> dépôts, schémas.
- `vis-ssr/` – serveur Express pour GPT-Vis (SSR) qui génère les visuels côté serveur.
- `data/` – `processed/`, `interim/`, `vector_store/`, `models/`.

## Démarrage rapide

Script combiné (depuis la racine):

- `./start.sh` – coupe les processus déjà liés à ces ports, synchronise les dépendances (`uv sync`, `npm install` si besoin), recrée systématiquement le conteneur `mindsdb_container` via `${CONTAINER_RUNTIME} run …` (`CONTAINER_RUNTIME` défini dans `backend/.env`, valeurs supportées : `docker` ou `podman`), attend que l’API MindsDB réponde, synchronise les tables locales, puis configure `ALLOWED_ORIGINS` côté backend avant de lancer backend, frontend et SSR. Le frontend est désormais servi en mode « preview » (build + `vite preview`) pour éviter les erreurs de type « too many files open » liées aux watchers; pas de rechargement instantané. Les hôtes/ports sont lus dans `backend/.env` (`BACKEND_DEV_URL`) et `frontend/.env.development` (`FRONTEND_DEV_URL`), tandis que `VITE_API_URL` sert de base d’appels pour le frontend. Optionnellement, `FRONTEND_URLS` peut lister plusieurs origines pour CORS (séparées par des virgules).
- Si un conteneur MindsDB portant `${MINDSDB_CONTAINER_NAME}` existe déjà et tourne, `./start.sh` le réutilise (pas de redémarrage). Sinon il le démarre; le conteneur reste actif à la fin du script (pas d’arrêt automatique).
- `./start_full.sh` – mêmes étapes que `start.sh`, mais diffuse dans ce terminal les logs temps réel du backend, du frontend et de MindsDB (préfixés pour rester lisibles).
- Exemple: définir `BACKEND_DEV_URL=http://0.0.0.0:8000`, `FRONTEND_DEV_URL=http://localhost:5173` puis lancer `./start.sh`.

Compatibilité shell:

- Les scripts `start.sh` et `start_full.sh` sont compatibles avec le Bash macOS 3.2 et `/bin/sh`. La normalisation en minuscules de `CONTAINER_RUNTIME` n'utilise plus l'expansion Bash 4 `${var,,}` mais une transformation POSIX via `tr`.

Avant le premier lancement, copier `vis-ssr/.env.ssr.example` en `vis-ssr/.env`, puis ajuster `GPT_VIS_SSR_PORT` (et éventuellement `VIS_IMAGE_DIR` / `GPT_VIS_SSR_PUBLIC_URL`). Le script refusera de démarrer si cette configuration manque, afin d’éviter les surprises en production.

Lancer manuellement si besoin:

Backend (depuis `backend/`):

1. Installer `uv` si nécessaire: voir https://docs.astral.sh/uv
2. Installer les deps: `uv sync`
3. Lancer: `uv run uvicorn insight_backend.main:app --reload`
4. Copier `backend/.env.example` en `backend/.env` et ajuster les variables (`BACKEND_DEV_URL` pour l’hôte/port d’écoute du backend, PostgreSQL `DATABASE_URL`, identifiants admin, LLM mode local/API, `CONTAINER_RUNTIME` = `docker` ou `podman` pour le lancement de MindsDB, etc.). Le fichier `backend/.env.example` est versionné : mettez-le à jour dès que vous ajoutez ou renommez une variable pour que l’équipe dispose de la configuration de référence.

`backend/.env` (également versionné) est désormais maintenu strictement aligné sur `backend/.env.example`. Si vous avez besoin de variantes locales, créez un fichier ignoré (ex. `backend/.env.local`) ou exportez temporairement vos variables sans modifier ceux qui servent de base commune à l’équipe.

Frontend (depuis `frontend/`):

1. Installer deps: `npm i` ou `pnpm i` ou `yarn`
2. Lancer: `npm run build && npm run preview` (recommandé pour éviter les watchers) ou `npm run dev` si vous avez besoin du HMR.

SSR GPT-Vis (depuis `vis-ssr/`):

1. Installer deps: `npm install`
2. Copier `.env.ssr.example` en `.env` et ajuster `GPT_VIS_SSR_PORT` / `VIS_IMAGE_DIR` / `GPT_VIS_SSR_PUBLIC_URL`
3. Lancer: `npm run start` (endpoint `POST /generate` + statiques `/charts/*`, PNG rendu via `@antv/gpt-vis-ssr`)
4. Ajuster l'URL du plan/Z/mcp.config.json (variable `VIS_REQUEST_SERVER`) en fonction du port `GPT_VIS_SSR_PORT` choisi. Par défaut, le SSR écoute sur `6363` (voir `vis-ssr/.env.ssr.example`) et le fichier `plan/Z/mcp.config.json` référence `http://localhost:6363/`. Si le domaine public diffère de `localhost`, renseigner `GPT_VIS_SSR_PUBLIC_URL` (URL absolue, http(s)) pour que les liens de rendu retournés par l'API SSR soient corrects.

Configurer le frontend via `frontend/.env.development` (`FRONTEND_DEV_URL`, `VITE_API_URL`, `FRONTEND_URLS` si plusieurs origines sont nécessaires).
Lors du premier lancement, connectez-vous avec `admin / admin` (ou les valeurs `ADMIN_USERNAME` / `ADMIN_PASSWORD` définies dans le backend).

### Streaming Chat

- Endpoint: `POST /api/v1/chat/stream` (SSE `text/event-stream`).
- Front: affichage en direct des tokens. Lorsqu’un mode NL→SQL est actif, la/les requêtes SQL exécutées s’affichent d’abord dans la bulle (grisé car provisoire), puis la bulle bascule automatiquement sur la réponse finale. Un lien « Afficher les détails de la requête » dans la bulle permet de revoir les SQL, les échantillons et désormais les lignes RAG récupérées (table, score, colonnes clés) pour expliquer la mise en avant.
- Mode par défaut: le chat démarre en mode **tickets** (contexte injecté). Le bouton (icône étincelle) sert désormais à basculer vers le mode base (agents NL→SQL + RAG + rédaction). Quand le bouton n’est pas activé, le flux reste en mode tickets.
- En mode tickets par défaut, l’UI pré-charge automatiquement la config (table/colonnes/date min-max) dès l’ouverture du chat pour que la liste des tables soit disponible sans action supplémentaire.
- Plusieurs périodes peuvent être sélectionnées (ex.: septembre 2025 et octobre 2024) via le bouton « + Ajouter une période »; les périodes sont transmises en métadonnées `ticket_periods` et filtrent le contexte injecté.
- Plusieurs tables peuvent être ajoutées (« + Ajouter une table ») avec leurs propres périodes; le frontend envoie `ticket_sources` (table + périodes) en plus du couple principal `ticket_table`/`ticket_periods` pour compatibilité.
- Le panneau Contexte tickets peut être masqué/affiché (bouton « Masquer »/« Afficher ») pour libérer l’espace du chat sans perdre la configuration active.
- Backend: deux modes LLM (`LLM_MODE=local|api`) — vLLM local via `VLLM_BASE_URL`, provider externe via `OPENAI_BASE_URL` + `OPENAI_API_KEY` + `LLM_MODEL`.
- Les réponses du chat sont formatées et rendues en Markdown (titres courts, listes, tableaux, blocs de code) pour une meilleure lisibilité.
- `LLM_MAX_TOKENS` (défaut 1024) impose le plafond `max_tokens` sur tous les appels OpenAI-compatibles (explorateur, analyste, rédaction, router, chat) pour éviter les erreurs lorsque `model_max_tokens - context_tokens` devient négatif.
- `AGENT_OUTPUT_MAX_ROWS`/`AGENT_OUTPUT_MAX_COLUMNS` (défauts 200/20) bornent le volume de lignes/colonnes envoyé par les agents NL→SQL dans les événements SSE afin d’éviter des payloads géants.
- Le mode NL→SQL enchaîne désormais les requêtes en conservant le contexte conversationnel (ex.: après « Combien de tickets en mai 2023 ? », la question « Et en juin ? » reste sur l’année 2023).
- Le mode NL→SQL est maintenant actif par défaut (plus de bouton dédié dans le chat).

#### Métadonnées de requête (API)

- `metadata.exclude_tables: string[]` — liste de tables à exclure pour la conversation en cours. Validée côté serveur (normalisation, limite de taille, filtrage sur tables connues/permises).
- `metadata.conversation_id: number` — pour rattacher le message à une conversation existante (créée automatiquement sinon).
- `metadata.save_as_default: boolean` — lorsqu’à `true`, enregistre également les exclusions comme valeur par défaut du compte utilisateur. Par défaut `false` (opt‑in) pour éviter les conditions de concurrence entre plusieurs onglets.

#### Métadonnées de streaming (SSE)

- `meta.effective_tables: string[]` — tables effectivement actives (permissions – exclusions appliquées) envoyées au début du stream pour synchroniser l’UI.

### Données utilisées — visibilité + exclusions

- UI dans le chat: bouton « Données » pour voir les tables disponibles et décocher celles à exclure (par conversation). Un bouton/checkbox « Sauvegarder comme valeur par défaut » permet d’enregistrer ces exclusions au niveau du compte (opt‑in). Les exclusions sont appliquées au prochain message.
- Backend: `GET /api/v1/data/tables` expose les tables autorisées par l’ACL; `POST /chat/stream` accepte `metadata.exclude_tables: string[]` et publie `meta.effective_tables` (tables réellement actives) pendant le streaming.
- Persistance: les exclusions sont sauvegardées par conversation (colonne JSON `conversations.settings`) et réappliquées automatiquement aux requêtes suivantes de la même conversation.
- Sécurité: pas de mécanismes de secours. Si toutes les tables sont exclues, la réponse l’indique explicitement et NL→SQL n’est pas tenté (`provider: nl2sql-acl`).
- Détails et rationales: `plan/chat-data-visibility.md`.

### Router (à chaque message)

Un routeur léger s’exécute à chaque message utilisateur pour éviter de lancer des requêtes SQL/NL→SQL lorsque le message n’est pas orienté « data ».

- Modes: `ROUTER_MODE=rule|local|api|false` (voir `backend/.env.example`).
  - `false` désactive complètement le routeur (aucun blocage).
- Politique par défaut plus permissive: questions, indices temporels (mois/années) ou chiffres déclenchent le mode data même avec une salutation.
- Exemple de blocage: « Ce n'est pas une question pour passer de la data à l'action » (banalités très courtes uniquement).

### Historique des conversations (branche `feature/historique`)

- Persistance côté backend des conversations, messages et événements (`conversations`, `conversation_messages`, `conversation_events`).
- SSE `meta` inclut `conversation_id` pour qu’un premier message crée la conversation automatiquement.
- Endpoints: `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}`, `POST /api/v1/conversations`.
- UI (header): « Historique » pour lister/ouvrir une discussion passée, « Chat » pour démarrer une nouvelle session (`?new=1`).

### Gestion des utilisateurs (admin)

- Une fois connecté avec le compte administrateur, l’UI affiche l’onglet **Admin** permettant de créer de nouveaux couples utilisateur/mot de passe. L’interface a été simplifiée: **Chat**, **Explorer**, **Radar**, **Graph**, **Historique** et **Admin** sont accessibles via des boutons dans le header (top bar). La barre de navigation secondaire a été supprimée pour éviter les doublons.
- L’espace admin est découpé en onglets (Statistiques, Dictionnaire, Radar, Utilisateurs, Feedback). L’ancien chemin `/feedback` redirige vers l’onglet Feedback pour centraliser la revue des avis.
- Tout nouvel utilisateur (y compris l’administrateur initial) doit définir un mot de passe définitif lors de sa première connexion. Le backend retourne un code `PASSWORD_RESET_REQUIRED` si un utilisateur tente de se connecter avec son mot de passe provisoire: le frontend affiche alors un formulaire dédié qui impose la saisie du nouveau mot de passe deux fois avant de poursuivre.
- L’endpoint backend `POST /api/v1/auth/users` (token Bearer requis) accepte `{ "username": "...", "password": "..." }` et renvoie les métadonnées de l’utilisateur créé. La réponse de connexion contient désormais `username` et `is_admin` pour que le frontend sélectionne l’onglet Admin uniquement pour l’administrateur.
- L’API `POST /api/v1/auth/reset-password` (sans jeton) attend `{ username, current_password, new_password, confirm_password }`. En cas de succès elle renvoie `204` ; le frontend relance automatiquement la connexion avec le nouveau secret.
- `GET /api/v1/auth/users` expose désormais un champ `is_admin` par utilisateur : l’interface s’en sert pour signaler l’administrateur réel et bloque toute modification de ses autorisations dans la matrice.
- `GET /api/v1/admin/stats` (admin uniquement) fournit les compteurs globaux (utilisateurs, conversations, messages, graphiques) ainsi que les mêmes métriques par utilisateur et l’activité des 7 derniers jours. Le panneau admin React affiche ces statistiques dans un tableau dédié avec un bouton d’actualisation.
- `DELETE /api/v1/auth/users/{username}` (token Bearer requis, admin uniquement) supprime un utilisateur non‑admin ainsi que ses conversations, graphiques et droits associés (cascade). Opération irréversible. Codes d’erreur possibles: `400` (tentative de suppression de l’admin), `404` (utilisateur introuvable), `403` (appelant non‑admin).
- `POST /api/v1/auth/users/{username}/reset-password` (admin uniquement) génère un mot de passe temporaire et force l’utilisateur à le changer lors de la prochaine connexion (`must_reset_password=true`). Le mot de passe généré est renvoyé dans la réponse et n’est pas journalisé côté serveur.
- Les tokens d’authentification expirent désormais au bout de 4 heures. Si un token devient invalide, le frontend purge la session et redirige automatiquement vers la page de connexion pour éviter les erreurs silencieuses côté utilisateur.
- Le panneau admin inclut maintenant une matrice des droits sur les tables CSV/TSV présentes dans le répertoire de tables configuré (`DATA_TABLES_DIR`, par défaut `data/`). Chaque case permet d’autoriser ou de retirer l’accès par utilisateur; l’administrateur conserve un accès complet par défaut.
- Les droits sont stockés dans la table Postgres `user_table_permissions`. Les API `GET /api/v1/auth/users` (inventaire des tables + droits) et `PUT /api/v1/auth/users/{username}/table-permissions` (mise à jour atomique) pilotent ces ACL.
- Le backend applique ces restrictions pour les listings/ schémas (`GET /api/v1/data/...`) ainsi que pour le NL→SQL et les graphiques via `/api/v1/chat/*`: un utilisateur ne voit ni n’utilise de table qui ne lui a pas été accordée.
- Les administrateurs peuvent créer/éditer/supprimer les dictionnaires de données directement depuis l’onglet **Admin** → carte « Dictionnaire de données ». Les fichiers YAML sont persistés dans `DATA_DICTIONARY_DIR` (par défaut `data/dictionary`). API: `GET /api/v1/dictionary` (liste), `GET/PUT /api/v1/dictionary/{table}` (lecture/écriture), `DELETE /api/v1/dictionary/{table}` (suppression). Les colonnes sont validées contre le schéma réel, sans mécanismes de secours.

### Explorer (vision globale des sources)

- L’onglet/page Explorer est désactivé dans la navigation (route retirée) pour alléger l’UI; utiliser l’Explorer (camembert Category/Sub Category) et le Chat pour les parcours principaux.
- API : `GET /api/v1/data/overview` agrège, pour chaque table autorisée, le volume total et les statistiques de toutes les colonnes détectées (avec inférence des dates), en respectant les ACL `user_table_permissions`.
- Admin : un onglet dédié dans l’espace « Admin » permet d’activer/désactiver les tables visibles dans l’Explorer et de fixer les colonnes Date / Category / Sub Category sans passer par l’UI Explorer.
- `include_disabled=true` (admin uniquement) sur `GET /api/v1/data/overview` retourne aussi les tables désactivées pour préparer ou revoir leur configuration. `PUT /api/v1/data/overview/{source}/explorer-enabled` active/désactive explicitement une table pour l’Explorer.
- Admin : les colonnes Date / Category / Sub Category sont configurables par table (persistées via `/data/overview/{source}/column-roles`) et pilotent les filtres date, la répartition Category/Sub Category et l’aperçu.
- Visualisations Chart.js (lignes + barres) avec palette colorée pour timelines et répartitions des valeurs à partir des colonnes détectées automatiquement.
- Le jeu `tickets_jira` inclut désormais les colonnes `Category` et `Sub Category` (classification ITSM) pour alimenter la répartition affichée dans l’Explorer et les filtres associés.
- Usage : vérifier la santé et la couverture des jeux de données avant d’ouvrir un chat ou de générer des graphiques.

### Explorer (navigation Category/Sub Category)

- Onglet « Explorer » dans le header pour explorer les données par paires `Category` / `Sub Category` quand ces colonnes existent.
- Les colonnes Date / Category / Sub Category sont configurables par l’admin (Explorer) et persistées via `/api/v1/data/overview/{source}/column-roles`.
- Chaque source affichant ces colonnes est listée avec ses catégories et sous-catégories cliquables : un clic déclenche un aperçu (`/api/v1/data/explore/{source}`) limité à 25 lignes, avec le volume total de lignes correspondantes.
- Si une source ne possède pas les deux colonnes, la vue l’ignore et affiche un message explicite plutôt que de masquer l’erreur.
- Les aperçus sont paginés (25 lignes/page) avec navigation précédente/suivante et un tri par colonne `date` (desc/asc) quand la colonne est présente.
- Un range slider « date » global (tout en haut) filtre les données et l’aperçu d’un seul coup : la plage sélectionnée est appliquée côté backend (`/data/overview` + `/data/explore`) pour recalculer les volumes, avec un rail unique qui met en évidence la plage choisie.
- Chaque source inclut désormais un camembert Category/Sub Category (Chart.js) cliquable qui déclenche l’aperçu, se recalcule automatiquement quand le filtre date est appliqué et permet un drill-down : clic catégorie → camembert des sous-catégories + mise à jour immédiate de la table sur la sous-catégorie dominante, clic sous-catégorie → ouverture de l’aperçu (bouton retour pour remonter).
- Les tuiles de synthèse (sources/couples/sélection) ont été retirées de l’Explorer pour alléger l’interface et concentrer l’espace sur l’aperçu et les listes cliquables.
- Les catégories sont maintenant sélectionnables via un dropdown, avec un filtre texte pour cibler les sous-catégories affichées dans une liste scrollable.

### Radar – résumés journaliers/hebdo/mensuels

- Bouton « Radar » dans le header: affiche les résumés journaliers (mention explicite lorsqu’aucun ticket n’est enregistré ce jour), hebdomadaires et mensuels générés par l’agent `looper`. Les tables visibles sont filtrées selon les droits `user_table_permissions`.
- Panneau Admin → section « Radar »: configurer plusieurs tables (colonnes texte/date), puis relancer la génération pour une table donnée ou pour toutes (`POST /api/v1/loop/regenerate?table_name=...`). Résultats persistés et visibles via `GET /api/v1/loop/overview`.
- L’agent suit `LLM_MODE` (local vLLM ou API OpenAI‑compatible) et peut être borné via `AGENT_MAX_REQUESTS` (clé `looper`). Les garde‑fous de contexte sont décrits dans `backend/README.md` (`LOOP_MAX_TICKETS`, `LOOP_TICKET_TEXT_MAX_CHARS`, `LOOP_MAX_DAYS/WEEKS/MONTHS` par défaut à 1, `LOOP_MAX_TICKETS_PER_CALL`, `LOOP_MAX_INPUT_CHARS`, etc.).

## Principes d’architecture

- Routes HTTP minces -> délèguent à des services.
- Services orchestrent logique et dépôts.
- Dépôts encapsulent l’accès aux sources de données.
- Schémas (Pydantic) pour I/O propres et versionnées.
- Pas de mécanismes de secours cachés. Logs utiles uniquement.

Voir le plan d’intégration « Z »: `plan/Z/README.md` (LLM local/API et MCP).

## Arborescence (résumé)

```
backend/
  pyproject.toml
  src/insight_backend/
    main.py
    api/routes/v1/{health.py, chat.py, data.py, auth.py}
    services/{chat_service.py, data_service.py, auth_service.py}
    repositories/{data_repository.py, user_repository.py}
    schemas/{chat.py, data.py, auth.py}
    core/{config.py, logging.py, database.py, security.py}
frontend/
  package.json, vite.config.js, index.html
  src/{main.jsx, App.jsx, components/, features/, services/}
  .env.development.example
data/
  raw/, processed/, interim/, external/, vector_store/, models/
```

> Cette base est volontairement minimale et modulaire; elle n’implémente pas la logique métier.

### Mode NL→SQL (aperçu rapide)

- Pour un mode global, vous pouvez activer `NL2SQL_ENABLED=true` dans `backend/.env` pour que le LLM génère du SQL exécuté sur MindsDB. Désormais, un bouton « NL→SQL (MindsDB) » dans la zone d’input permet d’activer ce mode au coup‑par‑coup sans modifier l’environnement.
- En streaming, le frontend affiche d’abord le SQL en cours d’exécution dans la bulle, puis remplace par la synthèse finale. Les détails (SQL, échantillons de colonnes/lignes) restent accessibles dans la bulle via « Afficher les détails de la requête ». Les logs backend (`insight.services.chat`) tracent également ces étapes.
- Le logger `insight.services.nl2sql` trace désormais chaque appel LLM (question pré-traitée, taille du schéma, `max_tokens` utilisé, aperçu SQL/synthèse). Lancer `./start.sh` suffit pour voir ces logs et identifier précisément l'étape qui échoue lorsqu’un appel NL→SQL casse en développement.
- `LOG_LEVEL` (dans `backend/.env`) est appliqué dès le démarrage grâce à `insight.core.logging`, ce qui garantit que les logs NL→SQL (et tous les autres) sont bien affichés dans la console `./start.sh`.
- Les requêtes générées qualifient toujours les tables avec `files.` et réutilisent les alias déclarés pour éviter les erreurs DuckDB/MindsDB.
- Le backend n’impose plus de `LIMIT 50` automatique et renvoie désormais l’intégralité des lignes de résultat au frontend pour l’aperçu.
- Pour les appels LLM, les « evidences » envoyées au modèle sont compactées (nombre d’items, lignes/colonnes et longueur des valeurs) afin d’éviter des prompts trop volumineux en production. Les détails sont journalisés (`payload_chars`).
- Supprimez `NL2SQL_MAX_ROWS` de vos fichiers `.env` existants: la variable est obsolète et n’est plus supportée.
- Les CTE (`WITH ...`) sont maintenant reconnus par le garde-fou de préfixe afin d'éviter les faux positifs lorsque le LLM réutilise ses sous-requêtes.
- Le timeout des appels LLM se règle via `OPENAI_TIMEOUT_S` (90s par défaut) pour tolérer des latences élevées côté provider.
- Le script `start.sh` pousse automatiquement `*.csv|*.tsv` du répertoire `DATA_TABLES_DIR` (par défaut `data/`) dans MindsDB à chaque démarrage : les logs `insight.services.mindsdb_sync` détaillent les fichiers envoyés.
- Pour enrichir ces tables avec une colonne d'embeddings avant l'upload, définissez `MINDSDB_EMBEDDINGS_CONFIG_PATH` dans `backend/.env`. Ce chemin doit pointer vers un fichier YAML décrivant les colonnes à vectoriser :

```yaml
default_model: text-embedding-3-small  # optionnel (mode API: sinon EMBEDDING_MODEL / LLM_MODEL / Z_LOCAL_MODEL)
batch_size: 16                         # optionnel (sinon MINDSDB_EMBEDDING_BATCH_SIZE)
tables:
  products:
    source_column: description         # colonne texte à vectoriser
    embedding_column: description_embedding  # nouvelle colonne contenant le vecteur JSON
    # model: text-embedding-3-small    # optionnel, surcharge par table
```

Le script `start.sh` génère alors la colonne d'embedding (JSON de floats) avant de pousser la table vers MindsDB. Les erreurs de configuration (table manquante, colonne absente…) stoppent le démarrage afin d'éviter toute incohérence silencieuse. Les embeddings peuvent désormais s'appuyer sur un backend dédié via `EMBEDDING_MODE` :

- `local` charge un modèle `sentence-transformers` (`EMBEDDING_LOCAL_MODEL` prioritaire, sinon `default_model` si défini).
- `api` utilise un endpoint OpenAI‑compatible (`OPENAI_BASE_URL` + `OPENAI_API_KEY`) et le modèle `EMBEDDING_MODEL`.

Vous pouvez ajuster la taille de batch via `MINDSDB_EMBEDDING_BATCH_SIZE`. Chaque table peut toujours surcharger le modèle via la clé `model` de la configuration YAML.
Une barre de progression `tqdm` est affichée pour chaque table afin de suivre l'avancement du calcul des embeddings lors du démarrage.
- Les imports sont désormais incrémentaux : `./start.sh` ne renvoie un fichier dans MindsDB que si son contenu ou sa configuration d'embedding a changé. L'état est stocké dans `DATA_TABLES_DIR/.mindsdb_sync_state.json` — supprimez ce fichier si vous devez forcer un rechargement complet. Ce fichier est ignoré par Git (`.mindsdb_sync_state.json`). Comme le conteneur MindsDB est recréé à chaque démarrage en développement, une vérification distante est effectuée : si une table est absente côté MindsDB, elle est ré‑uploadée même si le cache local est intact. Les embeddings ne sont recalculés que lorsque le contenu source ou la configuration d'embedding change.
- Les fichiers enrichis d'embeddings conservent exactement le nom de table d'origine dans MindsDB (plus de suffixe `_emb`).

### Feedback utilisateur

- Chaque réponse assistant dans le chat expose deux actions pouce haut/bas. Les votes sont persistés avec la conversation et le message cible (pas de fallback silencieux).
- API : `POST /api/v1/feedback` (création/mise à jour), `DELETE /api/v1/feedback/{id}` (suppression) et `GET /api/v1/feedback/admin` (admin uniquement, liste ordonnée).
- Les retours sont consultables depuis l’onglet **Feedback** du panneau Admin (`/admin?tab=feedback`, `/feedback` redirige). La liste affiche les votes (auteur, conversation, extrait, date) et permet d'ouvrir directement la conversation correspondante via `/chat?conversation_id=...&message_id=...`.

### Visualisations (NL→SQL & MCP Chart)

- Deux boutons icônes vivent dans la zone d’input :
  - « Activer NL→SQL (MindsDB) » envoie `metadata.nl2sql=true` à `POST /api/v1/chat/stream` pour déclencher ponctuellement le mode NL→SQL sans modifier l’environnement.
- « Activer MCP Chart » lance le flux complet : streaming du chat pour récupérer SQL + dataset, puis `POST /api/v1/mcp/chart` avec le prompt, la réponse textuelle et les données collectées.
- Nouveau (2025‑10‑27): une barre d’actions « Graphique » et « Détails » est affichée sous chaque réponse de l’assistant. « Graphique » déclenche `POST /api/v1/mcp/chart` avec le dataset NL→SQL mémorisé lorsqu’il est disponible (sinon le bouton est désactivé). « Détails » affiche/masque le SQL exécuté, les échantillons et le plan.
- Le frontend capture le dernier dataset NL→SQL (SQL, colonnes, lignes tronquées à `NL2SQL_MAX_ROWS`) et le transmet tel quel au backend; sans résultat exploitable, aucun graphique n’est généré et un message explicite est renvoyé.
- Le backend n’explore plus directement les CSV du répertoire `DATA_TABLES_DIR` pendant cette étape : l’agent `pydantic-ai` exploite exclusivement les données reçues via l’outil `get_sql_result`. Les helpers `load_dataset` / `aggregate_counts` restent disponibles avant l’appel `generate_*_chart` si besoin.
- La réponse API inclut l’URL du rendu, les métadonnées (titre, description, spec JSON) ainsi que la requête SQL source et son volume de lignes pour garder la traçabilité côté frontend.

#### Mode Multi‑agent (Explorateur + Analyste + Rédaction)

- Activez `NL2SQL_MULTIAGENT_ENABLED=true` dans `backend/.env` pour en faire le mode par défaut, ou envoyez `metadata: { nl2sql: true, multiagent: true }` à `POST /api/v1/chat/stream` pour l’activer au coup‑par‑coup.
- Déroulé:
  - Explorateur (#1→#3): propose et exécute de petites requêtes de découverte (DISTINCT, MIN/MAX, COUNT par catégorie, échantillons LIMIT 20) et suggère des axes de visualisation. Événements SSE: `plan` (purpose: explore), `sql`/`rows` (purpose: explore), `meta.axes_suggestions`.
  - Analyste (answer): fusionne proprement les trouvailles en UNE requête finale (SELECT‑only) qui répond précisément à la question. Événements SSE: `sql`/`rows` (purpose: answer).
  - Rédaction: interprète le résultat final et produit une réponse textuelle concise en français (prose directe, sans intitulés), en 1–2 paragraphes courts. Le premier intègre le constat avec des chiffres; le second (optionnel) conclut par une recommandation concrète si justifiée, sinon par une question claire. Aucun SQL, 3–6 phrases.
  - Récupérateur: calcule l’embedding de la question, interroge les tables vectorisées déclarées dans `data/mindsdb_embeddings.yaml`, puis transmet au rédacteur les `RAG_TOP_N` lignes les plus proches. La réponse inclut désormais un paragraphe final « Mise en avant : … » qui met en lumière ces exemples (et précise l’absence de correspondances le cas échéant).
  - Itération: si le résultat final est jugé insuffisant (moins de `NL2SQL_SATISFACTION_MIN_ROWS` lignes), une nouvelle ronde d’exploration est lancée, jusqu’à `NL2SQL_EXPLORE_ROUNDS`.
- Variables d’environnement:
  - `NL2SQL_MULTIAGENT_ENABLED=false` — active le mode par défaut.
  - `NL2SQL_EXPLORE_ROUNDS=1` — nombre de rondes d’exploration max.
  - `NL2SQL_SATISFACTION_MIN_ROWS=1` — seuil minimal de lignes pour considérer la réponse satisfaisante.
  - `RAG_TOP_N=3` — nombre de lignes similaires injectées dans le contexte du rédacteur (via MindsDB).
  - `RAG_TABLE_ROW_CAP=500` — limite de lignes chargées par table pour le calcul local de similarité.
  - `RAG_MAX_COLUMNS=6` — nombre maximal de colonnes retenues par ligne pour le prompt de rédaction.
- LLM:
  - Mode local: `LLM_MODE=local` + `VLLM_BASE_URL` + `Z_LOCAL_MODEL`.
  - Mode API: `LLM_MODE=api` + `OPENAI_BASE_URL` + `OPENAI_API_KEY` + `LLM_MODEL`.
- Embeddings:
  - Mode local: `EMBEDDING_MODE=local` + `EMBEDDING_LOCAL_MODEL` (SentenceTransformers).
  - Mode API: `EMBEDDING_MODE=api` + `OPENAI_BASE_URL` + `OPENAI_API_KEY` + `EMBEDDING_MODEL`.
- La configuration du serveur (`VIS_REQUEST_SERVER`, `SERVICE_ID`…) reste gérée par `MCP_CONFIG_PATH` / `MCP_SERVERS_JSON`. Le serveur MCP `chart` nécessite une sortie réseau vers l’instance AntV par défaut, sauf si vous fournissez votre propre endpoint.
- Le backend filtre les lignes stdout non JSON renvoyées par le serveur MCP `chart` pour éviter les erreurs `Invalid JSON` dues aux logs d'initialisation.

### Sauvegarde des graphiques MCP

- Chaque graphique généré via le chat peut être sauvegardé grâce au bouton **Enregistrer dans le dashboard**. Le backend persiste l’URL, le prompt, les métadonnées et la spec JSON.
- Les routes `POST /api/v1/charts` et `GET /api/v1/charts` (token Bearer requis) gèrent respectivement l’enregistrement et la consultation. Les utilisateurs ne voient que leurs propres graphiques, tandis que l’administrateur (`ADMIN_USERNAME`) accède à l’ensemble des sauvegardes.
- Le dashboard liste désormais ces graphiques, affiche l’aperçu, le prompt associé, et expose un lien direct vers l’URL du rendu. Les administrateurs voient en plus l’utilisateur auteur.
- Chaque carte du dashboard propose un bouton **Supprimer** : les utilisateurs peuvent retirer leurs propres graphiques sauvegardés, tandis que l’administrateur peut supprimer n’importe quelle entrée.

## Notes UI

- 2025-10-21: L'état vide du chat (« Discutez avec vos données ») est maintenant centré via un overlay `fixed` non interactif: pas de scroll tant qu'aucun message n'est présent; la barre de saisie reste accessible.
 - 2025-10-21: Ajout d'un petit avertissement sous la zone de saisie: « L'IA peut faire des erreurs, FoyerInsight aussi. »

## Maintenance

- 2025-10-29: Correction d'un échec de build frontend (TS2451) dû à une double déclaration `const meta` dans `frontend/src/features/chat/Chat.tsx`. La duplication a été supprimée.
- 2025-11-27: Corrige l’échec de build du frontend (Explorer) en ajoutant les dépendances `chart.js` / `react-chartjs-2` manquantes; relancer `npm install` puis `npm run build`.

## Sécurité configuration (backend)

Depuis cette branche, le backend applique un garde‑fou de configuration: en environnement non‑développement (`ENV` différent de `development`/`dev`/`local`), le démarrage échoue si des valeurs par défaut non sûres sont détectées.

Vérifications effectuées:
- `JWT_SECRET_KEY == "change-me"`
- `ADMIN_PASSWORD == "admin"`
- `DATABASE_URL` contient `postgres:postgres@`

Corrigez ces variables dans `backend/.env` ou vos secrets d’exécution avant déploiement. En développement, ces valeurs restent acceptées mais des avertissements sont journalisés. Détails dans `backend/README.md`.

## Plan UI — Panneau « Éléments de preuve » (générique) pour /chat

- Objectif: après une requête (SQL MindsDB ou Graph), afficher un panneau latéral listant les éléments de preuve (tickets ou autre entité) réellement utilisés pour produire la réponse.
- Contrat minimal: le pipeline LLM/MCP fournit un `evidence_spec` (labels/champs) et/ou des `rows` avec `purpose: 'evidence'`. Sans spec explicite, le panneau reste désactivé (pas d’heuristique cachée, pas de requête additionnelle).
- Cible visuelle: panneau droit coulissant, bouton contextuel « {entity_label} (N) », liste scrollable des éléments avec champs déclarés, ouverture automatique quand des éléments sont présents.

### Sous‑tâches front (testables visuellement)

- Capture dataset: dans `frontend/src/features/chat/Chat.tsx`, conserver le dernier `rows` dont `purpose: 'evidence'` (colonnes + lignes + `row_count`) + `evidence_spec`; marquer `sourceMode = 'sql' | 'graph'`.
- Bouton contextuel: afficher « {entity_label} (N) » selon `evidence_spec.entity_label`; bouton désactivé + tooltip si spec absent.
- Panneau latéral: **desktop** → volet fixe à gauche (≈420px). **mobile** → bottom‑sheet (≈70% hauteur) avec overlay cliquable; fermeture `Esc` et croix; en‑tête avec `entity_label`, période éventuelle fournie par le spec, et mode (SQL MindsDB | Graph).
- Liste générique: rendu simple réutilisant `Card`/styles locaux; champs pris dans `display.{title,created_at,status}` et `pk`; tri par `display.created_at` si fourni; max 100 lignes (ou `spec.limit`) avec badge « +N ».
- États UI: `loading`, `vide` (« Aucun élément de preuve »), `erreur` (texte clair); messages discrets uniquement.
- Accessibilité: focus piégé dans le panneau, navigation clavier complète, contraste AA; responsive ≥ 360px.

### Câblage de données (sans fallback)

- Le front s’appuie uniquement sur `evidence_spec` et sur les `rows` taggés `purpose: 'evidence'`.
- Aucune inférence/heuristique silencieuse si un champ manque; afficher un état désactivé explicite.
- Réinitialiser le dataset à l’envoi d’une nouvelle question.

### Triggers & UX

- Auto‑ouverture: ouvrir le panneau quand ≥1 élément de preuve est détecté et que l’utilisateur n’a pas fermé la vue précédemment.
- Résumé: « N {entity_label} » et période éventuelle fournie par le spec (le front ne la déduit pas seul).
- Actions: lien basé sur `display.link_template` si présent; sinon aucun lien.
- Journalisation: en dev, `console.info('[evidence_panel] opened', { count, entity: entity_label, sourceMode })`; en prod, “evidence_panel_opened” si télémétrie existante.

### Scénarios de test visuel (acceptation)

- Tickets: « Combien de tickets en mai 2025 ? » avec `evidence_spec` « Tickets » + 5 lignes → bouton « Tickets (5) »; panneau ouvert; 5 lignes datées 2025‑05.
- Autre entité (ex. Incidents): même expérience avec `entity_label: "Incidents"` et mappages fournis.
- Sans spec: bouton désactivé avec tooltip « Aucun evidence_spec reçu »; aucun panneau.
- Dataset volumineux: 250 → 100 visibles + « +150 »; scroll fluide.
- A11y: `Tab` circule; `Esc` ferme; focus rendu sur le bouton.

### Impact fichiers (prévision)

- `frontend/src/features/chat/Chat.tsx`: stocker `evidence_spec` + dernier dataset `purpose:'evidence'`, état `showEvidence`, bouton d’ouverture.
- (Optionnel) `frontend/src/features/chat/EvidencePanel.tsx`: composant léger, générique; sinon inline pour éviter des artefacts.
- Réutiliser `frontend/src/components/ui/Card.tsx`; aucun nouveau design system.

### Définition de fait (DoD)

- Le panneau s’ouvre automatiquement quand des éléments de preuve sont détectés (via spec) et peut être rouvert via un bouton visible libellé `entity_label`.
- La liste utilise exclusivement les champs déclarés dans le spec; pas d’heuristiques implicites.
- Pas d’appel réseau supplémentaire déclenché par l’ouverture du panneau.
- Les scénarios de test visuel ci‑dessus passent sur desktop et mobile.
