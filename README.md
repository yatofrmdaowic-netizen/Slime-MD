# Slime-MD
Create WhatsApp multi-device bot using Baileys

Slime-MD

ConversationDiff

Logs

.dockerignore.dockerignore

New

+6-0

.gitignore.gitignore

New

+5-0

DockerfileDockerfile

New

+11-0

README.mdREADME.md

+130-1

# Slime-MD 

Multi-device and advanced WhatsApp tools 

Multi-device WhatsApp bot with Baileys, pairing-code login, MongoDB persistence, runtime controls, premium, and advanced command features. 

## New in this update 

- Runtime controls: private mode, auto-react group, save status, anti-status-delete, anti-delete. 

- Added premium user management with limit bypass. 

- Added image features (`.toimg`, `.getpp`). 

- Added URL and emoji features (`.tourl`, `.emoji`, `.emojimix`). 

- Menu now uses local assets (`assets/menu.jpg`, `assets/menu.wav`, optional `assets/menu.mp4`). 

- API logic is integrated in `src/features.js` using Node built-in `http/https` for broader Node compatibility. 

## Setup 

1. Install: 

```bash 

npm install 

``` 

2. Configure environment: 

```bash 

export PAIRING_NUMBER=6281234567890 

export OWNER_NAME="My Name" 

export OWNER_NUMBERS=6281234567890 

export CREATOR_NUMBER=6281234567890 

export BOT_NAME="Slime-MD" 

export API_BASE_URL=https://api.lolhuman.xyz 

export API_KEY=your_api_key 

export MONGODB_URI=mongodb://127.0.0.1:27017/slime-md 

export STICKER_PACKNAME="Slime Pack" 

export STICKER_AUTHOR="Slime Bot" 

export DEFAULT_LIMIT=25 

export ANTI_CALL=true 

export CALL_BLOCK=true 

export PUBLIC_MODE=true 

export AUTO_REACT_GROUP=false 

export PRIVATE_MODE=false 

export SAVE_STATUS=false 

export ANTI_STATUS_DELETE=false 

export ANTI_DELETE=false 

``` 

3. Run: 

```bash 

npm start 

``` 

### Alternative universal starter 

For hosting platforms that prefer Python entrypoints, use: 

```bash 

python3 run.py 

``` 

`run.py` auto-installs Node dependencies (when needed) and launches `npm start`. 

## Replit Pairing Code Website 

Enable lightweight pairing web UI: 

```bash 

export ENABLE_PAIRING_WEB=true 

export PORT=3000 

# optional security token 

export PAIRING_WEB_TOKEN=secret123 

``` 

Then open `/` in your deployment URL and request pairing code from browser. 

## Assets 

- `assets/menu.jpg` → menu image asset. 

- `assets/menu.wav` → menu song asset. 

- Optional: add `assets/menu.mp4` for animated menu video. 

## Important Commands 

- Main: `.menu`, `.ping`, `.system`, `.runtime`, `.creator`, `.limit`, `.premium` 

- Owner runtime: `.private true|false`, `.autoreact true|false`, `.savestatus true|false`, `.antistatusdel true|false`, `.antidelete true|false` 

- Owner premium: `.addprem <number> <days>`, `.delprem <number>`, `.premset <number> <days>`, `.listprem` 

- Owner control: `.settings`, `.callblock on|off`, `.fullpp`, `.block`, `.unblock`, `.public`, `.self`, `.addlimit`, `.setlimit`, `.resetlimit` 

- Group protection: `.antilink true|false`, `.antibadword true|false`, `.antispam true|false`, `.ownerprotect true|false`, `.onlyadmincmd true|false`, `.groupprotect true|false`, `.protect` 

- Image/media: `.sticker`, `.onceview`, `.toimg`, `.tourl`, `.getpp <number>`, `.emoji <emoji>`, `.emojimix <a>+<b>` 

## Database 

- If `MONGODB_URI` is set, group protection, limits, and premium status persist in MongoDB. 

- If `MONGODB_URI` is empty, bot falls back to in-memory behavior. 

## Download all project files 

If you need one downloadable archive of the whole project, run: 

```bash 

python3 scripts/download_all.py 

``` 

This creates `slime-md-files.zip` in the project root (excluding `.git`, `node_modules`, `session`, and `__pycache__`). 

Note: the generated zip is intentionally not committed to git, because many git/PR UIs do not handle binary archive diffs well. 

## Docker flow 

1. Create an `.env` file with at least: 

- `PAIRING_NUMBER=...` 

- `OWNER_NUMBERS=...` 

2. Build and run with Docker Compose: 

```bash 

docker compose up -d --build 

``` 

3. View logs: 

```bash 

docker compose logs -f slime-md 

``` 

4. Stop: 

```bash 

docker compose down 

```
