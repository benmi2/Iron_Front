/**
 * Keyboard + mouse state. `down` is held state, `pressed` is edge-triggered for one fixed step
 * (cleared by `endStep`). Mouse position is kept in CSS pixels and NDC.
 */
export class Input {
  private held = new Set<string>();
  private edge = new Set<string>();
  private released = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  ndcX = 0;
  ndcY = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  rmbPressed = false;
  wheel = 0;
  /** relative mouse motion since the last `consumeMotion` (px; works under pointer lock) */
  private dx = 0;
  private dy = 0;
  /** set by gameplay: holding the right button captures the mouse (free gunner's sight) */
  rmbLocks = false;
  /** true while a text field / menu has focus: gameplay ignores keys */
  suspended = false;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      const k = this.key(e);
      if (!this.held.has(k)) this.edge.add(k);
      this.held.add(k);
      if (['Tab', 'Space', 'F1', 'F2'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = this.key(e);
      this.held.delete(k);
      this.released.add(k);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.lmb = this.rmb = false;
      this.unlockPointer();
    });
    // Esc / browser released the lock: end the sight view as if the button was let go
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.rmb = false;
    });
    el.addEventListener('mousemove', (e) => this.move(e));
    el.addEventListener('mousedown', (e) => {
      this.move(e);
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) {
        this.rmb = true;
        this.rmbPressed = true;
        // must be requested inside the user gesture
        if (this.rmbLocks) this.lockPointer();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) {
        this.rmb = false;
        this.unlockPointer();
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  private key(e: KeyboardEvent) {
    // physical key codes so the layout does not matter (KeyW, Digit1, ShiftLeft...)
    if (e.code.startsWith('Key')) return e.code.slice(3);
    if (e.code.startsWith('Digit')) return e.code.slice(5);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'Shift';
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') return 'Ctrl';
    return e.code;
  }

  private move(e: MouseEvent) {
    this.dx += e.movementX || 0;
    this.dy += e.movementY || 0;
    // under pointer lock the cursor is frozen: keep the last free position
    if (this.locked) return;
    const r = this.el.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.ndcX = (this.mouseX / r.width) * 2 - 1;
    this.ndcY = -(this.mouseY / r.height) * 2 + 1;
  }

  down(k: string) {
    return !this.suspended && this.held.has(k);
  }

  pressed(k: string) {
    return !this.suspended && this.edge.has(k);
  }

  wasReleased(k: string) {
    return this.released.has(k);
  }

  /** call once per fixed step after gameplay consumed the edges */
  endStep() {
    this.edge.clear();
    this.released.clear();
    this.lmbPressed = false;
    this.rmbPressed = false;
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }

  /** capture the mouse (hidden cursor, unbounded relative motion) — call from a mouse event */
  lockPointer() {
    if (this.locked) return;
    this.dx = this.dy = 0;
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch { /* not available: relative motion still works until the cursor leaves the window */ }
  }

  unlockPointer() {
    if (this.locked) document.exitPointerLock();
  }

  consumeMotion() {
    const m = { x: this.dx, y: this.dy };
    this.dx = this.dy = 0;
    return m;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
