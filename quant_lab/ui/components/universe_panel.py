from __future__ import annotations

from typing import Callable, List, Optional

import customtkinter as ctk

from quantlab.morning.universe import DEFAULT_UNIVERSE
from ui.theme import get_palette


class UniversePanel(ctk.CTkFrame):
    def __init__(
        self,
        master,
        *,
        on_change: Optional[Callable[[List[str]], None]] = None,
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
        self._on_change = on_change
        self._tickers: List[str] = list(DEFAULT_UNIVERSE)

        self.grid_columnconfigure(0, weight=1)

        header = ctk.CTkLabel(self, text="Universe", font=ctk.CTkFont(family="Avenir Next", size=16, weight="bold"))
        header.grid(row=0, column=0, sticky="w", padx=12, pady=(12, 6))

        sub = ctk.CTkLabel(self, text="PLAN INPUTS", text_color=p.muted, font=ctk.CTkFont(size=11, weight="bold"))
        sub.grid(row=1, column=0, sticky="w", padx=12, pady=(0, 4))

        plan = ctk.CTkFrame(self, fg_color="transparent")
        plan.grid(row=2, column=0, sticky="ew", padx=12)
        for i in range(8):
            plan.grid_columnconfigure(i, weight=0)

        ctk.CTkLabel(plan, text="Start", text_color=p.muted).grid(row=0, column=0, padx=(0, 6))
        self._start = ctk.CTkEntry(plan, width=110, corner_radius=12)
        self._start.insert(0, "2015-01-01")
        self._start.grid(row=0, column=1, padx=(0, 10))

        ctk.CTkLabel(plan, text="End", text_color=p.muted).grid(row=0, column=2, padx=(0, 6))
        self._end = ctk.CTkEntry(plan, width=110, corner_radius=12)
        self._end.grid(row=0, column=3, padx=(0, 10))

        ctk.CTkLabel(plan, text="As-of", text_color=p.muted).grid(row=0, column=4, padx=(0, 6))
        self._asof = ctk.CTkEntry(plan, width=110, placeholder_text="(defaults to end)", corner_radius=12)
        self._asof.grid(row=0, column=5, padx=(0, 10))

        ctk.CTkLabel(plan, text="K", text_color=p.muted).grid(row=0, column=6, padx=(0, 6))
        self._k = ctk.CTkEntry(plan, width=50, corner_radius=12)
        self._k.insert(0, "5")
        self._k.grid(row=0, column=7)

        div = ctk.CTkFrame(self, height=1, fg_color=p.divider)
        div.grid(row=3, column=0, sticky="ew", padx=12, pady=(12, 10))

        sub2 = ctk.CTkLabel(self, text="TICKERS", text_color=p.muted, font=ctk.CTkFont(size=11, weight="bold"))
        sub2.grid(row=4, column=0, sticky="w", padx=12, pady=(0, 4))

        controls = ctk.CTkFrame(self, fg_color="transparent")
        controls.grid(row=5, column=0, sticky="ew", padx=12)
        controls.grid_columnconfigure(0, weight=1)

        self._add_entry = ctk.CTkEntry(controls, placeholder_text="Add ticker (e.g., NVDA)", corner_radius=12)
        self._add_entry.grid(row=0, column=0, sticky="ew", padx=(0, 6))
        add_btn = ctk.CTkButton(controls, text="Add", width=60, command=self._add, corner_radius=12, fg_color=p.card2, hover_color=p.selected_hover)
        add_btn.grid(row=0, column=1)

        preset = ctk.CTkFrame(self, fg_color="transparent")
        preset.grid(row=6, column=0, sticky="ew", padx=12, pady=(8, 0))
        preset.grid_columnconfigure(0, weight=1)
        reset_btn = ctk.CTkButton(preset, text="Default Preset", command=self._reset_default, corner_radius=12, fg_color=p.card2, hover_color=p.selected_hover)
        reset_btn.grid(row=0, column=0, sticky="ew")

        self._list = ctk.CTkScrollableFrame(self, height=260, fg_color=p.card2, corner_radius=14)
        self._list.grid(row=7, column=0, sticky="nsew", padx=12, pady=12)
        self.grid_rowconfigure(7, weight=1)

        self._render()

    def get_universe(self) -> List[str]:
        return list(self._tickers)

    def start_date(self) -> str:
        return str(self._start.get()).strip()

    def set_start_date(self, value: str) -> None:
        self._start.delete(0, "end")
        self._start.insert(0, str(value))

    def end_date(self) -> str:
        return str(self._end.get()).strip()

    def set_end_date(self, value: str) -> None:
        self._end.delete(0, "end")
        self._end.insert(0, str(value))

    def asof_date(self) -> str:
        return str(self._asof.get()).strip()

    def set_asof_date(self, value: str) -> None:
        self._asof.delete(0, "end")
        self._asof.insert(0, str(value))

    def k_value(self) -> int:
        try:
            return int(float(self._k.get()))
        except Exception:
            return 5

    def set_universe(self, tickers: List[str]) -> None:
        self._tickers = [str(t).upper().strip() for t in tickers if str(t).strip()]
        self._tickers = sorted(list(dict.fromkeys(self._tickers)))
        self._render()
        self._emit()

    def _emit(self) -> None:
        if self._on_change is not None:
            self._on_change(self.get_universe())

    def _reset_default(self) -> None:
        self.set_universe(list(DEFAULT_UNIVERSE))

    def _add(self) -> None:
        t = str(self._add_entry.get()).upper().strip()
        if not t:
            return
        if t not in self._tickers:
            self._tickers.append(t)
            self._tickers = sorted(self._tickers)
        self._add_entry.delete(0, "end")
        self._render()
        self._emit()

    def _remove(self, ticker: str) -> None:
        t = str(ticker).upper()
        self._tickers = [x for x in self._tickers if x != t]
        self._render()
        self._emit()

    def _render(self) -> None:
        p = get_palette()
        for w in self._list.winfo_children():
            w.destroy()

        for i, t in enumerate(self._tickers):
            row = ctk.CTkFrame(self._list, fg_color="transparent")
            row.grid(row=i, column=0, sticky="ew", padx=2, pady=2)
            row.grid_columnconfigure(0, weight=1)
            lbl = ctk.CTkLabel(row, text=t, font=ctk.CTkFont(size=13, weight="bold"))
            lbl.grid(row=0, column=0, sticky="w")
            btn = ctk.CTkButton(
                row,
                text="Remove",
                width=72,
                command=lambda tt=t: self._remove(tt),
                corner_radius=12,
                fg_color=p.card,
                hover_color=p.selected_hover,
            )
            btn.grid(row=0, column=1, padx=6)
