from __future__ import annotations

from typing import Any, Sequence

import customtkinter as ctk

from ui.theme import get_palette, resolve_color


class ChartPanel(ctk.CTkFrame):
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

        header = ctk.CTkLabel(self, text="Chart", font=ctk.CTkFont(family="Avenir Next", size=16, weight="bold"))
        header.grid(row=0, column=0, sticky="w", padx=12, pady=(12, 6))

        try:
            from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg  # type: ignore
            from matplotlib.figure import Figure  # type: ignore
        except Exception as e:
            msg = ctk.CTkLabel(self, text=f"matplotlib not available: {e}")
            msg.grid(row=1, column=0, sticky="nsew", padx=12, pady=12)
            self._ax = None
            # IMPORTANT: don't overwrite CustomTkinter's internal `_canvas` attribute.
            self._mpl_canvas = None
            self._fig = None
            return

        fig = Figure(figsize=(7.5, 4.5), dpi=100)
        ax = fig.add_subplot(111)
        ax.grid(True, alpha=0.25)
        self._ax = ax
        self._fig = fig

        canvas = FigureCanvasTkAgg(fig, master=self)
        canvas.get_tk_widget().grid(row=1, column=0, sticky="nsew", padx=12, pady=12)
        # IMPORTANT: don't overwrite CustomTkinter's internal `_canvas` attribute.
        self._mpl_canvas = canvas

    def plot(self, x: Sequence[Any], y: Sequence[float], *, title: str, ylabel: str) -> None:
        if self._ax is None or self._mpl_canvas is None:
            return
        p = get_palette()
        mode = ctk.get_appearance_mode()
        fig_bg = resolve_color(p.card, mode)
        ax_bg = resolve_color(p.card2, mode)
        text_c = resolve_color(p.text, mode)
        muted_c = resolve_color(p.muted, mode)
        grid_c = resolve_color(p.divider, mode)
        accent_c = resolve_color(p.accent, mode)

        self._ax.clear()
        if self._fig is not None:
            self._fig.patch.set_facecolor(fig_bg)
        self._ax.set_facecolor(ax_bg)
        xs = list(x)
        ys = list(y)
        self._ax.plot(xs, ys, lw=2.2, color=accent_c)
        if xs and ys and len(xs) == len(ys):
            base = min(ys)
            self._ax.fill_between(xs, ys, [base] * len(ys), alpha=0.10, color=accent_c)
        self._ax.set_title(title)
        self._ax.set_ylabel(ylabel)
        self._ax.tick_params(colors=muted_c)
        self._ax.yaxis.label.set_color(text_c)
        self._ax.title.set_color(text_c)
        for spine in self._ax.spines.values():
            spine.set_color(grid_c)
        self._ax.grid(True, alpha=0.25, color=grid_c)
        self._mpl_canvas.draw_idle()

    def plot_multi(
        self,
        x: Sequence[Any],
        series: Sequence[tuple[str, Sequence[float], tuple[str, str]]],
        *,
        title: str,
        ylabel: str,
    ) -> None:
        if self._ax is None or self._mpl_canvas is None:
            return
        p = get_palette()
        mode = ctk.get_appearance_mode()
        fig_bg = resolve_color(p.card, mode)
        ax_bg = resolve_color(p.card2, mode)
        text_c = resolve_color(p.text, mode)
        muted_c = resolve_color(p.muted, mode)
        grid_c = resolve_color(p.divider, mode)

        self._ax.clear()
        if self._fig is not None:
            self._fig.patch.set_facecolor(fig_bg)
        self._ax.set_facecolor(ax_bg)
        xs = list(x)
        for name, ys_raw, color in series:
            ys = list(ys_raw)
            if len(xs) != len(ys) or not xs:
                continue
            self._ax.plot(xs, ys, lw=1.8, label=str(name), color=resolve_color(color, mode))
        self._ax.set_title(title)
        self._ax.set_ylabel(ylabel)
        self._ax.tick_params(colors=muted_c)
        self._ax.yaxis.label.set_color(text_c)
        self._ax.title.set_color(text_c)
        for spine in self._ax.spines.values():
            spine.set_color(grid_c)
        self._ax.grid(True, alpha=0.25, color=grid_c)
        leg = self._ax.legend(loc="best", framealpha=0.2)
        if leg is not None:
            for txt in leg.get_texts():
                txt.set_color(text_c)
        self._mpl_canvas.draw_idle()
