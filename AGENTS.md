# Mobile first multiplayer-starter

Startpunkt för webbspel: spela solo eller med andra i samma rum via 4-teckenskod eller länk (`/r/KOD`).

- **`game/` är spelets, allt annat är mallens.** Spelspecifik kod läggs bara i `game/`. Behövs en ändring utanför `game/`: gör den generell, i en egen commit, och föreslå den för mallen (`docs/mallen-och-spelen.md`). Blanda aldrig `game/` och mallens filer i samma commit.
- `game/logic.ts`: spellogiken, ren TS utan DOM/nätverk. Körs på servern OCH i webbläsaren (solo). `game/view.ts` ritar och läser styrning, `game/ui.ts` ger HUD, resultat och feedback. Se `docs/nytt-spel.md`.
- `shared/protocol.ts`: alla meddelanden klient ↔ server. Ändra båda sidor tillsammans.
- `server/rooms.ts`: auktoritativ server, rum i minnet, `tick()` 20 Hz, återanslutning med hemlig nyckel. Rum är privata eller publika, kan ha lösenord (inbjudningsnyckeln i länken `#k=` går förbi det) och kan låsas. Bara värden ändrar inställningar och tar bort spelare; kontrollera `hostId` i servern för varje sådan åtgärd.
- `client/src/net.ts`: `OnlineConnection` (WebSocket) och `SoloConnection` (samma protokoll lokalt). UI-koden ska inte veta vilken som används.

- `server/validate.ts` och `server/limits.ts`: validering mot `ClientMsgSchema` och gränser mot missbruk.
- `server/log.ts`: loggning (JSON i produktion). Använd `log.info/warn/error("händelse", { fält })`, inte `console.log`. `client/src/errors.ts` skickar webbläsarens fel till servern.
- `client/src/device.ts`: wake lock, vibration, ljud (iOS-upplåsning) och mikrofonens ljudnivå (`startMic`/`micLevel`). Respekterar spelarens inställningar.
- `client/src/profile.ts`: spelarens namn, färg och inställningar (ljud, vibration) i localStorage.

- `docs/mallen-och-spelen.md`: spelets repo har mallen som remote `template`. En generell förbättring (något alla spel har nytta av) görs som en egen commit utan spelspecifik kod och föreslås för mallen enligt guiden; säg till utvecklaren när en ändring borde gå till mallen.
- `docs/nar-spelet-vaxer.md`: rekommenderade bibliotek och mönster när ett spel behöver mer än templaten (grafik, UI, fysik, skala, konton). Utgå från den innan nya beroenden läggs till.

Regler:
- Lita aldrig på klienten: all inkommande data valideras med Valibot-scheman (`ClientMsgSchema`, `PlayerInputSchema`). Ändra schemat när meddelanden eller input ändras; typerna härleds från det.
- Ingen `Math.random` i spellogiken; använd `rand(state)`.
- Mobile first: stora tryckytor, inga hover-beroenden, testa i stående format.
- Ändras meddelandeformatet: höj `PROTOCOL_VERSION`.
- Efter ändringar: `pnpm lint && pnpm typecheck && pnpm test`, och `pnpm test:e2e` om UI eller nätverk ändrats. `pnpm build:solo` ger en fristående HTML-fil för att testa solo-läget (t.ex. som artifact).
- UI-texter är på svenska.
- Inga AI-spår i repot: ingen Co-Authored-By, "Generated with …", sessionslänkar eller omnämnanden av kodassistenter i commits, kodkommentarer, dokumentation eller PR-texter. Commits skrivs i utvecklarens namn. `pnpm check:ai` kontrollerar filer och commits; samma kontroll körs som commit-hook och i CI.
