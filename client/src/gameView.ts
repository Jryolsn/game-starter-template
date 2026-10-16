// Ritar spelet på en canvas och läser styrning från touch (virtuell joystick) och tangentbord.

import type { PlayerInput } from "../../shared/game.ts";
import * as game from "../../shared/game.ts";

const JOYSTICK_RADIUS = 48; // px

export class GameView {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private state?: game.GameState;
  /** Utritade positioner som glider mot serverns, så rörelser blir mjuka trots 20 uppdateringar/s. */
  private shown = new Map<string, { x: number; y: number }>();
  private stick?: { id: number; ox: number; oy: number; x: number; y: number };
  private keys = new Set<string>();
  private lastSent: PlayerInput = { x: 0, y: 0 };
  private frame = 0;
  private lastTime = performance.now();
  private scale = 1;
  private offset = { x: 0, y: 0 };

  constructor(
    private me: string,
    private sendInput: (input: PlayerInput) => void,
  ) {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (this.stick) return;
      c.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    });
    c.addEventListener("pointermove", (e) => {
      if (this.stick?.id !== e.pointerId) return;
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
      this.updateInput();
    });
    const end = (e: PointerEvent) => {
      if (this.stick?.id !== e.pointerId) return;
      this.stick = undefined;
      this.updateInput();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.frame = requestAnimationFrame(this.draw);
  }

  setState(state: game.GameState): void {
    this.state = state;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("resize", this.resize);
  }

  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) return;
    e.preventDefault();
    if (e.type === "keydown") this.keys.add(k);
    else this.keys.delete(k);
    this.updateInput();
  };

  private updateInput(): void {
    let input: PlayerInput = { x: 0, y: 0 };
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > 6) {
        const k = Math.min(1, len / JOYSTICK_RADIUS) / len;
        input = { x: dx * k, y: dy * k };
      }
    } else {
      const has = (...ks: string[]) => ks.some((k) => this.keys.has(k));
      input = {
        x: (has("arrowright", "d") ? 1 : 0) - (has("arrowleft", "a") ? 1 : 0),
        y: (has("arrowdown", "s") ? 1 : 0) - (has("arrowup", "w") ? 1 : 0),
      };
    }
    // Skicka bara när något faktiskt ändrats, avrundat för att spara bandbredd.
    input = { x: Math.round(input.x * 20) / 20, y: Math.round(input.y * 20) / 20 };
    if (input.x === this.lastSent.x && input.y === this.lastSent.y) return;
    this.lastSent = input;
    this.sendInput(input);
  }

  private resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // Anpassa världen till skärmen med bevarade proportioner.
    this.scale = Math.min(w / game.WORLD.width, (h - 56) / game.WORLD.height) * dpr;
    this.offset = {
      x: (this.canvas.width - game.WORLD.width * this.scale) / 2,
      y: (this.canvas.height - game.WORLD.height * this.scale) / 2 + 28 * dpr,
    };
  };

  private draw = (now: number) => {
    this.frame = requestAnimationFrame(this.draw);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const { ctx, scale, offset } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#14121f";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const state = this.state;
    if (!state) return;

    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);
    ctx.fillStyle = "#1c1930";
    ctx.strokeStyle = "#ffffff22";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(0, 0, game.WORLD.width, game.WORLD.height, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffd166";
    for (const c of state.coins) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, game.RADII.coin, 0, Math.PI * 2);
      ctx.fill();
    }

    const k = 1 - Math.exp(-dt * 18);
    for (const id of this.shown.keys()) if (!state.players[id]) this.shown.delete(id);
    for (const p of Object.values(state.players)) {
      const s = this.shown.get(p.id) ?? { x: p.x, y: p.y };
      s.x += (p.x - s.x) * k;
      s.y += (p.y - s.y) * k;
      this.shown.set(p.id, s);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, game.RADII.player, 0, Math.PI * 2);
      ctx.fill();
      if (p.id === this.me) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.fillStyle = "#f4f1ff";
      ctx.font = "600 3.2px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${p.name} · ${p.score}`, s.x, s.y - game.RADII.player - 1.6);
    }

    // Joysticken där tummen landade.
    if (this.stick) {
      const dpr = this.canvas.width / window.innerWidth;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "#ffffff44";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.stick.ox, this.stick.oy, JOYSTICK_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const len = Math.hypot(dx, dy);
      const m = len > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / len : 1;
      ctx.fillStyle = "#ffffff55";
      ctx.beginPath();
      ctx.arc(this.stick.ox + dx * m, this.stick.oy + dy * m, 22, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}
