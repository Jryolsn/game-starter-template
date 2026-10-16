# Mobile first multiplayer-starter

Startpunkt för webbspel: spela solo eller med andra i samma rum via 4-teckenskod eller länk (`/r/KOD`).

- `shared/game.ts`: spellogiken, ren TS utan DOM/nätverk. Körs på servern OCH i webbläsaren (solo). Ett nytt spel byter i första hand ut den här filen; se `docs/nytt-spel.md`.
- `shared/protocol.ts`: alla meddelanden klient ↔ server. Ändra båda sidor tillsammans.
- `server/rooms.ts`: auktoritativ server, rum i minnet, `tick()` 20 Hz, återanslutning med hemlig nyckel.
- `client/src/net.ts`: `OnlineConnection` (WebSocket) och `SoloConnection` (samma protokoll lokalt). UI-koden ska inte veta vilken som används.

Regler:
- Lita aldrig på klienten: validera all input i `applyInput`.
- Ingen `Math.random` i spellogiken; använd `rand(state)`.
- Mobile first: stora tryckytor, inga hover-beroenden, testa i stående format.
- Efter ändringar: `npm run typecheck && npm test`. `npm run build:solo` ger en fristående HTML-fil för att testa solo-läget (t.ex. som artifact).
- UI-texter är på svenska.
