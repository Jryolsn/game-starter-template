# När spelet växer

Templaten innehåller bara det nästan alla spel behöver. Här är det som ofta tillkommer, när det är värt det och var det passar in. Lägg till det i spelets eget repo, inte i templaten.

## Grafik

| Behov | Välj | Passar in |
| --- | --- | --- |
| Enkla former, få objekt (som exemplet) | Canvas 2D (redan med) | `game/view.ts` |
| Sprites, animationer, partiklar, många objekt | [PixiJS](https://pixijs.com) | Byt ut `GameView.draw()`. Spellogiken och nätverket påverkas inte. |
| Fysik, scener, tilemaps, inbyggd input | [Phaser](https://phaser.io) | Låt Phaser äga canvasen, men skicka input via `conn.send({ t: "input" })` och rita från serverns state. Använd inte Phasers fysik för multiplayer: fysiken ska köras i `game/logic.ts`. |
| Fysik i spellogiken (studs, kollisioner) | [Rapier](https://rapier.rs) (WASM, finns i deterministisk variant) eller [Matter.js](https://brm.io/matter-js) | Körs i `tick()` så att servern och solo-läget räknar likadant. |
| Quiz, kort, brädspel | Vanlig HTML/CSS | Rita med DOM i stället för canvas; `GameView` kan bytas mot en komponent som renderar `GameState`. |

## Menyer och UI

Börjar lobbyn, inställningar och resultatskärmar växa (formulär, listor, flera vyer) är ett litet UI-ramverk värt det:

- [Preact](https://preactjs.com) (4 kB, React-API) eller [Svelte](https://svelte.dev) (kompileras bort).
- Behåll canvas och nätverk som de är. Låt UI-ramverket rendera utifrån `lobby`- och `state`-meddelandena.

## Ljud

`client/src/device.ts` räcker för korta effekter. Behövs musik med loopar, övertoning, ljudsprites eller många samtidiga ljud: [Howler.js](https://howlerjs.com). Lås fortfarande upp ljudet vid första tryckningen (iOS).

Spel som styrs av hur högt det låter har redan stöd i mallen: `startMic()` och `micLevel()` i `client/src/device.ts`, se [nytt-spel.md](nytt-spel.md#mikrofon-ljudnivå-som-styrning). Behöver spelet mer än nivån, t.ex. tonhöjd för ett sångspel, läs frekvenserna från samma `AnalyserNode` med `getFloatFrequencyData`, eller använd [Pitchy](https://github.com/ianprime0509/pitchy).

## Röstchatt

Mallen har ingen röstchatt, eftersom det är mycket drift för något många spel klarar sig utan (kompisar sitter ofta bredvid varandra eller använder Discord).

**Hur det fungerar:** rösten skickas med [WebRTC](https://developer.mozilla.org/docs/Web/API/WebRTC_API) direkt mellan telefonerna. Spelservern behövs bara för att para ihop dem (signalering: de byter några meddelanden via WebSocketen). Två problem dyker upp i praktiken:

- **Alla når inte varandra direkt.** Ungefär var femte mobilanslutning sitter bakom ett nät som stoppar direktkontakt. Då behövs en reläserver (TURN) som skickar ljudet vidare. Den kostar trafik och är en egen sak att driva.
- **Många spelare blir tungt.** Om alla pratar direkt med alla skickar varje telefon sitt ljud till varje annan spelare. Över 4–5 spelare blir det för mycket för en mobil, och då behövs en server som tar emot och fördelar ljudet (SFU).

| Behov | Välj | Passar in |
| --- | --- | --- |
| Röstchatt utan egen drift | [LiveKit Cloud](https://livekit.io) (gratisnivå) | Spelservern skapar en LiveKit-token per spelare och rum (t.ex. i `welcome`-meddelandet), klienten ansluter med `livekit-client` med rumskoden som rumsnamn. LiveKit sköter relä och fördelning. |
| Bara 2–4 spelare och vill testa själv | WebRTC direkt + gratis STUN | Skicka WebRTC-erbjudanden som nya meddelanden i `ClientMsgSchema` och vidarebefordra dem i `server/rooms.ts` bara till spelare i samma rum. Räkna med att vissa inte kommer att höras utan TURN. |
| Egen TURN-server | [coturn](https://github.com/coturn/coturn) eller Cloudflare Calls/TURN | När direktvarianten ska fungera för alla. |

Tänk på: röst kräver https och spelarens tillåtelse precis som mikrofonnivån, iOS kräver en tryckning för att starta, och en tryckknapp för att prata ("håll in för att prata") är ofta bättre än öppen mikrofon i ett rum fullt av folk.

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
- **Infrastruktur som kod (Pulumi, Terraform):** inte värt det för en enda container; plattformens konfigfil (t.ex. `fly.toml`) räcker. Ta in det när spelet har flera delar som ska hållas ihop, t.ex. server + databas + Redis + DNS, eller flera miljöer (test och produktion).

## Konton och sociala funktioner

Templaten har inga konton: den som har koden kommer in.

- **Inloggning, topplistor, profiler:** en separat webbplats eller ett API bredvid spelservern, t.ex. Next.js eller [Supabase](https://supabase.com) (auth + databas). Spelservern kan verifiera en token i `join`-meddelandet.
- **Sparade framsteg utan konto:** `localStorage` på klienten räcker ofta.
- **Chatt med okända:** textchatten finns, men med publika rum och främlingar behövs mer: ett ordfilter på servern (i `RoomManager.chat()`), att kunna tysta en spelare för sig själv, och att anmäla. Barn som målgrupp: överväg bara snabbfraser.
- **Fler värdfunktioner** (t.ex. byta värd, tysta chatt): lägg till meddelanden i `ClientMsgSchema` och kontrollera att avsändaren är värd i `server/rooms.ts`, på samma sätt som `kick` och `settings`.

## Övervakning

- **Loggar finns redan:** servern skriver JSON-rader (`server/log.ts`) och tar emot fel från webbläsarna (`client/src/errors.ts` → `POST /log`). Läs dem i plattformens loggvy, t.ex. `fly logs`, och sök på `"level":"error"` eller `client_error`.
- **Mer än loggar:** [Sentry](https://sentry.io) eller liknande när spelet har riktiga spelare och du vill ha larm, gruppering av fel och källkodsrader. Lägg anropet i `report()` i `client/src/errors.ts` och bredvid `log.error` på servern.
- **Hälsa:** `/health` finns redan; koppla den till plattformens hälsokontroll eller en extern uptime-tjänst.
- **Statistik:** något integritetsvänligt som [Plausible](https://plausible.io) räcker oftast för en spelsida.

## Mobil

- **Installera som app (PWA):** manifestet finns. Lägg till en service worker, t.ex. med [vite-plugin-pwa](https://vite-pwa-org.netlify.app), för att solo-läget ska fungera offline.
- **App Store / Google Play:** [Capacitor](https://capacitorjs.com) paketerar klienten som en riktig app. Servern är densamma.
- **Liggande läge:** ändra `WORLD` i `game/logic.ts` och `orientation` i `client/public/manifest.webmanifest`.
