## Backend – FastAPI (uv)

Squelette minimal, sans logique métier. Les routes délèguent à des services.

### Installation

1. Installer `uv` (voir docs Astral).
2. Depuis `backend/`: `uv sync`

### Développement

`uv run uvicorn insight_backend.main:app --reload`

Variables d’environnement via `.env` (voir `.env.example`). Le script racine `start.sh` positionne automatiquement `ALLOWED_ORIGINS` pour faire correspondre le port du frontend lancé via ce script.

### Limites par agent (AGENT_MAX_REQUESTS)

- Configurez dans `.env` un JSON mappant chaque agent à son nombre maximal de requêtes par appel API.
- Clé: `AGENT_MAX_REQUESTS`. Exemple:

```
AGENT_MAX_REQUESTS={"explorateur":2, "analyste":1, "redaction":1, "router":1}
```

Agents disponibles: `router`, `chat`, `nl2sql`, `explorateur`, `analyste`, `redaction`, `axes`, `embedding`, `retrieval`, `mcp_chart`.

- Quand la limite est atteinte, l’API répond `429 Too Many Requests` (ou un événement `error` en SSE) avec un message explicite.
- Par défaut (variable absente ou invalide), aucune limite n’est appliquée.

Note (PR #72): les dépassements de quota par agent sont désormais correctement propagés jusqu’aux routes afin de produire un statut HTTP 429, y compris pour le chemin multi‑agent NL→SQL et la génération de graphiques via MCP.

Au démarrage, l’API journalise le mapping effectif des plafonds (ou l’absence de plafonds). En production, une valeur JSON invalide pour `AGENT_MAX_REQUESTS` provoque une erreur de démarrage. Les variables dépréciées `NL2SQL_ENABLED`, `NL2SQL_INCLUDE_SAMPLES`, `NL2SQL_SAMPLES_PATH`, `NL2SQL_PLAN_MODE` sont ignorées et signalées dans les logs.

### Dictionnaire de données (YAML)

But: fournir aux agents NL→SQL des définitions claires de tables/colonnes.

- Emplacement: `DATA_DICTIONARY_DIR` (défaut `../data/dictionary`).
- Format: 1 fichier YAML par table (`<table>.yml`), par ex. `tickets_jira.yml`.
- Schéma minimal:

```yaml
version: 1
table: tickets_jira
title: Tickets Jira
description: Tickets d'incidents JIRA
columns:
  - name: ticket_id
    description: Identifiant unique du ticket
    type: integer
    synonyms: [id, issue_id]
    pii: false
  - name: created_at
    description: Date de création (YYYY-MM-DD)
    type: date
    pii: false
```

Chargement et usage:
- `DataDictionaryRepository` lit les YAML et ne conserve que les colonnes présentes dans le schéma courant (CSV en `DATA_TABLES_DIR`).
- Conformément à la PR #59, le contenu est injecté en JSON compact dans la question courante à chaque tour NL→SQL (explore/plan/generate), pas dans un contexte global. La taille est plafonnée via `DATA_DICTIONARY_MAX_CHARS` (défaut 6000). En cas de dépassement, le JSON est réduit proprement (tables/colonnes limitées) et un avertissement est journalisé.

### Explorer – agrégats Category / Sub Category

L’onglet Explorer du frontend consomme principalement:

- `GET /api/v1/data/overview` — vue globale des tables autorisées (sources) avec, pour chaque table:
  - `fields`: statistiques par colonne (détection de dates, distributions, champs masqués, etc.).
  - `category_breakdown`: liste de triplets `{ category, sub_category, count }` calculés à partir des colonnes `Category` et `Sub Category` si elles existent dans la table.
- `GET /api/v1/data/explore/{source}?category=...&sub_category=...&limit=50` — aperçu des lignes correspondant au couple Category/Sub Category sélectionné dans le graphique de la table:
  - `matching_rows`: nombre total de lignes correspondantes dans la table.
  - `preview_columns`: ordre des colonnes dans l’aperçu.
  - `preview_rows`: lignes brutes (JSON) limitées par `limit` (1–500).

Si les colonnes `Category` et `Sub Category` sont absentes d’une table, `category_breakdown` est vide et l’endpoint d’exploration renvoie une erreur 400 explicite.

### Base de données & authentification

- Le backend requiert une base PostgreSQL accessible via `DATABASE_URL` (driver `psycopg`). Exemple local :
  ```
  createdb pasteque
  ```
  puis, dans `backend/.env` :
  ```
  DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/pasteque
  ```
- Au démarrage, le backend crée la table `users` si nécessaire et provisionne un compte administrateur (`ADMIN_USERNAME` / `ADMIN_PASSWORD`). Les valeurs par défaut sont `admin / admin`; changez-les via l’environnement avant le premier lancement pour écraser la valeur stockée.
- Une colonne booléenne `is_admin` sur la table `users` est forcée à `true` uniquement pour ce compte administrateur et à `false` pour tous les autres comptes à chaque démarrage. Les contrôles d’accès vérifient ce flag *et* le nom d’utilisateur pour éviter toute élévation de privilèges accidentelle.
- Les mots de passe sont hachés avec Argon2 (`argon2-cffi`). Si vous avez déjà déployé la version bcrypt, exécutez la migration manuelle suivante pour élargir la colonne :
  ```
  ALTER TABLE users ALTER COLUMN password_hash TYPE VARCHAR(256);
  ```
- L’endpoint `POST /api/v1/auth/login` vérifie les identifiants et retourne un jeton `Bearer` (JWT HS256).
- L’endpoint `GET /api/v1/auth/users` inclut un champ booléen `is_admin` pour refléter l’état réel de l’utilisateur côté base; le frontend s’appuie dessus pour neutraliser toute modification des droits de l’administrateur.
- L’endpoint `DELETE /api/v1/auth/users/{username}` (admin requis) supprime un utilisateur non‑admin et cascade ses objets dépendants (conversations, graphiques, ACL). Opération irréversible. Codes d’erreur: `400` (admin protégé), `404` (utilisateur absent), `403` (non‑admin).
- L’endpoint `POST /api/v1/auth/users/{username}/reset-password` (admin requis) génère un mot de passe temporaire, active `must_reset_password=true` et renvoie le secret temporaire (non journalisé). L’utilisateur devra le changer via `POST /api/v1/auth/reset-password`.
- La colonne `must_reset_password` est ajoutée automatiquement au démarrage si elle n’existe pas encore. Elle force chaque nouvel utilisateur à passer par `POST /api/v1/auth/reset-password` (payload : `username`, `current_password`, `new_password`, `confirm_password`) avant d’obtenir un jeton. La réponse de login renvoie un code d’erreur `PASSWORD_RESET_REQUIRED` tant que le mot de passe n’a pas été mis à jour.

### Journalisation

- Logger `insight.api.chat`: trace chaque appel `POST /api/v1/chat/completions` (mode LLM sélectionné, nombre de messages, provider et taille de la réponse).
- Logger `insight.services.chat`: détaille l’entrée du service (dernier message utilisateur tronqué), l’éventuel passage `/sql`, les plans NL→SQL et les réponses renvoyées.
- Les prévisualisations de messages sont limitées à ~160 caractères pour éviter de fuiter des contenus sensibles dans les traces.
- Les logs sont au niveau INFO par défaut via `core.logging.configure_logging`; ajuster `LOG_LEVEL` dans l’environnement si besoin.
- Les réponses NL→SQL envoyées au frontend sont désormais uniquement en langage naturel; les requêtes SQL restent accessibles via les métadonnées ou les logs si besoin.
- Le générateur NL→SQL refuse désormais les requêtes qui n’appliquent pas le préfixe `files.` sur toutes les tables (`/api/v1/mindsdb/sync-files` garde le même schéma).

### Garde‑fous de configuration

En environnements non‑développement (`ENV` différent de `development`/`dev`/`local`), le backend refuse de démarrer si des valeurs par défaut non sûres sont détectées:

- `JWT_SECRET_KEY == "change-me"`
- `ADMIN_PASSWORD == "admin"`
- `DATABASE_URL` contient `postgres:postgres@`

Corrigez ces variables dans `backend/.env` (ou vos secrets d’exécution) avant le déploiement. En développement, ces valeurs sont tolérées mais un avertissement est journalisé.

### Sécurité et robustesse (conversations)

- L’endpoint `GET /api/v1/conversations/{id}/dataset` ne ré‑exécute que des requêtes strictement `SELECT` validées via un parseur SQL (sqlglot). Les contraintes suivantes sont appliquées:
  - Une seule instruction (pas de `;` ni de commentaires),
  - Pas de `UNION/EXCEPT/INTERSECT`, pas de `SELECT … INTO`,
  - Aucune opération DML/DDL (INSERT/UPDATE/DELETE/ALTER/DROP/CREATE),
  - Toutes les tables doivent respecter le préfixe configuré par `NL2SQL_DB_PREFIX` (par défaut: `files`),
  - Ajout automatique d’un `LIMIT` si absent (valeur: `EVIDENCE_LIMIT_DEFAULT`, 100 par défaut).
- Les agents NL→SQL (exploration, analyste, rédaction) n’exposent jamais plus de `AGENT_OUTPUT_MAX_ROWS` lignes (défaut 200) ni plus de `AGENT_OUTPUT_MAX_COLUMNS` colonnes (défaut 20) dans les événements SSE `rows` / `meta`. Les colonnes excédentaires sont tronquées avant envoi pour éviter des payloads volumineux.
- Les titres de conversations sont assainis côté API (suppression caractères de contrôle, crochets d’angle, normalisation d’espace, longueur ≤ 120).
- Les écritures (création de conversation, messages, événements) sont encapsulées dans des transactions SQLAlchemy pour éviter les incohérences en cas d’erreur.
- Des index composites sont créés automatiquement pour accélérer l’accès à l’historique: `(conversation_id, created_at)` sur `conversation_messages` et `conversation_events`.

### LLM « Z » – deux modes

Le backend utilise un moteur OpenAI‑compatible unique (léger) pour adresser:

- Mode local (vLLM):
  - `LLM_MODE=local`
  - `VLLM_BASE_URL=http://localhost:8000/v1`
  - `Z_LOCAL_MODEL=GLM-4.5-Air`
  - Lancer vLLM (exemple):
    ```bash
    python -m vllm.entrypoints.openai.api_server \
      --model "$Z_LOCAL_MODEL" --host 0.0.0.0 --port 8000
    ```

- Mode API (provider Z):
  - `LLM_MODE=api`
  - `OPENAI_BASE_URL=<base OpenAI-compatible>`
  - `OPENAI_API_KEY=<clé>`
  - `LLM_MODEL=GLM-4.5-Air`
  - Voir quick start: https://docs.z.ai/guides/overview/quick-start

Quel que soit le mode, `LLM_MAX_TOKENS` (défaut 1024) borne explicitement les réponses des appels `chat_completions` (explorateur, analyste, rédaction, router, chat). Cela évite les erreurs `max_tokens` négatives lorsque les prompts deviennent volumineux.

De plus, les charges utiles transmises au LLM sont « compactées » côté backend pour rester dans une fenêtre de contexte réaliste:

- Evidence compactée: au plus 5–6 items, 10–12 lignes par item, 10 colonnes max, valeurs tronquées à ~80 caractères.
- Schéma compacté: la description des tables est tronquée à ~8 000 caractères.

Ces garde‑fous sont visibles dans les logs `insight.services.nl2sql` via `payload_chars` et ne changent pas les données persistées côté conversation.

Appel:

```bash
curl -sS -X POST 'http://127.0.0.1:8000/api/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Bonjour"}]}'
```

### Embeddings – modes local/API

Les embeddings sont configurables indépendamment du LLM:

- `EMBEDDING_MODE=api` (défaut): envoie les requêtes vers un backend OpenAI‑compatible (`OPENAI_BASE_URL` + `OPENAI_API_KEY`) en utilisant `EMBEDDING_MODEL` ou la valeur `model` déclarée dans `mindsdb_embeddings.yaml`.
- `EMBEDDING_MODE=local`: charge un modèle SentenceTransformers (`EMBEDDING_LOCAL_MODEL`, par défaut `sentence-transformers/all-MiniLM-L6-v2`) pour calculer les vecteurs en local, sans dépendre de vLLM.

En mode local, `EMBEDDING_LOCAL_MODEL` prime sur la clé `default_model` du YAML (et sur toute valeur `model` absente), afin de pouvoir surcharger rapidement le modèle depuis l'environnement.

`MINDSDB_EMBEDDINGS_CONFIG_PATH` décrit toujours les tables/colonnes à vectoriser. Le script `start.sh` applique la configuration choisie avant chaque import vers MindsDB. Les logs `insight.services.mindsdb_embeddings` précisent le mode et le modèle utilisés.

### Vérification TLS du backend LLM (LLM_VERIFY_SSL)

Par défaut, toutes les requêtes HTTP vers le backend LLM OpenAI‑compatible (vLLM local ou provider externe en mode API) vérifient le certificat TLS du serveur.

- `LLM_VERIFY_SSL=true` (défaut): vérifie la chaîne de certificats comme attendu en production.
- `LLM_VERIFY_SSL=false`: désactive la vérification TLS pour le client LLM (utilise `verify=False` côté HTTP). **À n'utiliser que dans un environnement contrôlé** lorsque vous devez contourner un certificat auto‑signé ou une chaîne incomplète.

Lorsque `LLM_VERIFY_SSL=false`, un avertissement explicite est journalisé par `insight.integrations.openai` au démarrage du client.
Ce flag s'applique aussi aux appels LLM utilisés par l'agent MCP `chart`.

### Mise en avant RAG

- Les mises en avant sont produites par un agent dédié `retrieval` qui orchestre:
  - la récupération de lignes proches via `RetrievalService` (embeddings MindsDB)
  - la synthèse via LLM (local via vLLM ou API externe selon `LLM_MODE`).
- Quotas: l'appel au LLM pour la synthèse consomme le budget `retrieval` (et le calcul d'embedding consomme `embedding`). Configurez via `AGENT_MAX_REQUESTS`.
- Tuning de la synthèse:
  - `RETRIEVAL_TEMPERATURE` (float, défaut 0.2)
  - `RETRIEVAL_MAX_TOKENS` (int, défaut 220)
  - `RETRIEVAL_MODEL` (optionnel; surcharge le modèle par défaut selon le mode local/API)
- Injection contexte analyste → retrieval:
  - `RETRIEVAL_INJECT_ANALYST` (bool, défaut: true). Quand activé et si l'analyste a produit une réponse, celle-ci est injectée à la question du retrieval pour orienter la sélection de lignes et la mise en avant.
- Le prompt instructif reste « given the user question and the retrieved related informations, give the user some insights », la question et les lignes rapprochées étant injectées sous forme structurée.
- En cas d'échec du LLM, l'API signale explicitement l'indisponibilité de la synthèse dans la réponse afin d'éviter toute dégradation silencieuse.
- Les extraits issus du RAG ne sont plus tronqués côté backend afin de laisser le LLM exploiter l'intégralité du texte récupéré.

### Streaming (SSE)

Endpoint de streaming compatible navigateurs (SSE via `text/event-stream`) — utilise la même configuration LLM:

```
POST /api/v1/chat/stream
Content-Type: application/json
Accept: text/event-stream

{
  "messages": [{"role":"user","content":"Bonjour"}]
}
```

Évènements émis (ordre garanti):
- `meta`: `{ request_id, provider, model }`
- `delta`: `{ seq, content }` (répété)
- `done`: `{ id, content_full, usage?, finish_reason?, elapsed_s }`
- `error`: `{ code, message }`

En-têtes envoyés par le serveur: `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `Connection: keep-alive`.

Notes de prod:
- Si vous terminez derrière Nginx/Cloudflare, désactivez le buffering pour ce chemin.
- Un seul flux actif par requête; le client doit annuler via `AbortController` si nécessaire.

### Animation UI (ANIMATION)

Pilote le niveau d'animation côté front à partir des évènements SSE:

- `ANIMATION=sql` (défaut): conserve les évènements `plan`/`sql`/`rows` tels quels (affichage du SQL intérimaire, échantillons, etc.).
- `ANIMATION=false`: supprime les évènements `plan` et `sql` côté SSE (et ne les persiste pas). Les métadonnées utiles (`meta`, `effective_tables`, `evidence`) restent émises pour garder les panneaux synchronisés.
- `ANIMATION=true`: active un agent LLM « animator » qui observe les évènements et émet des messages courts `anim` pour expliquer la progression (ex: « Tables actives: N », « Comptage par catégorie », « Résultats: 20 lignes »). Dans ce mode, les évènements `plan`/`sql` sont de nouveau émis ET persistés afin d’alimenter le panneau « Détails » et l’historique; le message « anim » reste concis et n’impacte pas les données.

Validation: la variable doit valoir `sql`, `true` ou `false`.

Notes UI:
- En `ANIMATION=true`, le front n’affiche pas le SQL « inline » si un message `anim` est présent; le SQL reste accessible via le bouton « Détails » (et dans l’historique).

### Router à chaque message

Objectif: éviter de déclencher des requêtes SQL/NL→SQL lorsque un message utilisateur n’est pas orienté « data ».

- Activation: contrôlée par `ROUTER_MODE` (`rule` par défaut).
- Modes disponibles:
  - `rule` (défaut): heuristiques déterministes (aucun appel LLM), désormais plus permissives (interrogations/mois/années/chiffres autorisent).
  - `local`: LLM local via vLLM (`VLLM_BASE_URL`, `Z_LOCAL_MODEL` ou `ROUTER_MODEL`).
  - `api`: LLM distant OpenAI‑compatible (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `LLM_MODEL` ou `ROUTER_MODEL`).
  - `false`: désactive complètement la surcouche router (aucun blocage, aucun évènement lié au router).
- Comportement:
  - Si un message est jugé « non actionnable », l’API répond immédiatement: « Ce n'est pas une question pour passer de la data à l'action » et aucune requête SQL n’est lancée pour ce message.
  - Sinon, la route cible (`data` | `feedback` | `foyer`) est loggée. En mode stream, un évènement `meta` (provider=`router`) n’est émis que lors d’un blocage. Avec `ROUTER_MODE=false`, aucun évènement lié au router n’est émis.

Variables d’environnement (voir `.env.example`):

```
ROUTER_MODE=rule   # rule | local | api | false
# ROUTER_MODEL=    # optionnel; sinon Z_LOCAL_MODEL/LLM_MODEL
```

### Loop – résumés journaliers/hebdomadaires/mensuels

- Endpoints:
  - `GET /api/v1/loop/overview` (auth): renvoie les tables configurées + leurs résumés jour/hebdo/mensuels. Les tables sont filtrées selon les droits d’accès de l’utilisateur (ACL `user_table_permissions`). Le résumé journalier indique explicitement lorsqu’aucun ticket n’est enregistré le jour courant.
  - `PUT /api/v1/loop/config` (admin): choisit la table + colonnes texte/date à utiliser (validées sur les CSV en `DATA_TABLES_DIR`). Plusieurs tables peuvent être configurées.
  - `POST /api/v1/loop/regenerate` (admin): relance l’agent `looper` pour regénérer les résumés. Paramètre optionnel `table_name` pour cibler une table précise, sinon toutes les tables configurées sont recalculées.
- L’agent `looper` injecte le contenu des tickets de chaque période et produit deux parties dans une réponse longue: problèmes majeurs à résoudre + plan d’action concret. Il respecte `LLM_MODE` (local vLLM ou API externe).
- Garde‑fous configurables dans `.env.example`: `LOOP_MAX_TICKETS` (échantillon par période, défaut 60), `LOOP_TICKET_TEXT_MAX_CHARS` (tronque chaque ticket, 360), `LOOP_MAX_DAYS` (1), `LOOP_MAX_WEEKS` (1), `LOOP_MAX_MONTHS` (1), `LOOP_TEMPERATURE` (0.3), `LOOP_MAX_TOKENS` (800), `LOOP_MAX_TICKETS_PER_CALL` (400) et `LOOP_MAX_INPUT_CHARS` (300000) pour forcer le découpage en sous-résumés avant fusion. Quota via `AGENT_MAX_REQUESTS` clé `looper`.

### MCP – configuration déclarative

Objectif: faciliter la connexion côté moteur de chat aux serveurs MCP:

- Chart: antvis/mcp-server-chart
- Neo4j: neo4j-contrib/mcp-neo4j
- MindsDB: mcpmarket.com/server/mindsdb

Déclarer via `MCP_SERVERS_JSON` ou `MCP_CONFIG_PATH`.

Lister la config chargée:

```bash
curl -sS 'http://127.0.0.1:8000/api/v1/mcp/servers' | jq
```

Visualisations via MCP Chart:

```bash
curl -sS -X POST 'http://127.0.0.1:8000/api/v1/mcp/chart' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Répartition des problèmes par service"}' | jq
```

- Le backend instancie un agent `pydantic-ai` qui combine les CSV locaux (`data/raw/`) avec les outils du serveur MCP `chart` (`generate_*_chart`).
- Des outils internes (`load_dataset`, `aggregate_counts`) exposent les données au modèle avant l’appel MCP; aucun graphique n’est pré-calculé.
- La réponse JSON contient l’URL du graphique (`chart_url`), le nom d’outil MCP utilisé et la spec JSON envoyée au serveur. Un `502` est renvoyé si la génération échoue côté MCP.
- La configuration du serveur reste déclarative (`plan/Z/mcp.config.json`, `MCP_CONFIG_PATH`, `MCP_SERVERS_JSON`) et supporte les variables `VIS_REQUEST_SERVER`, `SERVICE_ID`, etc.

### MindsDB – connexion simple (HTTP)

Pré‑requis: vous avez lancé MindsDB OSS avec l’API HTTP (exemple):

```bash
docker run --name mindsdb_container \
  -e MINDSDB_APIS=http,mysql \
  -p 47334:47334 -p 47335:47335 \
  mindsdb/mindsdb
```

Config côté backend (`backend/.env`):

```
MINDSDB_BASE_URL=http://127.0.0.1:47334/api
# MINDSDB_TOKEN=   # optionnel si auth activée côté MindsDB
# MINDSDB_TIMEOUT_S=120  # délai lecture/écriture HTTP en secondes
```

Contrôle du conteneur MindsDB via `backend/.env` (utilisé par `start.sh`):

```
# Nom du conteneur
MINDSDB_CONTAINER_NAME=mindsdb_container

# Ports côté hôte (gauche du -p) — doivent être numériques
MINDSDB_HTTP_PORT=47334
MINDSDB_MYSQL_PORT=47335

# Note: le port de `MINDSDB_BASE_URL` doit correspondre à `MINDSDB_HTTP_PORT`.
```

Le délai par défaut est de 120 s, suffisant pour publier des CSV volumineux; ajustez `MINDSDB_TIMEOUT_S` si vos imports dépassent cette fenêtre.

1) Synchroniser les fichiers locaux `data/raw` vers la DB `files` de MindsDB:

```bash
curl -sS -X POST 'http://127.0.0.1:8000/api/v1/mindsdb/sync-files' | jq
```

> Pour un démarrage complet, `./start.sh` réinitialise le conteneur `mindsdb_container` et appelle automatiquement cette synchronisation (voir logs `insight.services.mindsdb_sync`).
> Variante: `./start_full.sh` effectue les mêmes actions et diffuse toutes les traces (backend, frontend, MindsDB) dans le terminal courant.

2) Exécuter une requête SQL sur MindsDB:

```bash
curl -sS -X POST 'http://127.0.0.1:8000/api/v1/mindsdb/sql' \
  -H 'Content-Type: application/json' \
  -d '{"query":"SELECT * FROM files.myfeelback_remboursements LIMIT 5"}' | jq
```

3) Depuis le Chat, requête rapide via une commande `/sql` (sans changer le frontend):

Dans la zone de saisie, tapez par exemple:

```
/sql SELECT COUNT(*) AS n FROM files.myfeelback_remboursements WHERE date BETWEEN '2025-08-01' AND '2025-08-31'
```

Le backend exécutera la requête côté MindsDB et retournera un tableau texte.

Note: cette commande n’implémente pas de NL→SQL; pour un flux LLM complet avec tool‑calling MCP, on l’ajoutera dans une itération suivante.

### NL→SQL (questions en langage naturel)

Le mode NL→SQL est désormais toujours actif en multi‑agent (Explorateur + Analyste + Rédaction). Configurez uniquement le préfixe de schéma et les options associées:

1) Prérequis: un LLM opérationnel (vLLM local ou API) et MindsDB accessible.
2) Dans `backend/.env`:

```
NL2SQL_DB_PREFIX=files
```

3) Redémarrez le backend. Posez une question libre dans le chat, par ex.:

"Combien de sinistres ont été déclarés en août 2025 ?"

Le backend génère une requête `SELECT` ciblant uniquement `files.*`, exécute la requête via MindsDB et affiche dans le chat la requête exécutée suivie du résultat synthétisé. Aucune réponse “fallback” n’est renvoyée si la génération échoue: l’erreur est affichée explicitement. La requête SQL n’est plus modifiée pour ajouter un `LIMIT` automatique et les aperçus transmis au frontend conservent l’intégralité des lignes renvoyées par MindsDB.

Un log côté backend (`insight.services.chat`) retrace chaque question NL→SQL et les requêtes SQL envoyées à MindsDB, tandis que `insight.services.mindsdb_sync` détaille les fichiers synchronisés.

Notes PR #72 (comportements):
- Si les plafonds d’agents `explorateur`/`analyste` ne permettent aucun tour d’exploration, le backend renvoie une réponse explicite sans lancer d’exploration.
- Le nombre maximum d’étapes par tour d’exploration est borné par une constante interne (`NL2SQL_EXPLORE_MAX_STEPS`, valeur par défaut: 3).

### Notes de maintenance

 - 2025-10-30: Déduplication de la normalisation `columns/rows` des réponses MindsDB dans `ChatService` via la méthode privée `_normalize_result` (remplace 2 blocs similaires: passage `/sql` et NL→SQL simple). Aucun changement fonctionnel attendu. Suite au refactor: `uv run pytest` → 18 tests OK.
 - 2025-10-30: NL→SQL – extraction JSON centralisée et garde‑fous d'entrée. Ajout de `_extract_json_blob()` dans `nl2sql_service.py` (remplace la logique de parsing des blocs ```json … ```), validation des paramètres (`question`, `schema`, bornes `max_steps`) et mise sous cap de la taille du prompt (`tables_blob`). Tests: `uv run pytest` → 18 tests OK.
 - 2025-10-31: Evidence panel — dérivation de la requête `SELECT *` désormais basée sur l'AST (sqlglot) au lieu de regex, en conservant `WHERE` et CTE, et en plafonnant avec `LIMIT`. Les opérations en ensemble (UNION/INTERSECT/EXCEPT) sont ignorées par sécurité. Tests: `uv run pytest` → 20 tests OK.
 - 2025-11-10: NL→SQL — suppression de l'usage de `NULLIF` dans les règles et la réécriture YEAR/MONTH. Les dates texte sont maintenant castées via `CAST(CASE WHEN col IS NULL OR col IN ('None','') THEN NULL ELSE col END AS DATE)` et les prompts imposent explicitement ce schéma (pas de fallback). Le correctif élimine la source des `NULLIF(..., 'None', 'None')` invalides observés lors des comparaisons août vs juillet, sans post‑traitement.

 

 
# Backend

## Evidence panel defaults

- `EVIDENCE_LIMIT_DEFAULT` (int, default: 100): limite de lignes envoyées via SSE pour l’aperçu « evidence ». Utilisée à la fois pour la construction du `evidence_spec.limit` et pour la dérivation de SQL détaillé.

Depuis 2025‑10‑31:
- La dérivation du SQL « evidence » produit systématiquement un `SELECT *` (avec les mêmes `FROM`/`WHERE` et un `LIMIT`) y compris lorsque la requête d’origine n’est pas agrégée. Ainsi, le panel reçoit toujours des lignes complètes et peut afficher toutes les colonnes disponibles (l’aperçu de la liste reste plafonné côté front, la vue Détail montre tout).
## Historique des conversations

Le backend persiste désormais les conversations et événements associés:

- Tables: `conversations`, `conversation_messages`, `conversation_events`.
- Les routes exposées (préfixe `${API_PREFIX}/v1`):
  - `GET /conversations` — liste des conversations de l’utilisateur courant (id, title, updated_at).
  - `GET /conversations/{id}` — détail d’une conversation (messages, dernier `evidence_spec` et ses lignes si présentes).
  - Depuis 2025‑10‑29: `evidence_rows.rows` est normalisé en liste d’objets (clé = nom de colonne),
    même si la source a persisté une liste de tableaux. Cela garantit la cohérence avec le
    streaming SSE et évite que le panneau « Tickets » n’affiche des cellules vides.
  - Depuis 2025‑10‑29: chaque message assistant peut inclure `details` (optionnel),
    reconstruit à partir des `conversation_events` entre le dernier message utilisateur et ce message:
    - `details.steps`: événements `sql` successifs (avec `step`, `purpose`, `sql`).
    - `details.plan`: dernier événement `plan` s’il est présent.
  - Depuis 2025‑10‑29: `GET /conversations/{id}/dataset?message_index=N` rejoue la dernière requête SQL (hors « evidence »)
    liée au message assistant d’index `N`, avec un `LIMIT` de sécurité (`EVIDENCE_LIMIT_DEFAULT`).
    Réponse: `{ dataset: { sql, columns, rows, row_count, step, description } }`.
  - Depuis 2025‑10‑29: `POST /conversations/{id}/chart` enregistre un évènement `chart` (url + métadonnées). Ces
    évènements sont réintégrés dans le flux `messages` lors du `GET /conversations/{id}` afin que les graphiques
    réapparaissent dans l’historique de la conversation.
  - `POST /conversations` — crée une conversation (optionnel: `{ "title": "..." }`).

Intégration au flux `/chat/stream`:

- Le client peut passer `metadata.conversation_id` pour rattacher un message à une conversation existante.
- Si absent, le backend crée une conversation et renvoie l’identifiant dans l’événement `meta` (`conversation_id`).
- Les événements `sql`/`rows`/`plan`/`meta` sont ajoutés en base et la réponse finale de l’assistant est enregistrée comme message.
