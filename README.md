# WebSocket Chat App

A minimal React + Node WebSocket chat app. The React client is ready for GitHub Pages; the Node WebSocket server should be hosted separately.

## Structure
- `client/` React app (Vite)
- `server/` Node WebSocket server (ws)

## Local Dev
1. Install dependencies:
   - `npm install` (from repo root)
2. Start the WebSocket server:
   - `npm run dev:server`
3. Start the React app:
   - `npm run dev`
4. Open the URL printed by Vite (usually `http://localhost:5173`).

The client connects to `ws://localhost:8080` by default.

## Deploy Frontend to GitHub Pages
1. Push this repo to GitHub.
2. In GitHub: Settings -> Pages -> Source: GitHub Actions.
3. Add a repository secret named `VITE_WS_URL` with your production WebSocket URL (use `wss://`).
4. The workflow in `.github/workflows/deploy.yml` will build and deploy on every push to `main`.

## Host the WebSocket Server (Render)
1. In Render, create a new **Blueprint** and point it to this repo.
2. Render will read `render.yaml` and create the service.
3. After deploy, copy the service URL (it will be `https://...`).
4. Set `VITE_WS_URL` in GitHub secrets to `wss://<your-render-host>`.

## Environment Files
- `client/.env.example` for `VITE_WS_URL`
- `server/.env.example` for `PORT`

## Manual Verification
- Connect/disconnect status updates correctly.
- Messages broadcast between two browser tabs.
- Display name changes reflect in messages/presence.
- GitHub Pages build uses the `VITE_WS_URL` secret.
