from __future__ import annotations

from typing import Callable, Optional

import customtkinter as ctk

from ui.theme import get_palette


class SimulatorPanel(ctk.CTkFrame):
    def __init__(
        self,
        master,
        *,
        on_mode_change: Optional[Callable[[str], None]] = None,
        on_autopilot_toggle: Optional[Callable[[bool], None]] = None,
        **kwargs,
    ):
        p = get_palette()
        super().__init__(
            master,
            fg_color=p.card,
            corner_radius=18,
            border_width=1,
            border_color=p.divider,
            **kwargs,
        )
        self._on_mode_change = on_mode_change
        self._on_autopilot_toggle = on_autopilot_toggle

        self.grid_columnconfigure(0, weight=1)

        self._header_var = ctk.StringVar(value="Simulator")
        header = ctk.CTkLabel(
            self,
            textvariable=self._header_var,
            font=ctk.CTkFont(family="Avenir Next", size=16, weight="bold"),
        )
        header.grid(row=0, column=0, sticky="w", padx=12, pady=(12, 6))

        self._mode_tabs = ctk.CTkSegmentedButton(
            self,
            values=["Manual Trading", "quant Auto-Pilot"],
            command=self._emit_autopilot,
            corner_radius=12,
        )
        self._mode_tabs.set("Manual Trading")
        self._mode_tabs.grid(row=1, column=0, sticky="ew", padx=12, pady=(0, 8))

        row1 = ctk.CTkFrame(self, fg_color="transparent")
        row1.grid(row=2, column=0, sticky="ew", padx=12)
        row1.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(row1, text="Provider", width=70, anchor="w", text_color=p.muted).grid(row=0, column=0, padx=(0, 6))
        self._mode_var = ctk.StringVar(value="Replay")
        self._mode_menu = ctk.CTkOptionMenu(
            row1,
            values=["Replay", "Live"],
            variable=self._mode_var,
            command=self._emit_mode,
            width=120,
            corner_radius=12,
        )
        self._mode_menu.grid(row=0, column=1, sticky="w")

        row2 = ctk.CTkFrame(self, fg_color="transparent")
        row2.grid(row=3, column=0, sticky="ew", padx=12, pady=(6, 0))
        row2.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(row2, text="Speed", width=70, anchor="w", text_color=p.muted).grid(row=0, column=0, padx=(0, 6))
        self._speed = ctk.CTkSlider(row2, from_=0, to=50, number_of_steps=50, progress_color=p.accent)
        self._speed.set(10)
        self._speed.grid(row=0, column=1, sticky="ew")

        row3 = ctk.CTkFrame(self, fg_color="transparent")
        row3.grid(row=4, column=0, sticky="ew", padx=12, pady=(6, 0))
        for i in range(6):
            row3.grid_columnconfigure(i, weight=0)

        ctk.CTkLabel(row3, text="Cash", text_color=p.muted).grid(row=0, column=0, padx=(0, 6))
        self._cash = ctk.CTkEntry(row3, width=90, corner_radius=12)
        self._cash.insert(0, "10000")
        self._cash.grid(row=0, column=1, padx=(0, 10))

        ctk.CTkLabel(row3, text="Commission", text_color=p.muted).grid(row=0, column=2, padx=(0, 6))
        self._commission = ctk.CTkEntry(row3, width=80, corner_radius=12)
        self._commission.insert(0, "0.0")
        self._commission.grid(row=0, column=3, padx=(0, 10))

        ctk.CTkLabel(row3, text="Slippage bps", text_color=p.muted).grid(row=0, column=4, padx=(0, 6))
        self._slip = ctk.CTkEntry(row3, width=80, corner_radius=12)
        self._slip.insert(0, "0.0")
        self._slip.grid(row=0, column=5)

        self._status = ctk.CTkLabel(
            self,
            text="Waiting for plan.",
            justify="left",
            text_color=p.muted,
        )
        self._status.grid(row=5, column=0, sticky="ew", padx=12, pady=(10, 6))

        self._banner_var = ctk.StringVar(value="Auto-Pilot inactive.")
        self._banner = ctk.CTkLabel(
            self,
            textvariable=self._banner_var,
            justify="left",
            text_color=p.text,
            fg_color=p.card2,
            corner_radius=10,
            padx=10,
            pady=8,
            wraplength=520,
        )
        self._banner.grid(row=6, column=0, sticky="ew", padx=12, pady=(0, 6))

        self._thinking = ctk.CTkTextbox(
            self,
            height=120,
            fg_color=p.card2,
            corner_radius=12,
            font=ctk.CTkFont(family="Menlo", size=11),
        )
        self._thinking.grid(row=7, column=0, sticky="ew", padx=12, pady=(0, 10))
        self._thinking.insert("end", "What QUANT is watching\n- Waiting for context...\n")
        self._thinking.configure(state="disabled")

    def _emit_mode(self, _val: str) -> None:
        if self._on_mode_change is not None:
            self._on_mode_change(self.mode())

    def _emit_autopilot(self, _val: str) -> None:
        if self._on_autopilot_toggle is not None:
            self._on_autopilot_toggle(self.autopilot_enabled())

    def autopilot_enabled(self) -> bool:
        return str(self._mode_tabs.get()) == "quant Auto-Pilot"

    def set_autopilot_enabled(self, enabled: bool) -> None:
        self._mode_tabs.set("quant Auto-Pilot" if bool(enabled) else "Manual Trading")
        self._header_var.set("Simulator 🤖" if bool(enabled) else "Simulator")

    def mode(self) -> str:
        return str(self._mode_var.get())

    def speed(self) -> float:
        return float(self._speed.get())

    def cash(self) -> float:
        try:
            return float(self._cash.get())
        except Exception:
            return 10_000.0

    def commission(self) -> float:
        try:
            return float(self._commission.get())
        except Exception:
            return 0.0

    def slippage_bps(self) -> float:
        try:
            return float(self._slip.get())
        except Exception:
            return 0.0

    def set_status(self, text: str) -> None:
        self._status.configure(text=str(text))

    def set_autopilot_banner(self, text: str) -> None:
        self._banner_var.set(str(text))

    def set_thinking_panel(
        self,
        *,
        watchlist: list[str],
        risk_score: str,
        outlook: str,
        next_decision: str,
    ) -> None:
        lines = []
        lines.append("What QUANT is watching")
        if watchlist:
            lines.append(f"- Watchlist: {', '.join(watchlist[:3])}")
        else:
            lines.append("- Watchlist: -")
        lines.append(f"- Portfolio risk score: {risk_score}")
        lines.append(f"- Market outlook: {outlook}")
        lines.append(f"- Next decision time: {next_decision}")
        self._thinking.configure(state="normal")
        self._thinking.delete("1.0", "end")
        self._thinking.insert("end", "\n".join(lines) + "\n")
        self._thinking.configure(state="disabled")
