# Göra ett nytt spel från startern

## 1. Skapa projektet

På GitHub: **Use this template → Create a new repository** på `game-starter-template`. Klona och kör:

```bash
npm install
npm run dev
```

## 2. Skriv spellogiken i `shared/game.ts`

All spelregler bor i den här filen. Den körs både på servern (multiplayer) och i webbläsaren (solo), så den får inte använda DOM, `window`, nätverk eller `Math.random` (använd `rand(state)` så att slumpen följer med i tillståndet).

Funktionerna som resten av startern anropar:

| Funktion | Anropas när |
| --- | --- |
| `createGame(players, seed?)` | Värden trycker på Starta / Spela igen |
| `addPlayer(state, player)` | Någon går med mitt i en runda |
| `removePlayer(state, id)` | Någon lämnar (eller varit borta i 30 s) |
| `applyInput(state, id, input)` | En spelare skickar styrning. **Validera allt här**, det kommer från klienten. |
| `tick(state, dt)` | 20 gånger/s. Sätt `state.over = true` när rundan är slut. |
| `ranking(state)` | Resultatskärmen |

`GameState` måste ha `players: Record<id, { name, color, score }>`, `timeLeft` och `over`, eftersom HUD och resultatskärm läser dem. Allt annat är ditt.

## 3. Ändra styrningen

`PlayerInput` i `game.ts` är det klienten skickar. Exemplet använder en riktning `{ x, y }` från joysticken. För knappar, tryck på skärmen eller sikte: ändra typen och `GameView.updateInput()` i `client/src/gameView.ts`.

## 4. Rita spelet

`GameView.draw()` ritar på en canvas där 1 enhet = 1 enhet i `WORLD`. Byt mot PixiJS eller Phaser när grafiken kräver det; nätverksdelen påverkas inte.

## 5. Testa

- **Solo på mobilen utan server:** `npm run build:solo` ger `dist-solo/index.html`, en enda fil som kan öppnas direkt eller publiceras som artifact. CI bygger den också (ladda ner under Actions → körningen → Artifacts).
- **Multiplayer lokalt:** `npm run dev` och öppna adressen Vite skriver ut (Network) på två telefoner på samma wifi.
- **Multiplayer på riktigt:** driftsätt (se nedan) och dela länken.
- `npm test` och `npm run typecheck` ska vara gröna; CI kör dem på varje push.

## 6. Driftsätta

Containern i `Dockerfile` kör allt i en process på port 8080 och har `/health` för hälsokontroller.

- **Fly.io:** `fly launch` (hittar Dockerfile), sedan `fly deploy`. Kör en maskin; rummen ligger i minnet.
- **Render / Railway:** nytt "Web Service" från repot, välj Docker. Sätt health check till `/health`.

Kör bara **en** instans. Rummen ligger i processens minne, så två instanser ser inte varandras rum.

## Vanliga justeringar

| Vad | Var |
| --- | --- |
| Max antal spelare | `MAX_PLAYERS` i `shared/protocol.ts` |
| Uppdateringsfrekvens | `TICK_HZ` i `shared/protocol.ts` |
| Kodlängd / tecken | `shared/roomCode.ts` |
| Hur länge en tappad spelare behåller platsen | `RECONNECT_GRACE_MS` i `server/rooms.ts` |
| Färger och utseende | `client/src/style.css`, `PLAYER_COLORS` i `game.ts` |
| Spelets namn | `<title>` i `client/index.html`, `client/public/manifest.webmanifest` |
