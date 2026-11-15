# Planetary Explorer V2

This project was assembled from the supplied Argon architecture export. It contains the complete source blocks identified in that export.

## Run locally

Requires Python 3.9+ and a modern browser with WebGL support.

```bash
python3 server.py
```

Open the localhost URL printed by the server.

## Important integration note

The architecture export includes later phase updates expressed as partial replacement instructions for selected files (notably the server routes and comparison UI). Those patch instructions are preserved in `ARGON_PATCH_NOTES.md`; they are not automatically merged into the extracted baseline. Review and apply them before treating the final comparison workspace and sub-route mounting as complete.

The export's reported test results are Argon's claims and have not been independently reproduced during packaging. Live NASA/PDS and imagery endpoints require network access.

## AstroLoc V11 + VS Code Live Server

The Explorer frontend can be served from the AstroLoc root using VS Code Live Server (for example, `http://127.0.0.1:5500/planetary-explorer/index.html`). Its API/data proxy is a separate Python process on port `8082`.

1. Start Live Server from the AstroLoc V11 root folder.
2. In a second terminal, run `cd planetary-explorer && python3 server.py`.
3. Open `http://127.0.0.1:5500/planetary-explorer/index.html`.
4. The Explorer frontend uses `src/core/ApiConfig.js` to send proxy requests to `http://<same-host>:8082/api/proxy`.
5. Verify the backend at `http://127.0.0.1:8082/api/health`.

Do not use Live Server as the API backend. It only serves static files. The Python server handles `/api/proxy` and already enables CORS for local development.
