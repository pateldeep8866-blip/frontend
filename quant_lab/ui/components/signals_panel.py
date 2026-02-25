from __future__ import annotations

from typing import Callable, List, Optional

import customtkinter as ctk

from ui.state import PickRow
from ui.theme import get_palette


class SignalsPanel(ctk.CTkFrame):
    def __init__(
        self,
        master,
        *,
        on_select: Optional[Callable[[str], None]] = None,
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
        self._on_select = on_select
        self._rows: List[PickRow] = []
        self._selected: Optional[str] = None
        self._row_btns: dict[str, ctk.CTkButton] = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkLabel(self, text="Signals (Ranked)", font=ctk.CTkFont(family="Avenir Next", size=16, weight="bold"))
        header.grid(row=0, column=0, sticky="w", padx=12, pady=(12, 6))

        self._list = ctk.CTkScrollableFrame(self, height=240, fg_color=p.card2, corner_radius=14)
        self._list.grid(row=1, column=0, sticky="nsew", padx=12)

        self._details = ctk.CTkTextbox(
            self,
            height=110,
            fg_color=p.card2,
            corner_radius=14,
            font=ctk.CTkFont(family="Menlo", size=12),
        )
        self._details.grid(row=2, column=0, sticky="ew", padx=12, pady=12)
        self._details.configure(state="disabled")

    def set_rows(self, rows: List[PickRow]) -> None:
        self._rows = list(rows)
        self._selected = None
        self._render()
        self.set_details("")

    def set_details(self, text: str) -> None:
        self._details.configure(state="normal")
        self._details.delete("1.0", "end")
        self._details.insert("1.0", text)
        self._details.configure(state="disabled")

    def _select(self, ticker: str) -> None:
        p = get_palette()
        prev = self._selected
        self._selected = str(ticker).upper()
        if prev and prev in self._row_btns:
            try:
                self._row_btns[prev].configure(fg_color=p.card, border_color=p.divider)
            except Exception:
                pass
        if self._selected in self._row_btns:
            try:
                self._row_btns[self._selected].configure(fg_color=p.selected, border_color=p.accent)
            except Exception:
                pass
        row = next((r for r in self._rows if r.ticker == self._selected), None)
        if row is not None:
            self.set_details(
                f"{row.ticker}\n"
                f"score={row.score:.3f}  vol={row.vol:.3f}  mom63={row.mom_63:.3f}  mom252={row.mom_252:.3f}\n"
                f"t={row.t_stat:.2f}  p={row.p_value:.3g}  FDR={'Y' if row.passes_fdr else 'N'}\n\n"
                f"Reason:\n{row.reasons}"
            )
        if self._on_select is not None:
            self._on_select(self._selected)

    def _render(self) -> None:
        p = get_palette()
        for w in self._list.winfo_children():
            w.destroy()
        self._row_btns = {}

        # Header row
        hdr = ctk.CTkFrame(self._list, fg_color="transparent")
        hdr.grid(row=0, column=0, sticky="ew", padx=2, pady=(0, 6))
        for col, text, w in [
            (0, "Ticker", 70),
            (1, "Score", 70),
            (2, "p", 70),
            (3, "FDR", 50),
        ]:
            ctk.CTkLabel(
                hdr,
                text=text,
                width=w,
                anchor="w",
                text_color=p.muted,
                font=ctk.CTkFont(size=11, weight="bold"),
            ).grid(row=0, column=col, padx=4)

        for i, r in enumerate(self._rows, start=1):
            btn = ctk.CTkButton(
                self._list,
                text=f"{r.ticker:>4}   {r.score:>6.3f}   {r.p_value:>6.3g}   {'Y' if r.passes_fdr else 'N'}",
                anchor="w",
                fg_color=p.card,
                hover_color=p.selected_hover,
                border_width=1,
                border_color=p.divider,
                corner_radius=14,
                height=34,
                font=ctk.CTkFont(family="Menlo", size=12),
                command=lambda t=r.ticker: self._select(t),
            )
            btn.grid(row=i, column=0, sticky="ew", padx=2, pady=3)
            self._row_btns[str(r.ticker).upper()] = btn
