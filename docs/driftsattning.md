# Driftsätta ett spel

Templaten har ingen färdig konfiguration för någon värd. Containern i `Dockerfile` kör hela spelet (klient och server) i en process på port 8080. `/health` finns för hälsokontroller. Allt som kör en långlivad container med WebSockets fungerar. Serverless-plattformar som Vercel fungerar inte.

Tre saker gäller oavsett värd:

- **En instans.** Rummen ligger i processens minne, så två instanser ser inte varandras rum (se [När spelet växer](nar-spelet-vaxer.md#drift-och-skala)).
- **Låt den inte somna.** En maskin som stängs av när den är inaktiv tömmer alla rum.
- **Sätt `ALLOWED_ORIGINS`** till spelets adress, t.ex. `https://mittspel.fly.dev`, så att andra sidor inte kan ansluta till servern.

Loggarna är JSON-rader (se `server/log.ts`). Sök på `"level":"error"` eller `client_error` i värdens loggvy.

## Fly.io

Rekommenderas: billigt, region i Stockholm (`arn`) och bra stöd för WebSockets.

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
4. Välj en betald instans (Starter). Gratisnivån somnar efter en stunds inaktivitet och tappar då rummen.

Render driftsätter automatiskt vid varje push till main. Stäng av det under **Settings → Auto-Deploy** om CI ska vara grön först, och använd i stället en deploy hook från ett CI-jobb.

## Railway

Liknar Render: nytt projekt från repot, Railway hittar Dockerfilen. Sätt `ALLOWED_ORIGINS` under **Variables** och health check till `/health`.

## Egen domän

Alla tre har egen domän under inställningarna. Lägg till den nya adressen i `ALLOWED_ORIGINS`, kommaseparerat.
