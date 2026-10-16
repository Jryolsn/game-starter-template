# När spelet växer

Templaten innehåller bara det nästan alla spel behöver. Här är det som ofta tillkommer, när det är värt det och var det passar in. Lägg till det i spelets eget repo, inte i templaten.

## Grafik

| Behov | Välj | Passar in |
| --- | --- | --- |
| Enkla former, få objekt (som exemplet) | Canvas 2D (redan med) | `client/src/gameView.ts` |
| Sprites, animationer, partiklar, många objekt | [PixiJS](https://pixijs.com) | Byt ut `GameView.draw()`. Spellogiken och nätverket påverkas inte. |
| Fysik, scener, tilemaps, inbyggd input | [Phaser](https://phaser.io) | Låt Phaser äga canvasen, men skicka input via `conn.send({ t: "input" })` och rita från serverns state. Använd inte Phasers fysik för multiplayer: fysiken ska köras i `shared/game.ts`. |
| Fysik i spellogiken (studs, kollisioner) | [Rapier](https://rapier.rs) (WASM, finns i deterministisk variant) eller [Matter.js](https://brm.io/matter-js) | Körs i `tick()` så att servern och solo-läget räknar likadant. |
| Quiz, kort, brädspel | Vanlig HTML/CSS | Rita med DOM i stället för canvas; `GameView` kan bytas mot en komponent som renderar `GameState`. |

## Menyer och UI

Börjar lobbyn, inställningar och resultatskärmar växa (formulär, listor, flera vyer) är ett litet UI-ramverk värt det:

- [Preact](https://preactjs.com) (4 kB, React-API) eller [Svelte](https://svelte.dev) (kompileras bort).
- Behåll canvas och nätverk som de är. Låt UI-ramverket rendera utifrån `lobby`- och `state`-meddelandena.

## Ljud

`client/src/device.ts` räcker för korta effekter. Behövs musik med loopar, övertoning, ljudsprites eller många samtidiga ljud: [Howler.js](https://howlerjs.com). Lås fortfarande upp ljudet vid första tryckningen (iOS).

## Nätverk och prestanda

| Symptom | Åtgärd |
| --- | --- |
| Den egna figuren känns seg på dålig uppkoppling | **Client-side prediction:** kör `applyInput` + `tick` lokalt för den egna spelaren direkt och stäm av mot serverns state när det kommer. |
| Stora världar eller många spelare: för mycket data | Skicka bara det som ändrats (delta) i stället för hela `GameState` varje tick, och/eller sänk `TICK_HZ`. |
| JSON blir för stort eller långsamt | [MessagePack](https://msgpack.org) (`msgpackr`) i stället för JSON. Byt i `net.ts` och `server/index.ts`. |
| Du vill ha allt detta färdigt | [Colyseus](https://colyseus.io): rum, matchmaking, delta-synk och återanslutning. Kräver att spellogiken skrivs om enligt deras state-modell. |

## Drift och skala

- **En server räcker långt.** En Node-process klarar normalt hundratals rum med den här modellen.
- **Flera servrar:** rummen ligger i minnet, så antingen styr man varje rumskod till samma instans (t.ex. Fly.io `fly-replay`), eller lägger rumsstate i [Redis](https://redis.io).
- **Rum som överlever omstart:** spara `GameState` i Redis eller en databas vid varje runda.
- **Fly.io:** `fly launch` skapar `fly.toml` från Dockerfilen. Sätt `min_machines_running = 1` och kör en maskin så länge rummen ligger i minnet.

## Konton och sociala funktioner

Templaten har inga konton: den som har koden kommer in.

- **Inloggning, topplistor, profiler:** en separat webbplats eller ett API bredvid spelservern, t.ex. Next.js eller [Supabase](https://supabase.com) (auth + databas). Spelservern kan verifiera en token i `join`-meddelandet.
- **Sparade framsteg utan konto:** `localStorage` på klienten räcker ofta.
- **Kasta ut spelare / låsa rummet:** lägg till meddelanden i `ClientMsgSchema` (t.ex. `{ t: "kick", playerId }`) och kontrollera att avsändaren är värd i `server/rooms.ts`, på samma sätt som `start`.

## Övervakning

- **Fel i webbläsare och server:** [Sentry](https://sentry.io) eller liknande när spelet har riktiga spelare.
- **Hälsa:** `/health` finns redan; koppla den till plattformens hälsokontroll eller en extern uptime-tjänst.
- **Statistik:** något integritetsvänligt som [Plausible](https://plausible.io) räcker oftast för en spelsida.

## Mobil

- **Installera som app (PWA):** manifestet finns. Lägg till en service worker, t.ex. med [vite-plugin-pwa](https://vite-pwa-org.netlify.app), för att solo-läget ska fungera offline.
- **App Store / Google Play:** [Capacitor](https://capacitorjs.com) paketerar klienten som en riktig app. Servern är densamma.
- **Liggande läge:** ändra `WORLD` i `game.ts` och `orientation` i `client/public/manifest.webmanifest`.
