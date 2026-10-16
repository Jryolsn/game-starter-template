# Driftsätta ett spel

Templaten har ingen färdig konfiguration för någon värd. Containern i `Dockerfile` kör hela spelet (klient och server) i en process på port 8080. `/health` finns för hälsokontroller. Allt som kör en långlivad container med WebSockets fungerar. Serverless-plattformar som Vercel fungerar inte.

Tre saker gäller oavsett värd:

- **En instans.** Rummen ligger i processens minne, så två instanser ser inte varandras rum (se [När spelet växer](nar-spelet-vaxer.md#drift-och-skala)).
- **Låt den inte somna.** En maskin som stängs av när den är inaktiv tömmer alla rum.
- **Sätt `ALLOWED_ORIGINS`** till spelets adress, t.ex. `https://mittspel.fly.dev`, så att andra sidor inte kan ansluta till servern.

Loggarna är JSON-rader (se `server/log.ts`). Sök på `"level":"error"` eller `client_error` i värdens loggvy.

## Gratis för hobbyprojekt

Ingen gratisvärd håller en spelserver vaken dygnet runt. Det här är de gratis vägar som finns:

| Läge | Hur | Nackdel |
| --- | --- | --- |
| Spelkväll med kompisar | Din egen dator och en tunnel (nedan) | Spelet finns bara medan datorn är igång |
| Alltid nåbar, får vara långsam att vakna | Render, gratisnivån (nedan) | Somnar efter 15 minuter utan besök, tar ungefär en minut att vakna, och rummen försvinner |
| Bara solo | Vercel, Netlify eller GitHub Pages med `pnpm build:solo` | Inget multiplayer, eftersom det inte finns någon server |

Priser och gratisnivåer ändras ofta, så kontrollera dem hos värden innan du väljer.

### Din egen dator och en tunnel

En tunnel ger din dator en tillfällig offentlig https-adress, så att vem som helst kan ansluta via länken eller QR-koden. [Cloudflare Tunnel](https://github.com/cloudflare/cloudflared) är gratis, kräver inget konto och stödjer WebSockets.

Installera `cloudflared` en gång: `brew install cloudflared` (macOS) eller `winget install Cloudflare.cloudflared` (Windows). Kör sedan:

```bash
pnpm tunnel
```

Kommandot bygger spelet, startar servern och tunneln och skriver ut en adress som `https://något-slumpat.trycloudflare.com` och en QR-kod i terminalen. Dela adressen, eller skapa ett rum och visa rummets QR-kod. Ctrl+C stänger allt. Adressen byts varje gång tunneln startas.

### Render, gratisnivån

Som stegen för Render nedan, men välj **Free** som instans. Bra för att ha en demo uppe utan kostnad. Den som kommer först efter en paus väntar ungefär en minut, och pågående rum försvinner när tjänsten somnar.

## Fly.io

Rekommenderas när spelet ska vara vaket hela tiden (ungefär 2 dollar i månaden för den minsta maskinen). Fly har ingen gratisnivå, bara en kort provperiod. Region i Stockholm (`arn`) och bra stöd för WebSockets.

```bash
fly launch --no-deploy --region arn   # skapar fly.toml från Dockerfilen
```

Ändra i `fly.toml`:

```toml
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"   # en stoppad maskin tömmer rummen
  min_machines_running = 1

[[http_service.checks]]
  path = "/health"
  interval = "15s"
  timeout = "2s"
```

```bash
fly secrets set ALLOWED_ORIGINS=https://mittspel.fly.dev
fly deploy
fly scale count 1
fly logs
```

**Driftsätt automatiskt från main:** skapa en token med `fly tokens create deploy`, lägg den som GitHub-hemligheten `FLY_API_TOKEN` och lägg till ett jobb i `.github/workflows/ci.yml`:

```yaml
  deploy:
    needs: [check, e2e]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Render

Enklast att klicka igång.

1. **New → Web Service**, välj repot och **Docker** som runtime. Välj region Frankfurt.
2. **Health Check Path:** `/health`.
3. **Environment:** `ALLOWED_ORIGINS=https://mittspel.onrender.com`.
4. Välj **Starter** (betald) för en tjänst som alltid är vaken, eller **Free** för en demo som får somna (se ovan).

Render driftsätter automatiskt vid varje push till main. Stäng av det under **Settings → Auto-Deploy** om CI ska vara grön först, och använd i stället en deploy hook från ett CI-jobb.

## Railway

Liknar Render: nytt projekt från repot, Railway hittar Dockerfilen. Sätt `ALLOWED_ORIGINS` under **Variables** och health check till `/health`.

## Egen domän

Alla tre har egen domän under inställningarna. Lägg till den nya adressen i `ALLOWED_ORIGINS`, kommaseparerat.
