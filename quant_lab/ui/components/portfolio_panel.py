from __future__ import annotations

from typing import Dict, List, Optional

import customtkinter as ctk

from ui.state import AllocationRow
from ui.theme import get_palette


class PortfolioPanel(ctk.CTkFrame):
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
        self.grid_rowconfigure(2, weight=1)

        header = ctk.CTkLabel(self, text="Portfolio", font=ctk.CTkFont(family="Avenir Next", size=16, weight="bold"))
        header.grid(row=0, column=0, sticky="w", padx=12, pady=(12, 6))

        self._summary = ctk.CTkLabel(self, text="No plan loaded.", justify="left", text_color=p.muted)
        self._summary.grid(row=1, column=0, sticky="ew", padx=12)

        self._list = ctk.CTkScrollableFrame(self, height=300, fg_color=p.card2, corner_radius=14)
        self._list.grid(row=2, column=0, sticky="nsew", padx=12, pady=12)

    def set_plan(
        self,
        allocation: List[AllocationRow],
        *,
        portfolio_vol: Optional[float] = None,
        concentration_hhi: Optional[float] = None,
    ) -> None:
        for w in self._list.winfo_children():
            w.destroy()

        pv = portfolio_vol if portfolio_vol is not None else float("nan")
        hhi = concentration_hhi if concentration_hhi is not None else float("nan")
        summary = []
        if pv == pv:
            summary.append(f"Est. vol (annualized): {pv:.2%}")
        if hhi == hhi:
            summary.append(f"Concentration (HHI): {hhi:.3f}")
        self._summary.configure(text=(" | ".join(summary) if summary else "Plan loaded."))

        rows = sorted(allocation, key=lambda r: r.target_weight, reverse=True)
        for i, r in enumerate(rows):
            row = ctk.CTkFrame(self._list, fg_color="transparent")
            row.grid(row=i, column=0, sticky="ew", padx=2, pady=2)
            row.grid_columnconfigure(1, weight=1)

            p = get_palette()
            name_font = ctk.CTkFont(size=13, weight="bold" if r.ticker != "CASH" else "normal")
            ctk.CTkLabel(row, text=r.ticker, width=55, anchor="w", font=name_font).grid(row=0, column=0, padx=(0, 6))
            bar = ctk.CTkProgressBar(row, height=14, progress_color=p.accent)
            bar.grid(row=0, column=1, sticky="ew", padx=(0, 6))
            bar.set(max(0.0, min(1.0, float(r.target_weight))))
            kwargs = {}
            if r.ticker == "CASH":
                kwargs["text_color"] = p.muted
            ctk.CTkLabel(
                row,
                text=f"{float(r.target_weight):.1%}",
                width=60,
                anchor="e",
                font=ctk.CTkFont(family="Menlo", size=12),
                **kwargs,
            ).grid(row=0, column=2)
