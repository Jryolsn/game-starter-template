# Mallen och spelen: hålla dem i takt

Varje spel börjar som en kopia av mallen. Med tiden hittar man saker i ett spel som alla spel borde ha. Den här guiden visar hur förbättringen hamnar i mallen, och hur andra spel sedan hämtar den, utan att kopiera kod för hand.

Grundidén: spelets repo har mallen som en extra remote, `template`, och delar historik med den. Då fungerar vanliga `git merge` och `git cherry-pick` åt båda hållen.

## Skapa ett spel med delad historik

Knappen **Use this template** på GitHub skapar ett repo *utan* mallens historik. Det gör senare sammanslagningar onödigt svåra. Skapa i stället ett tomt repo (utan README) och kör:

```bash
git clone https://github.com/Jryolsn/game-starter-template.git mitt-spel
cd mitt-spel
git remote rename origin template
git remote add origin https://github.com/Jryolsn/mitt-spel.git
git push -u origin main
pnpm install
```

Redan skapat med knappen? Koppla ihop historiken en gång, lös konflikterna och fortsätt sedan som nedan:

```bash
git remote add template https://github.com/Jryolsn/game-starter-template.git
git fetch template
git merge template/main --allow-unrelated-histories
```

## Hämta nyheter från mallen till ett spel

```bash
git fetch template
git merge template/main
```

Konflikter uppstår bara där spelet och mallen har ändrat samma rader. Därför lönar det sig att hålla spelets kod åtskild (se nedan).

## Skicka en förbättring från spelet till mallen

1. Gör förbättringen som en **egen commit** som bara rör generell kod, utan spelspecifika saker. Blanda inte in spelets ändringar i samma commit.
2. Lägg den på en gren från mallen och skicka den dit:

```bash
git switch -c mall/battre-ateranslutning template/main
git cherry-pick <commit>
pnpm install && pnpm lint && pnpm typecheck && pnpm test
git push template mall/battre-ateranslutning
```

3. Öppna en PR i `game-starter-template` från grenen. När den är sammanslagen: `git switch main && git fetch template && git merge template/main` i spelet. Ändringen finns redan i spelet, så sammanslagningen går igenom utan konflikt.

Behövde förbättringen anpassas för att passa mallen (till exempel för att den rörde spelets kod)? Gör anpassningen i grenen innan du pushar. Spelet får den anpassade versionen vid nästa sammanslagning.

## Vad är mallens och vad är spelets?

| Typiskt spelets egna (ändras fritt) | Typiskt mallens (förbättra här, skicka uppåt) |
| --- | --- |
| `shared/game.ts` | `server/` (rum, gränser, validering) |
| `client/src/gameView.ts` | `client/src/net.ts`, `device.ts`, `profile.ts` |
| Spelets namn, ikon, färger | `shared/protocol.ts` (rum, lobby, inställningar) |
| Spelets egna skärmar | `shared/roomCode.ts`, `scripts/`, CI, Dockerfile |

`client/src/main.ts` och `style.css` delas av båda. Lägg gärna spelets egna skärmar i nya filer i stället för att bygga ut `main.ts`, så blir sammanslagningarna enklare.

Tumregel: om du skulle vilja ha ändringen i nästa spel också, gör den som en egen commit och skicka den till mallen.
