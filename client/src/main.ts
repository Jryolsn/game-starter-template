import "./style.css";
import { ranking, type GameState } from "../../shared/game.ts";
import type { LobbyPlayer, RoomPhase, ServerMsg } from "../../shared/protocol.ts";
import { CODE_LENGTH, normalizeRoomCode, roomCodeFromUrl, roomLink } from "../../shared/roomCode.ts";
import { GameView } from "./gameView.ts";
import { OnlineConnection, SoloConnection, loadResume, type Connection } from "./net.ts";

const app = document.getElementById("app")!;
const NAME_KEY = "spelet.name";
/** `npm run build:solo` bygger en fristående HTML-fil utan server, t.ex. för att testa som artifact. */
const SOLO_ONLY = import.meta.env.VITE_SOLO_ONLY === "1";

// ---- Tillstånd ----
let conn: Connection | null = null;
let solo = false;
let code = "";
let me = "";
let hostId = "";
let players: LobbyPlayer[] = [];
let phase: RoomPhase | null = null;
let view: GameView | null = null;
let hud: { time: HTMLElement; score: HTMLElement } | null = null;
let lastState: GameState | null = null;

// ---- Skärmar ----
function showHome(error = "") {
  teardownGame();
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
    if (!c) return (err.textContent = `Koden är ${CODE_LENGTH} tecken.`);
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
          ]),
      err,
    ]),
  );
}

function showJoinFromLink(c: string) {
  const name = nameInput();
  render(
    h("div", { className: "screen" }, [
      h("h1", { textContent: "Gå med" }),
      h("p", { textContent: "Du har bjudits in till rummet" }),
      h("div", { className: "room-code", textContent: c }),
      h("div", { className: "spacer" }),
      name,
      button("Gå med i rummet", "primary", () => joinRoom(c, name.value)),
      button("Avbryt", "ghost", () => showHome()),
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
        button("Kopiera kod", "", () => copy(code, "Koden kopierad")),
      ]),
      h("p", { textContent: `Spelare (${players.length})` }),
      h(
        "ul",
        { className: "players" },
        players.map((p) =>
          h("li", { className: p.connected ? "" : "offline" }, [
            h("span", { className: "dot", style: `background:${p.color}` }),
            h("span", { textContent: p.name + (p.id === me ? " (du)" : "") }),
            h("span", { className: "tag", textContent: p.id === hostId ? "värd" : p.connected ? "" : "frånkopplad" }),
          ]),
        ),
      ),
      h("div", { className: "spacer" }),
      isHost
        ? button("Starta spelet", "primary", () => conn?.send({ t: "start" }))
        : h("p", { textContent: "Väntar på att värden startar…", style: "text-align:center" }),
      button("Lämna rummet", "ghost", leave),
    ]),
  );
}

function showGame() {
  if (view) return;
  view = new GameView(me, (input) => conn?.send({ t: "input", input }));
  hud = { time: h("span"), score: h("span") };
  render(
    h("div", { className: "game" }, [
      view.canvas,
      h("div", { className: "hud" }, [hud.time, hud.score, button("Lämna", "", leave)]),
    ]),
  );
  if (lastState) onState(lastState);
}

function showResults() {
  showGame();
  const isHost = me === hostId;
  const top = lastState ? ranking(lastState) : [];
  const overlay = h("div", { className: "overlay" }, [
    h("div", { className: "screen" }, [
      h("h1", { textContent: solo ? `${top[0]?.score ?? 0} prickar!` : `${top[0]?.name ?? "?"} vann!` }),
      h(
        "ul",
        { className: "players" },
        top.map((p, i) =>
          h("li", {}, [
            h("span", { className: "dot", style: `background:${p.color}` }),
            h("span", { textContent: `${i + 1}. ${p.name}` }),
            h("span", { className: "tag", textContent: `${p.score} p` }),
          ]),
        ),
      ),
      isHost
        ? button("Spela igen", "primary", () => conn?.send({ t: "start" }))
        : h("p", { textContent: "Väntar på att värden startar en ny runda…", style: "text-align:center" }),
      button(solo ? "Till startsidan" : "Lämna rummet", "ghost", leave),
    ]),
  ]);
  app.querySelector(".game")?.append(overlay);
}

// ---- Handlingar ----
function startSolo(name: string) {
  saveName(name);
  solo = true;
  useConnection(new SoloConnection(name.trim() || "Du"));
  conn!.send({ t: "create", name });
}

function createRoom(name: string) {
  saveName(name);
  solo = false;
  useConnection(online());
  conn!.send({ t: "create", name });
}

function joinRoom(c: string, name: string) {
  saveName(name);
  solo = false;
  useConnection(online());
  conn!.send({ t: "join", code: c, name });
}

function leave() {
  conn?.send({ t: "leave" });
  if (solo) conn?.close();
  phase = null;
  showHome();
}

async function shareLink() {
  const url = roomLink(location.origin, code);
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
  if ((msg.t !== "error" && solo !== (conn instanceof SoloConnection)) || !conn) return;
  switch (msg.t) {
    case "joined":
      code = msg.code;
      me = msg.you;
      if (!solo) setUrl(code);
      break;
    case "lobby": {
      const prev = phase;
      players = msg.players;
      hostId = msg.hostId;
      phase = msg.phase;
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
    case "error":
      if (msg.code === "not_found" || msg.code === "full") {
        phase = null;
        showHome(msg.message);
      } else toast(msg.message);
      break;
  }
}

function onState(state: GameState) {
  lastState = state;
  view?.setState(state);
  if (hud) {
    hud.time.textContent = `⏱ ${Math.ceil(state.timeLeft)}`;
    hud.score.textContent = `● ${state.players[me]?.score ?? 0}`;
  }
}

// ---- Hjälpfunktioner ----
function teardownGame() {
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
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return ""; // lagring kan vara blockerad (privat läge, inbäddad sida)
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {}
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

function render(el: HTMLElement) {
  app.replaceChildren(el);
}

function button(label: string, kind: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", { className: kind, textContent: label }) as HTMLButtonElement;
  b.addEventListener("click", onClick);
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
if (linkedCode && loadResume(linkedCode)) joinRoom(linkedCode, savedName()); // omladdad flik: tillbaka in direkt
else if (linkedCode) showJoinFromLink(linkedCode);
else showHome();
