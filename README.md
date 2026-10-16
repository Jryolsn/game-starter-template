# game-starter-template

Spela själv eller med andra i webbläsaren. Den som skapar ett rum får en kort kod (t.ex. `KJGK`) och en länk (`https://din-domän/r/KJGK`). Koden och länken är samma sak: länken innehåller bara koden.

## Kom igång

```bash
npm install
npm run dev        # server på :8787 + Vite på :5173
```

Öppna http://localhost:5173. Vite lyssnar på hela nätverket, så du kan öppna samma adress från mobilen på samma wifi (använd datorns IP, Vite skriver ut den).

Produktion (en enda Node-process som serverar både spelet och WebSocketen):

```bash
npm run build
npm start          # PORT=8787 som standard
```

`npm test` kör enhetstester för rumskoder och rumshantering.

Solo-läget som en enda fristående HTML-fil (ingen server behövs, bra för att snabbt testa på mobilen eller publicera som artifact):

```bash
npm run build:solo # → dist-solo/index.html
```

Docker (bygger klienten och kör servern på port 8080):

```bash
docker build -t mitt-spel . && docker run -p 8080:8080 mitt-spel
```

**Nytt spel?** Se [docs/nytt-spel.md](docs/nytt-spel.md).

## Hur det hänger ihop

| Mapp | Innehåll |
| --- | --- |
| `shared/game.ts` | Spellogiken. Ren TypeScript utan DOM eller nätverk. **Byt ut den här för ditt eget spel.** |
| `shared/protocol.ts` | Alla meddelanden mellan klient och server. |
| `shared/roomCode.ts` | Rumskoder (4 tecken, inga förväxlingsbara tecken som 0/O, 1/I/L) och länkar `/r/KOD` eller `?room=KOD`. |
| `server/rooms.ts` | Rum i minnet. Servern är auktoritativ: den kör `tick()` 20 gånger/s och skickar ut tillståndet. |
| `server/index.ts` | HTTP + WebSocket (`/ws`). Serverar `dist/` i produktion, `/health` för övervakning. |
| `client/src/net.ts` | `OnlineConnection` (WebSocket) och `SoloConnection` (samma meddelanden, men spelet körs lokalt i webbläsaren). |
| `client/src/gameView.ts` | Canvas-rendering och styrning: virtuell joystick där tummen landar, WASD/piltangenter på dator. |
| `client/src/main.ts` | Skärmarna: start, gå med via länk, lobby, spel, resultat. |

Flödet:

1. **Spela själv**: `SoloConnection` låtsas vara servern. Ingen nätverkstrafik, funkar offline.
2. **Skapa rum**: servern skapar ett rum, du blir värd. Adressen ändras till `/r/KOD` så att den går att dela direkt.
3. **Gå med**: skriv in koden, eller öppna länken. Länken visar en "Gå med"-skärm med namnfält och en knapp.
4. **Tappad anslutning** (vanligt på mobil): klienten återansluter automatiskt och får tillbaka sin plats via en hemlig nyckel i `sessionStorage`. Servern håller platsen i 30 sekunder. Laddar man om fliken hamnar man direkt i rummet igen.
5. Lämnar värden tar nästa spelare över. Tomma rum tas bort.

## Göra ett eget spel

1. Skriv om `shared/game.ts`: behåll `createGame`, `addPlayer`, `removePlayer`, `applyInput`, `tick` och fälten `players`/`over`/`timeLeft` (eller anpassa HUD och resultat i `main.ts`).
2. Ändra `PlayerInput` till det ditt spel behöver (knappar, mål, tryck).
3. Rita om i `GameView.draw`.

Servern och solo-läget använder samma logik, så de följer med automatiskt.

## Saker som medvetet är enkla

- Rummen ligger i minnet, så en omstart av servern tömmer dem. Med flera serverinstanser behövs delat state (t.ex. Redis) eller "sticky" routing per rumskod.
- Hela tillståndet skickas varje tick. Bra upp till 8 spelare och små världar; för större spel, skicka bara förändringar.
- Klienten jämnar ut rörelser mellan uppdateringar men gissar inte framåt (ingen client-side prediction).
- Klient och server på olika domäner: bygg klienten med `VITE_WS_URL=wss://server.example/ws`.

Hosting: allt som kör en långlivad Node-process med WebSockets fungerar, t.ex. Fly.io, Render eller Railway (se [docs/nytt-spel.md](docs/nytt-spel.md#6-driftsätta)). Serverless-plattformar som Vercel passar inte för servern.
