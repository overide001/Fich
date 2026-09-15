"use strict";

class QuitController {
  constructor(game) {
    this.game = game;
    this.overlay = null;
    this.boundKeyDown = (event) => {
      if (event.key !== "Escape") return;

      if (this.overlay && this.overlay.style.display !== "none") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }

      if (this.game && this.game.running) {
        event.preventDefault();
        event.stopPropagation();
        this.open();
      }
    };

    this.build();
    window.addEventListener("keydown", this.boundKeyDown);
  }

  build() {
    const overlay = document.createElement("div");
    overlay.id = "quitConfirmOverlay";
    overlay.innerHTML = `
      <style>
        #quitConfirmOverlay {
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          background: rgba(0, 0, 0, 0.88);
          font-family: "Courier New", monospace;
          color: #fff;
          user-select: none;
        }

        .quit-panel {
          position: relative;
          width: min(460px, calc(100vw - 32px));
          background: #000;
          border: 1px solid #fff;
          padding: 0;
          box-shadow: 0 0 40px rgba(255,255,255,0.10);
        }

        .quit-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.20);
        }

        .quit-system {
          font-size: 10px;
          letter-spacing: .22em;
          color: rgba(255,255,255,0.55);
        }

        .quit-status {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 9px;
          letter-spacing: .15em;
          color: #fff;
        }

        .quit-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 10px rgba(255,255,255,0.85);
        }

        .quit-content {
          padding: 25px 24px 22px;
          text-align: center;
        }

        .quit-warning-icon {
          width: 46px;
          height: 46px;
          margin: 0 auto 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #fff;
          border-radius: 50%;
          color: #fff;
          font-size: 20px;
          font-weight: 700;
        }

        .quit-title {
          margin: 0;
          font-size: clamp(20px, 5vw, 27px);
          font-weight: 700;
          letter-spacing: .16em;
          color: #fff;
          text-shadow: 0 0 18px rgba(255,255,255,0.7);
        }

        .quit-subtitle {
          margin: 7px 0 20px;
          font-size: 9px;
          letter-spacing: .18em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.45);
        }

        .quit-message {
          margin: 0 auto 19px;
          max-width: 365px;
          color: rgba(255,255,255,0.80);
          font-family: "Courier New", monospace;
          font-size: 13px;
          line-height: 1.6;
        }

        .quit-message strong {
          color: #fff;
          font-weight: 700;
        }

        .quit-divider {
          position: relative;
          height: 1px;
          margin: 18px 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.30), transparent);
        }

        .quit-buttons {
          display: flex;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .quit-button {
          min-width: 135px;
          padding: 11px 17px;
          border-radius: 0;
          font-family: "Courier New", monospace;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .12em;
          cursor: pointer;
          transition: background 0.1s linear, color 0.1s linear;
        }

        .quit-cancel {
          background: transparent;
          color: #fff;
          border: 1px solid #fff;
        }

        .quit-cancel:hover {
          background: #fff;
          color: #000;
        }

        .quit-confirm {
          background: #fff;
          color: #000;
          border: 1px solid #fff;
        }

        .quit-confirm:hover {
          background: transparent;
          color: #fff;
        }

        .quit-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 18px;
          border-top: 1px solid rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.35);
          font-size: 8px;
          letter-spacing: .12em;
        }

        .quit-key {
          padding: 2px 6px;
          border: 1px solid rgba(255,255,255,0.25);
          color: rgba(255,255,255,0.65);
        }

        @media (max-width: 500px) {
          .quit-content { padding: 22px 17px 18px; }
          .quit-buttons { flex-direction: column; }
          .quit-button { width: 100%; }
        }
      </style>

      <div class="quit-panel" role="dialog" aria-modal="true" aria-labelledby="quitTitle">
        <div class="quit-header">
          <span class="quit-system">ECOSYSTEM // CONTROL</span>
          <span class="quit-status"><span class="quit-status-dot"></span>RUN ACTIVE</span>
        </div>

        <div class="quit-content">
          <div class="quit-warning-icon">!</div>
          <h2 id="quitTitle" class="quit-title">ABANDON RUN?</h2>
          <div class="quit-subtitle">SURVIVAL SESSION TERMINATION</div>
          <p id="quitMessage" class="quit-message">You will lose the current run, but your earned coins will be saved.</p>
          <div class="quit-divider"></div>

          <div class="quit-buttons">
            <button id="quitCancelBtn" class="quit-button quit-cancel" type="button">RETURN TO WATER</button>
            <button id="quitConfirmBtn" class="quit-button quit-confirm" type="button">ABANDON RUN</button>
          </div>
        </div>

        <div class="quit-footer">
          <span>PLAYER SESSION</span>
          <span><span class="quit-key">ESC</span> CLOSE</span>
        </div>
      </div>
    `;

    const cancelBtn = overlay.querySelector("#quitCancelBtn");
    const confirmBtn = overlay.querySelector("#quitConfirmBtn");

    cancelBtn.addEventListener("click", () => this.close());
    confirmBtn.addEventListener("click", () => this.confirm());

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close();
    });

    this.overlay = overlay;
    document.body.appendChild(overlay);
  }

  open() {
    if (!this.game || !this.game.running || !this.overlay) return;

    const earned = this.game.eco && typeof this.game.eco.pendingCoins === "number"
      ? this.game.eco.pendingCoins
      : 0;

    const label = this.overlay.querySelector("#quitMessage");
    label.innerHTML = `You will lose the current run, but <strong>${earned} earned coin${earned === 1 ? "" : "s"}</strong> will be saved.`;
    this.overlay.style.display = "flex";

    const cancelBtn = this.overlay.querySelector("#quitCancelBtn");
    if (cancelBtn) requestAnimationFrame(() => cancelBtn.focus());
  }

  close() {
    if (!this.overlay) return;
    this.overlay.style.display = "none";
  }

  confirm() {
    this.close();
    if (this.game && typeof this.game.quitToMenu === "function") {
      this.game.quitToMenu();
    }
  }

  destroy() {
    window.removeEventListener("keydown", this.boundKeyDown);
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}