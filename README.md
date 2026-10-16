# game-starter-template

Spela själv eller med andra i webbläsaren. Den som skapar ett rum får en kort kod (t.ex. `KJGK`) och en länk (`https://din-domän/r/KJGK`). Länken och QR-koden innehåller koden plus en hemlig inbjudningsnyckel, så den som får länken slipper ett eventuellt lösenord.

## Kom igång

Kräver Node 22+ och pnpm (`npm i -g pnpm` eller `corepack enable`). Versionen står i `packageManager` i `package.json`.

```bash
pnpm install
pnpm dev        # server på :8787 + Vite på :5173
```

Öppna http://localhost:5173. Vite lyssnar på hela nätverket, så du kan öppna samma adress från mobilen på samma wifi (använd datorns IP, Vite skriver ut den).

Produktion (en enda Node-process som serverar både spelet och WebSocketen):

```bash
pnpm build
pnpm start          # PORT=8787 som standard
```

`pnpm test` kör enhetstester och `pnpm lint` kör Biome (`pnpm format` rättar). `pnpm test:e2e` bygger klienten och spelar igenom rum, länk, återanslutning och solo med två simulerade telefoner (första gången: `pnpm exec playwright install chromium`).

Solo-läget som en enda fristående HTML-fil (ingen server behövs, bra för att snabbt testa på mobilen eller publicera som artifact):

```bash
pnpm build:solo # → dist-solo/index.html
```

Docker (bygger klienten och kör servern på port 8080):

```bash
docker build -t mitt-spel . && docker run -p 8080:8080 mitt-spel
```

**Nytt spel?** Se [docs/nytt-spel.md](docs/nytt-spel.md). **Behöver spelet mer** (grafikmotor, UI-ramverk, fysik, konton, flera servrar)? Se [docs/nar-spelet-vaxer.md](docs/nar-spelet-vaxer.md).

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

## Rum: privata, publika, lösenord och lås

Värden ändrar allt under **Rumsinställningar** i lobbyn.

| Inställning | Vad det betyder |
| --- | --- |
| Privat (standard) | Rummet syns inte i listan. Man kommer in med koden eller länken. |
| Publikt | Rummet syns i **Hitta publika rum** på startsidan, så länge det inte är låst eller fullt. |
| Lösenord | Krävs för den som skriver in koden eller väljer rummet i listan. Länken och QR-koden bär en inbjudningsnyckel (`/r/KOD#k=…`) som släpper in utan lösenord. Nyckeln ligger efter `#` och skickas därför aldrig med i HTTP-anrop eller serverloggar. |
| Lås | Inga nya spelare, inte ens med länk. Spelare som redan är med kan återansluta. |
| Ta bort spelare | Värden trycker på en spelare i listan. Spelaren kan gå med igen om rummet inte är låst, så lås rummet först om hen ska hållas ute. |

Lösenordet ligger i klartext i serverns minne och försvinner med rummet. Fel lösenord räknas mot samma gräns per IP som felgissade koder.

## Göra ett eget spel

1. Skriv om `shared/game.ts`: behåll `createGame`, `addPlayer`, `removePlayer`, `applyInput`, `tick` och fälten `players`/`over`/`timeLeft` (eller anpassa HUD och resultat i `main.ts`).
2. Ändra `PlayerInput` till det ditt spel behöver (knappar, mål, tryck).
3. Rita om i `GameView.draw`.

Servern och solo-läget använder samma logik, så de följer med automatiskt.

## Skydd och drift

- **Validering:** varje meddelande från klienten kontrolleras mot `ClientMsgSchema` ([Valibot](https://valibot.dev), `shared/protocol.ts`) innan det når rummen. Spelets egen input har ett schema i `shared/game.ts`.
- **Gränser** (`server/limits.ts`, kan ändras med miljövariabler): `LIMIT_MSG_PER_SECOND` (30), `LIMIT_MSG_BURST` (60), `LIMIT_ROOMS_PER_MINUTE` per IP (10), `LIMIT_MAX_ROOMS` (1000), `LIMIT_CONNECTIONS_PER_IP` (20). En klient som spammar kopplas bort.
- **Versionskoll:** klienten ansluter med `?v=PROTOCOL_VERSION`. Höj `PROTOCOL_VERSION` i `shared/protocol.ts` när meddelandeformatet ändras, så laddar gamla flikar om sig själva efter driftsättningen.
- **HTTP:** säkerhetsheaders (CSP, `nosniff`, ingen inbäddning i andra sidor) och felaktiga URL:er ger 400 i stället för att krascha servern.
- **Rumskoder:** felgissade koder begränsas per IP (`LIMIT_FAILED_JOINS_PER_MINUTE`, 20), så ingen kan leta igenom koder för att hitta andras rum.
- **Origin:** sätt `ALLOWED_ORIGINS=https://dittspel.se` för att bara tillåta WebSocket-anslutningar från din egen sida.
- **Proxy:** IP-adressen läses från `X-Forwarded-For` (rätt bakom Fly, Render, Railway). Nås servern direkt utan proxy: sätt `TRUST_PROXY=0`, annars kan gränserna per IP kringgås.
- **Snygg avstängning:** vid `SIGTERM` får alla spelare beskedet att servern startas om innan anslutningarna stängs, och `/health` svarar 503.

## Profil och inställningar

Spelaren väljer namn och färg, och kan slå av ljud och vibration. Det sparas på enheten (`client/src/profile.ts`). I lobbyn trycker man på sig själv för att byta namn eller färg; upptagna färger går inte att välja, och ändringen syns direkt för alla (`{ t: "profile" }`). Mitt i en runda går det inte att ändra.

## Mobilkänsla

**QR-kod:** i lobbyn visar knappen QR-kod rummets länk som en stor QR-kod ([uqr](https://github.com/unjs/uqr)), så att de som sitter bredvid kan scanna värdens skärm.

`client/src/device.ts` har `keepAwake()` (skärmen slocknar inte under en runda), `vibrate()`, och ljud som fungerar på iOS: `unlockAudio()` anropas automatiskt vid knapptryck, sedan `playTone()` eller `playSound(url)`. Exempelspelet vibrerar och piper när du tar en prick.

## Saker som medvetet är enkla

- Rummen ligger i minnet, så en omstart av servern tömmer dem. Med flera serverinstanser behövs delat state (t.ex. Redis) eller "sticky" routing per rumskod.
- Hela tillståndet skickas varje tick. Bra upp till 8 spelare och små världar; för större spel, skicka bara förändringar.
- Klienten jämnar ut rörelser mellan uppdateringar men gissar inte framåt (ingen client-side prediction).
- Klient och server på olika domäner: bygg klienten med `VITE_WS_URL=wss://server.example/ws`.

Hosting: allt som kör en långlivad Node-process med WebSockets fungerar, t.ex. Fly.io, Render eller Railway (se [docs/nytt-spel.md](docs/nytt-spel.md#6-driftsätta)). Serverless-plattformar som Vercel passar inte för servern.
