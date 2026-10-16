# Mobile first multiplayer-starter

Startpunkt för webbspel: spela solo eller med andra i samma rum via 4-teckenskod eller länk (`/r/KOD`).

- `shared/game.ts`: spellogiken, ren TS utan DOM/nätverk. Körs på servern OCH i webbläsaren (solo). Ett nytt spel byter i första hand ut den här filen; se `docs/nytt-spel.md`.
- `shared/protocol.ts`: alla meddelanden klient ↔ server. Ändra båda sidor tillsammans.
- `server/rooms.ts`: auktoritativ server, rum i minnet, `tick()` 20 Hz, återanslutning med hemlig nyckel.
- `client/src/net.ts`: `OnlineConnection` (WebSocket) och `SoloConnection` (samma protokoll lokalt). UI-koden ska inte veta vilken som används.

- `server/validate.ts` och `server/limits.ts`: validering mot `ClientMsgSchema` och gränser mot missbruk.
- `client/src/device.ts`: wake lock, vibration och ljud (iOS-upplåsning). Respekterar spelarens inställningar.
- `client/src/profile.ts`: spelarens namn, färg och inställningar (ljud, vibration) i localStorage.

- `docs/nar-spelet-vaxer.md`: rekommenderade bibliotek och mönster när ett spel behöver mer än templaten (grafik, UI, fysik, skala, konton). Utgå från den innan nya beroenden läggs till.

Regler:
- Lita aldrig på klienten: all inkommande data valideras med Valibot-scheman (`ClientMsgSchema`, `PlayerInputSchema`). Ändra schemat när meddelanden eller input ändras; typerna härleds från det.
- Ingen `Math.random` i spellogiken; använd `rand(state)`.
- Mobile first: stora tryckytor, inga hover-beroenden, testa i stående format.
- Ändras meddelandeformatet: höj `PROTOCOL_VERSION`.
- Efter ändringar: `pnpm lint && pnpm typecheck && pnpm test`, och `pnpm test:e2e` om UI eller nätverk ändrats. `pnpm build:solo` ger en fristående HTML-fil för att testa solo-läget (t.ex. som artifact).
- UI-texter är på svenska.
