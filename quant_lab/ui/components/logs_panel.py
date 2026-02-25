from __future__ import annotations

import customtkinter as ctk

from ui.theme import get_palette


class LogsPanel(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        p = get_palette()
        super().__init__(
            master,
            fg_color=p.card,
            corner_radius=18,
            border_width=1,
            border_color=p.divider,
            **kwargs,
        )
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkLabel(self, text="Logs", font=ctk.CTkFont(family="Avenir Next", size=16, weight="bold"))
        header.grid(row=0, column=0, sticky="w", padx=12, pady=(12, 6))

        self._box = ctk.CTkTextbox(
            self,
            fg_color=p.card2,
            corner_radius=14,
            font=ctk.CTkFont(family="Menlo", size=12),
        )
        self._box.grid(row=1, column=0, sticky="nsew", padx=12, pady=12)
        self._box.configure(state="disabled")

    def append(self, line: str) -> None:
        self._box.configure(state="normal")
        self._box.insert("end", str(line).rstrip() + "\n")
        self._box.see("end")
        self._box.configure(state="disabled")

    def append_decision(
        self,
        *,
        ts: str,
        action: str,
        ticker: str,
        shares: int,
        price: float,
        reasoning: str,
        confidence: float,
        risk: str,
        lesson: str,
        extended: str = "",
    ) -> None:
        badge = "BUY" if str(action).upper() == "BUY" else ("SELL" if str(action).upper() == "SELL" else "HOLD")
        lines = []
        lines.append(f"[{ts}] QUANT {badge} {shares} {ticker} @ ${price:.2f}")
        lines.append(f"Reasoning: {reasoning}")
        lines.append(f"Confidence: {confidence:.0f}% | Risk: {risk}")
        lines.append(f"Lesson: {lesson}")
        if str(extended).strip():
            lines.append(f"More: {extended}")
        self.append("\n".join(lines))
