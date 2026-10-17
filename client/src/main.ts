import "./style.css";
import { renderSVG } from "uqr";
import { type GameState, PLAYER_COLORS, type PlayerColor } from "../../game/logic.ts";
import * as gameUi from "../../game/ui.ts";
import { GameView } from "../../game/view.ts";
import {
  GAME_SETTINGS,
  type LobbyPlayer,
  type PublicRoom,
  type RoomPhase,
  type RoomSettings,
  type ServerMsg,
} from "../../shared/protocol.ts";
import { CODE_LENGTH, inviteFromUrl, normalizeRoomCode, roomCodeFromUrl, roomLink } from "../../shared/roomCode.ts";
import { Chat } from "./chat.ts";
import {
  type CameraFacing,
  keepAwake,
  micLevel,
  releaseAwake,
  startCamera,
  startMic,
  stopCamera,
  stopMic,
  unlockAudio,
} from "./device.ts";
import { reportErrors } from "./errors.ts";
import { type Connection, loadResume, OnlineConnection, SoloConnection } from "./net.ts";
import { loadProfile, loadSettings, saveProfile, saveSettings } from "./profile.ts";

const app = document.getElementById("app")!;
/** `pnpm build:solo` bygger en fristående HTML-fil utan server, t.ex. för att testa som artifact. */
const SOLO_ONLY = import.meta.env.VITE_SOLO_ONLY === "1";
// Solo-filen har ingen server att rapportera till.
if (!SOLO_ONLY) reportErrors();

// ---- Tillstånd ----
let conn: Connection | null = null;
let solo = false;
let code = "";
let me = "";
let hostId = "";
let players: LobbyPlayer[] = [];
let phase: RoomPhase | null = null;
let view: GameView | null = null;
let hud: HTMLElement | null = null;
let lastState: GameState | null = null;
/** Inbjudningsnyckeln till rummet vi är i (följer med i delad länk och QR-kod). */
let invite = "";
let roomSettings: RoomSettings = { visibility: "private", hasPassword: false, locked: false, game: {} };
/** Senaste försöket att gå med, så att vi kan fråga efter lösenord och försöka igen. */
let pendingJoin: { code: string; name: string } | null = null;
/** Visas listan "Hitta rum" just nu? Då ritas den om när svaret kommer. */
let browsing = false;
const chat = new Chat(
  app,
  (text) => conn?.send({ t: "chat", text }),
  () => me,
);

// ---- Skärmar ----
function showHome(error = "") {
  teardownGame();
  browsing = false;
  setUrl(null);
  const name = nameInput();
  const codeInput = h("input", {
    className: "code",
    placeholder: "KOD",
    maxLength: CODE_LENGTH,
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: false,
    enterKeyHint: "go",
  }) as HTMLInputElement;
  const err = h("div", { className: "error", textContent: error });
  const join = () => {
    const c = normalizeRoomCode(codeInput.value);
    if (!c) {
      err.textContent = `Koden är ${CODE_LENGTH} tecken.`;
      return;
    }
    joinRoom(c, name.value);
  };
  codeInput.addEventListener("keydown", (e) => e.key === "Enter" && join());

  render(
    h("div", { className: "screen" }, [
      h("h1", { textContent: "Spelet" }),
      h("p", {
        textContent: SOLO_ONLY
          ? "Testversion: bara solo-läge."
          : "Spela själv eller med kompisar. Dela koden eller länken så hamnar ni i samma rum.",
      }),
      h("div", { className: "spacer" }),
      name,
      button("Spela själv", "primary", () => startSolo(name.value)),
      ...(SOLO_ONLY
        ? []
        : [
            button("Skapa rum", "secondary", () => createRoom(name.value)),
            h("div", { className: "divider", textContent: "eller gå med" }),
            h("div", { className: "row" }, [codeInput, button("Gå med", "", join)]),
            button("Hitta publika rum", "ghost", () => {
              saveProfile({ name: name.value });
              showRoomList();
            }),
          ]),
      err,
      button("Profil och inställningar", "ghost", () => showSettings(false)),
    ]),
  );
}

function showJoinFromLink(c: string, linkInvite?: string) {
  const name = nameInput();
  render(
    h("div", { className: "screen" }, [
      h("h1", { textContent: "Gå med" }),
      h("p", { textContent: "Du har bjudits in till rummet" }),
      h("div", { className: "room-code", textContent: c }),
      h("div", { className: "spacer" }),
      name,
      button("Gå med i rummet", "primary", () => joinRoom(c, name.value, { invite: linkInvite })),
      button("Avbryt", "ghost", () => showHome()),
    ]),
  );
}

/** Rummet har lösenord och vi kom inte via länk eller QR-kod. */
function showPassword(c: string, name: string, error = "") {
  const input = h("input", {
    type: "password",
    placeholder: "Lösenord",
    maxLength: 32,
    autocomplete: "off",
    enterKeyHint: "go",
  }) as HTMLInputElement;
  const go = () => joinRoom(c, name, { password: input.value });
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  render(
    h("div", { className: "screen" }, [
      h("h1", { textContent: "Lösenord" }),
      h("p", { textContent: "Rummet är skyddat. Fråga värden om lösenordet, eller be om länken eller QR-koden." }),
      h("div", { className: "room-code", textContent: c }),
      h("div", { className: "spacer" }),
      input,
      h("div", { className: "error", textContent: error }),
      button("Gå med", "primary", go),
      button("Avbryt", "ghost", () => showHome()),
    ]),
  );
  input.focus();
}

/** Listan "Hitta rum": publika rum som går att gå med i. */
function showRoomList(rooms?: PublicRoom[]) {
  teardownGame();
  browsing = true;
  if (!rooms) {
    useConnection(online());
    solo = false;
    conn!.send({ t: "list" });
  }
  const name = savedName();
  const items = (rooms ?? []).map((r) => {
    const li = h("li", { className: "room" }, [
      h("span", { textContent: `${r.hasPassword ? "🔒 " : ""}${r.host}${/[sxz]$/i.test(r.host) ? "" : "s"} rum` }),
      h("span", {
        className: "tag",
        textContent: `${r.players}/${r.maxPlayers}${r.phase === "playing" ? " · spelar" : ""}`,
      }),
    ]);
    li.addEventListener("click", () => (r.hasPassword ? showPassword(r.code, name) : joinRoom(r.code, name)));
    return li;
  });
  render(
    h("div", { className: "screen" }, [
      h("h1", { textContent: "Hitta rum" }),
      h("p", {
        textContent: !rooms
          ? "Letar…"
          : items.length
            ? "Tryck på ett rum för att gå med."
            : "Inga publika rum just nu. Skapa ett eget!",
      }),
      h("ul", { className: "players" }, items),
      h("div", { className: "spacer" }),
      button("Uppdatera", "secondary", () => showRoomList()),
      button("Tillbaka", "ghost", () => showHome()),
    ]),
  );
}

function showLobby() {
  teardownGame();
  const isHost = me === hostId;
  render(
    h("div", { className: "screen" }, [
      h("p", { textContent: "Rumskod" }),
      h("div", { className: "room-code", textContent: code }),
      h("div", { className: "row" }, [
        button("Dela länk", "secondary", shareLink),
        button("QR-kod", "", showQr),
        button("Kopiera", "", () => copy(code, "Koden kopierad")),
      ]),
      h("div", { className: "chips" }, [
        h("span", { textContent: roomSettings.visibility === "public" ? "🌍 Publikt" : "🔗 Privat" }),
        ...(roomSettings.hasPassword ? [h("span", { textContent: "🔒 Lösenord" })] : []),
        ...(roomSettings.locked ? [h("span", { textContent: "⛔ Låst" })] : []),
        ...(isHost ? [button("Rumsinställningar", "ghost", showRoomSettings)] : []),
      ]),
      ...gameSettings(isHost),
      h("p", { textContent: `Spelare (${players.length})` }),
      h(
        "ul",
        { className: "players" },
        players.map((p) => {
          const canKick = isHost && p.id !== me;
          const tags = [
            p.id === hostId && "värd",
            !p.connected && "frånkopplad",
            p.id === me && "ändra ›",
            canKick && "ta bort ›",
          ];
          const cls = `${p.connected ? "" : "offline"} ${p.id === me ? "me" : ""} ${canKick ? "kickable" : ""}`;
          const li = h("li", { className: cls }, [
            h("span", { className: "dot", style: `background:${p.color}` }),
            h("span", { textContent: p.name + (p.id === me ? " (du)" : "") }),
            h("span", { className: "tag", textContent: tags.filter(Boolean).join(" · ") }),
          ]);
          // Tryck på dig själv för att byta namn eller färg.
          if (p.id === me) li.addEventListener("click", () => showSettings(true));
          // Värden trycker på en annan spelare för att ta bort hen.
          if (canKick) li.addEventListener("click", () => confirmKick(p));
          return li;
        }),
      ),
      chat.button("Chatt"),
      h("div", { className: "spacer" }),
      isHost
        ? button("Starta spelet", "primary", () => conn?.send({ t: "start" }))
        : h("p", { textContent: "Väntar på att värden startar…", style: "text-align:center" }),
      button("Lämna rummet", "ghost", leave),
    ]),
    true,
  );
}

/** Spelets inställningar i lobbyn: värden väljer med knappar, de andra ser vad som gäller. */
function gameSettings(isHost: boolean): HTMLElement[] {
  return GAME_SETTINGS.map((s) => {
    const current = roomSettings.game[s.key] ?? s.default;
    const label = (n: number) => `${n}${s.unit ? ` ${s.unit}` : ""}`;
    if (!isHost) return h("p", { textContent: `${s.label}: ${label(current)}` });
    return h("div", { className: "setting" }, [
      h("p", { textContent: s.label }),
      h(
        "div",
        { className: "row" },
        s.options.map((n) =>
          button(label(n), n === current ? "primary" : "", () => conn?.send({ t: "settings", game: { [s.key]: n } })),
        ),
      ),
    ]);
  });
}

/** Värdens inställningar: publikt/privat, lösenord och lås. */
function showRoomSettings() {
  const pub = toggle("Publikt (syns i Hitta rum)", roomSettings.visibility === "public");
  const lock = toggle("Lås rummet (inga nya spelare)", roomSettings.locked);
  const password = h("input", {
    type: "text",
    placeholder: roomSettings.hasPassword ? "Nytt lösenord (lämna tomt = behåll)" : "Lösenord (valfritt)",
    maxLength: 32,
    autocomplete: "off",
  }) as HTMLInputElement;
  const removePassword = toggle("Ta bort lösenordet", false);
  const close = () => overlay.remove();
  const save = () => {
    const pw = password.value.trim();
    conn?.send({
      t: "settings",
      visibility: pub.input.checked ? "public" : "private",
      locked: lock.input.checked,
      ...(removePassword.input.checked ? { password: null } : pw ? { password: pw } : {}),
    });
    close();
  };
  const overlay = h("div", { className: "overlay keep" }, [
    h("div", { className: "screen" }, [
      h("h2", { textContent: "Rumsinställningar" }),
      pub.row,
      password,
      ...(roomSettings.hasPassword ? [removePassword.row] : []),
      h("p", {
        textContent:
          "Med lösenord behöver den som går med via koden eller listan ange det. Länken och QR-koden släpper in direkt.",
      }),
      lock.row,
      button("Spara", "primary", save),
      button("Avbryt", "ghost", close),
    ]),
  ]);
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  app.append(overlay);
}

function showGame() {
  if (view) return;
  keepAwake();
  view = new GameView(me, (input) => conn?.send({ t: "input", input }));
  hud = h("div", { className: "hud-items" });
  render(
    h("div", { className: "game" }, [
      view.canvas,
      h("div", { className: "hud" }, [
        hud,
        h("div", { className: "hud-actions" }, [...(solo ? [] : [chat.button("")]), button("Lämna", "", leave)]),
      ]),
    ]),
  );
  if (lastState) onState(lastState);
}

function showResults() {
  showGame();
  const isHost = me === hostId;
  const { title, rows } = lastState ? gameUi.results(lastState, solo) : { title: "", rows: [] };
  const overlay = h("div", { className: "overlay" }, [
    h("div", { className: "screen" }, [
      h("h1", { textContent: title }),
      h(
        "ul",
        { className: "players" },
        rows.map((p, i) =>
          h("li", {}, [
            h("span", { className: "dot", style: `background:${p.color}` }),
            h("span", { textContent: `${i + 1}. ${p.name}` }),
            h("span", { className: "tag", textContent: p.detail }),
          ]),
        ),
      ),
      isHost
        ? button("Spela igen", "primary", () => conn?.send({ t: "start" }))
        : h("p", { textContent: "Väntar på att värden startar en ny runda…", style: "text-align:center" }),
      ...(solo ? [] : [chat.button("Chatt")]),
      button(solo ? "Till startsidan" : "Lämna rummet", "ghost", leave),
    ]),
  ]);
  app.querySelector(".game")?.append(overlay);
}

// ---- Handlingar ----
function startSolo(name: string) {
  const { color } = saveProfile({ name });
  solo = true;
  useConnection(new SoloConnection(name.trim() || "Du", color));
  conn!.send({ t: "create", name });
}

function createRoom(name: string) {
  const { color } = saveProfile({ name });
  solo = false;
  useConnection(online());
  conn!.send({ t: "create", name, color });
}

function joinRoom(c: string, name: string, extra: { invite?: string; password?: string } = {}) {
  const { color } = saveProfile({ name });
  solo = false;
  browsing = false;
  pendingJoin = { code: c, name };
  useConnection(online());
  conn!.send({ t: "join", code: c, name, color, ...extra });
}

/**
 * Profil (namn, färg) och inställningar (ljud, vibration).
 * I ett rum skickas profilen till servern direkt; färger som andra redan har går inte att välja.
 */
function showSettings(inRoom: boolean) {
  const profile = loadProfile();
  const settings = loadSettings();
  const mine = players.find((p) => p.id === me);
  const name = nameInput();
  if (inRoom && mine) name.value = mine.name;
  let color: PlayerColor | undefined = (inRoom ? mine?.color : profile.color) as PlayerColor | undefined;
  const taken = new Set(inRoom ? players.filter((p) => p.id !== me).map((p) => p.color) : []);

  const swatches = PLAYER_COLORS.map((c) => {
    const b = h("button", {
      className: "swatch",
      style: `background:${c}`,
      ariaLabel: `Färg ${c}`,
      disabled: taken.has(c),
    }) as HTMLButtonElement;
    b.classList.toggle("selected", c === color);
    b.addEventListener("click", () => {
      color = c;
      for (const s of swatches) s.classList.toggle("selected", s === b);
    });
    return b;
  });
  const sound = toggle("Ljud", settings.sound);
  const vibration = toggle("Vibration", settings.vibration);
  const mic = micTest();
  const cam = cameraTest();

  const close = () => {
    mic.stop();
    cam.stop();
    overlay.remove();
  };
  const save = () => {
    saveProfile({ name: name.value, color });
    saveSettings({ sound: sound.input.checked, vibration: vibration.input.checked });
    if (inRoom) conn?.send({ t: "profile", name: name.value, color });
    close();
    if (!inRoom) showHome();
  };
  const overlay = h("div", { className: "overlay keep" }, [
    h("div", { className: "screen" }, [
      h("h2", { textContent: "Profil och inställningar" }),
      name,
      h("p", { textContent: "Färg" }),
      h("div", { className: "swatches" }, swatches),
      sound.row,
      vibration.row,
      mic.row,
      cam.row,
      button("Spara", "primary", save),
      button("Avbryt", "ghost", close),
    ]),
  ]);
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  app.append(overlay);
}

/** "Testa mikrofonen": ger tillåtelse i förväg och visar en mätare för spel som styrs av ljud. */
function micTest() {
  const bar = h("div");
  const meter = h("div", { className: "mic-meter", hidden: true }, [bar]);
  const info = h("p", { hidden: true });
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    stopMic();
  };
  const test = button("🎤 Testa mikrofonen", "", async () => {
    info.hidden = false;
    if (!window.isSecureContext) {
      info.textContent = "Mikrofonen fungerar bara när sidan öppnas via https, t.ex. med pnpm tunnel.";
      return;
    }
    info.textContent = "Startar…";
    if (!(await startMic())) {
      info.textContent = "Mikrofonen gick inte att starta. Tillåt mikrofonen för sidan i webbläsarens inställningar.";
      return;
    }
    test.hidden = true;
    meter.hidden = false;
    info.textContent = "Prata eller blås. Stapeln visar ljudnivån som spelet får.";
    const draw = () => {
      if (!meter.isConnected) return stop();
      bar.style.width = `${Math.round(micLevel() * 100)}%`;
      frame = requestAnimationFrame(draw);
    };
    draw();
  });
  return { row: h("div", { className: "mic-test" }, [test, meter, info]), stop };
}

/** "Testa kameran": ger tillåtelse i förväg och visar bilden, för spel som använder kameran. */
function cameraTest() {
  const box = h("div", { className: "camera-preview", hidden: true });
  const info = h("p", { hidden: true });
  let facing: CameraFacing = "user";
  const show = async () => {
    info.hidden = false;
    if (!window.isSecureContext) {
      info.textContent = "Kameran fungerar bara när sidan öppnas via https, t.ex. med pnpm tunnel.";
      return;
    }
    info.textContent = "Startar…";
    const video = await startCamera(facing);
    if (!video) {
      info.textContent = "Kameran gick inte att starta. Tillåt kameran för sidan i webbläsarens inställningar.";
      return;
    }
    if (!box.isConnected) return stopCamera(); // panelen stängdes medan kameran startade
    video.classList.toggle("mirror", facing === "user"); // framkameran visas som en spegel
    box.replaceChildren(video);
    test.hidden = true;
    box.hidden = false;
    flip.hidden = false;
    info.textContent = "Så här ser spelet kamerabilden.";
  };
  const test = button("📷 Testa kameran", "", show);
  const flip = button("Byt kamera", "", () => {
    facing = facing === "user" ? "environment" : "user";
    show();
  });
  flip.hidden = true;
  return { row: h("div", { className: "mic-test" }, [test, box, flip, info]), stop: stopCamera };
}

function toggle(label: string, checked: boolean) {
  const input = h("input", { type: "checkbox", checked }) as HTMLInputElement;
  const row = h("label", { className: "toggle" }, [h("span", { textContent: label }), input]);
  return { row, input };
}

function leave() {
  conn?.send({ t: "leave" });
  chat.reset();
  if (solo) conn?.close();
  phase = null;
  showHome();
}

/** Stor QR-kod med rummets länk, så att de som sitter bredvid kan scanna värdens skärm. */
function confirmKick(p: LobbyPlayer) {
  const overlay = h("div", { className: "overlay" }, [
    h("div", { className: "screen" }, [
      h("h2", { textContent: `Ta bort ${p.name}?` }),
      h("p", {
        textContent: roomSettings.locked
          ? "Rummet är låst, så hen kan inte komma tillbaka."
          : "Hen kan gå med igen. Lås rummet om du vill hålla hen ute.",
      }),
      h("div", { className: "spacer" }),
      button("Ta bort", "primary", () => {
        conn?.send({ t: "kick", playerId: p.id });
        overlay.remove();
      }),
      button("Avbryt", "ghost", () => overlay.remove()),
    ]),
  ]);
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  app.append(overlay);
}

function showQr() {
  const qr = h("div", { className: "qr", ariaLabel: `QR-kod för rum ${code}` });
  qr.setAttribute("role", "img");
  const link = roomLink(location.origin, code, invite);
  qr.dataset.link = link;
  qr.innerHTML = renderSVG(link, { border: 2 }); // uqr ger en ren SVG-sträng
  const overlay = h("div", { className: "overlay keep" }, [
    h("div", { className: "screen" }, [
      h("p", { textContent: "Scanna med kameran för att gå med" }),
      qr,
      h("div", { className: "room-code", textContent: code }),
      button("Stäng", "ghost", () => overlay.remove()),
    ]),
  ]);
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  app.append(overlay);
}

async function shareLink() {
  const url = roomLink(location.origin, code, invite);
  if (navigator.share) {
    try {
      return await navigator.share({ title: "Spela med mig!", text: `Gå med i mitt rum: ${code}`, url });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  copy(url, "Länken kopierad");
}

// ---- Meddelanden från servern ----
let onlineConn: OnlineConnection | null = null;
function online(): OnlineConnection {
  if (!onlineConn) {
    onlineConn = new OnlineConnection();
    onlineConn.onMessage(onMessage);
    onlineConn.onStatus((ok) => !ok && phase && toast("Tappade anslutningen, försöker igen…"));
  }
  return onlineConn;
}

function useConnection(c: Connection) {
  if (conn && conn !== c && conn instanceof SoloConnection) conn.close();
  conn = c;
  if (c instanceof SoloConnection) c.onMessage(onMessage);
}

function onMessage(msg: ServerMsg) {
  // Ignorera sena meddelanden från en anslutning vi inte längre använder.
  if ((msg.t !== "error" && solo !== conn instanceof SoloConnection) || !conn) return;
  switch (msg.t) {
    case "joined":
      if (msg.code !== code) chat.reset(); // nytt rum; vid återanslutning behålls chatten
      code = msg.code;
      me = msg.you;
      invite = msg.invite;
      pendingJoin = null;
      if (!solo) setUrl(code);
      break;
    case "lobby": {
      const prev = phase;
      players = msg.players;
      hostId = msg.hostId;
      phase = msg.phase;
      roomSettings = msg.settings;
      if (solo && phase === "lobby") return conn.send({ t: "start" }); // solo hoppar över lobbyn
      if (phase === "lobby") showLobby();
      else if (phase === "playing") {
        if (prev !== "playing") {
          teardownGame();
          lastState = null;
        }
        showGame();
      } else if (phase === "finished" && prev !== "finished") showResults();
      break;
    }
    case "state":
      onState(msg.state);
      break;
    case "rooms":
      if (browsing) showRoomList(msg.rooms);
      break;
    case "chat":
      chat.receive(msg.messages, msg.history);
      break;
    case "error":
      if (msg.code === "outdated") return reloadForNewVersion();
      if ((msg.code === "password_required" || msg.code === "wrong_password") && pendingJoin) {
        return showPassword(pendingJoin.code, pendingJoin.name, msg.code === "wrong_password" ? msg.message : "");
      }
      if (msg.code === "locked" || msg.code === "kicked") {
        phase = null;
        return showHome(msg.message);
      }
      if (msg.code === "not_found" || msg.code === "full" || msg.code === "server_restart") {
        phase = null;
        showHome(msg.message);
      } else toast(msg.message);
      break;
  }
}

/** Ny version driftsatt: ladda om en gång (skyddat mot omladdningsloopar). */
function reloadForNewVersion() {
  const KEY = "spelet.reloadedAt";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
  if (Date.now() - last > 30_000) return location.reload();
  phase = null;
  showHome("Det finns en ny version. Ladda om sidan.");
}

function onState(state: GameState) {
  gameUi.feedback(lastState, state, me);
  lastState = state;
  view?.setState(state);
  if (hud) {
    const texts = gameUi.hud(state, me);
    while (hud.children.length < texts.length) hud.append(h("span"));
    while (hud.children.length > texts.length) hud.lastElementChild?.remove();
    texts.forEach((t, i) => {
      hud!.children[i].textContent = t;
    });
  }
}

// ---- Hjälpfunktioner ----
function teardownGame() {
  releaseAwake();
  stopMic();
  stopCamera();
  view?.destroy();
  view = null;
  hud = null;
}

function setUrl(c: string | null) {
  if (SOLO_ONLY) return;
  const path = c ? `/r/${c}` : "/";
  if (location.pathname + location.search !== path) history.replaceState(null, "", path);
}

function nameInput(): HTMLInputElement {
  return h("input", {
    placeholder: "Ditt namn",
    maxLength: 16,
    value: savedName(),
    autocomplete: "nickname",
    enterKeyHint: "done",
  }) as HTMLInputElement;
}

function savedName(): string {
  return loadProfile().name;
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt("Kopiera:", text);
  }
}

function toast(text: string) {
  const el = h("div", { className: "toast", textContent: text });
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

/** Byt skärm. keepOverlays: behåll öppna paneler (t.ex. inställningar) när lobbyn ritas om. */
function render(el: HTMLElement, keepOverlays = false) {
  const keep = keepOverlays ? [...app.querySelectorAll(":scope > .overlay.keep")] : [];
  app.replaceChildren(el, ...keep);
}

function button(label: string, kind: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", { className: kind, textContent: label }) as HTMLButtonElement;
  b.addEventListener("click", () => {
    unlockAudio(); // iOS kräver en tryckning innan ljud får spelas
    onClick();
  });
  return b;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") el.setAttribute("style", String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  el.append(...children);
  return el;
}

// ---- Start: öppnades spelet via en delad länk? ----
const linkedCode = SOLO_ONLY ? null : roomCodeFromUrl(new URL(location.href));
if (linkedCode && loadResume(linkedCode))
  joinRoom(linkedCode, savedName()); // omladdad flik: tillbaka in direkt
else if (linkedCode) showJoinFromLink(linkedCode, inviteFromUrl(new URL(location.href)));
else showHome();
