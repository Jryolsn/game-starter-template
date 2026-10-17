// Textchatt i rummet: en panel med meddelanden, snabbfraser och skrivfält, och pratbubblor
// som visas en stund när någon skriver medan panelen är stängd. Fungerar i lobbyn och under spelet.
import { CHAT_MAX_LENGTH, type ChatMessage } from "../../shared/protocol.ts";

/** Snabbfraser, så att man kan säga något utan att skriva (t.ex. mitt i spelet). Byt gärna mot spelets egna. */
export const QUICK_PHRASES = ["Hej!", "Bra!", "Vänta", "Kom igen!", "Snyggt!", "Oj!"];

/** Hur många meddelanden panelen visar. */
const SHOWN = 50;
const BUBBLE_MS = 4000;
const MAX_BUBBLES = 3;

export class Chat {
  private messages: ChatMessage[] = [];
  private unread = 0;
  private buttons = new Set<HTMLButtonElement>();
  private panel: { overlay: HTMLElement; list: HTMLElement } | null = null;
  private bubbles = el("div", "chat-bubbles");

  constructor(
    private root: HTMLElement,
    private send: (text: string) => void,
    /** Spelarens eget id, så att egna meddelanden inte blir bubblor. */
    private me: () => string,
  ) {}

  /** En knapp som öppnar chatten och visar antal olästa. Skapa en ny för varje skärm. */
  button(label: string, className = ""): HTMLButtonElement {
    const b = el("button", `chat-button ${className}`) as HTMLButtonElement;
    b.dataset.label = label;
    b.addEventListener("click", () => this.open());
    this.buttons.add(b);
    this.paint(b);
    return b;
  }

  receive(messages: ChatMessage[], history = false): void {
    const lastId = this.messages.at(-1)?.id ?? 0;
    const fresh = messages.filter((m) => m.id > lastId);
    if (!fresh.length) return;
    this.messages = [...this.messages, ...fresh].slice(-SHOWN);
    if (this.isOpen()) {
      this.renderList();
      return;
    }
    const others = fresh.filter((m) => m.from !== this.me());
    this.unread += others.length;
    this.updateButtons();
    if (!history) for (const m of others) this.bubble(m);
  }

  /** Töm chatten, t.ex. när man lämnar rummet. */
  reset(): void {
    this.messages = [];
    this.unread = 0;
    this.close();
    this.bubbles.replaceChildren();
    this.updateButtons();
  }

  open(): void {
    if (this.isOpen()) return;
    const input = el("input") as HTMLInputElement;
    Object.assign(input, {
      placeholder: "Skriv något…",
      maxLength: CHAT_MAX_LENGTH,
      autocomplete: "off",
      enterKeyHint: "send",
    });
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      this.send(text);
      input.value = "";
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    const phrases = QUICK_PHRASES.map((p) =>
      button(p, "", () => {
        this.send(p);
        this.close();
      }),
    );
    const list = el("ul", "chat-list");
    const overlay = el("div", "overlay keep chat-panel", [
      el("div", "screen", [
        el("h2", "", [], "Chatt"),
        list,
        el("div", "chat-phrases", phrases),
        el("div", "row", [input, button("Skicka", "secondary", submit)]),
        button("Stäng", "ghost", () => this.close()),
      ]),
    ]);
    overlay.addEventListener("click", (e) => e.target === overlay && this.close());
    this.panel = { overlay, list };
    this.root.append(overlay);
    this.unread = 0;
    this.updateButtons();
    this.renderList();
  }

  close(): void {
    this.panel?.overlay.remove();
    this.panel = null;
  }

  /** Panelen kan ha tagits bort när skärmen byttes (t.ex. när rundan startar). */
  private isOpen(): boolean {
    if (this.panel && !this.panel.overlay.isConnected) this.panel = null;
    return !!this.panel;
  }

  private renderList(): void {
    const list = this.panel!.list;
    list.replaceChildren(
      ...(this.messages.length
        ? this.messages.map((m) => line(m, m.from === this.me()))
        : [el("li", "chat-empty", [], "Inga meddelanden än. Säg hej!")]),
    );
    list.scrollTop = list.scrollHeight;
  }

  private bubble(m: ChatMessage): void {
    if (!this.bubbles.isConnected) document.body.append(this.bubbles);
    const b = el("div", "chat-bubble", [line(m, false)]);
    this.bubbles.append(b);
    while (this.bubbles.children.length > MAX_BUBBLES) this.bubbles.firstElementChild?.remove();
    setTimeout(() => b.remove(), BUBBLE_MS);
  }

  private updateButtons(): void {
    for (const b of this.buttons) {
      if (b.isConnected) this.paint(b);
      else this.buttons.delete(b); // knappen satt på en skärm som inte finns längre
    }
  }

  private paint(b: HTMLButtonElement): void {
    b.textContent = `💬${b.dataset.label ? ` ${b.dataset.label}` : ""}`;
    if (this.unread) b.append(el("span", "chat-badge", [], String(Math.min(this.unread, 99))));
  }
}

function line(m: ChatMessage, mine: boolean): HTMLElement {
  return el("li", mine ? "chat-line mine" : "chat-line", [
    el("span", "dot", [], "", `background:${m.color}`),
    el("span", "chat-text", [el("b", "", [], `${m.name}: `), document.createTextNode(m.text)]),
  ]);
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", className, [], label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

/** Text sätts alltid som textContent, så att ingen kan skicka HTML i chatten. */
function el(tag: string, className = "", children: Node[] = [], text = "", style = ""): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  if (style) e.setAttribute("style", style);
  e.append(...children);
  return e;
}
