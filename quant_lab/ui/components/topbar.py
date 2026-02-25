from __future__ import annotations

from typing import Callable, Optional

import customtkinter as ctk

from ui.theme import UISettings, apply_appearance_mode, get_palette, normalize_appearance, save_settings, status_pill_fg


class TopBar(ctk.CTkFrame):
    def __init__(
        self,
        master,
        *,
        on_run_plan: Callable[[], None],
        on_start: Callable[[], None],
        on_stop: Callable[[], None],
        on_theme_change: Optional[Callable[[str], None]] = None,
        initial_settings: Optional[UISettings] = None,
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

        self._on_run_plan = on_run_plan
        self._on_start = on_start
        self._on_stop = on_stop
        self._on_theme_change = on_theme_change

        self._palette = p

        self._status_var = ctk.StringVar(value="IDLE")
        self._mode_var = ctk.StringVar(value="Replay")
        self._asof_var = ctk.StringVar(value="-")
        self._regime_var = ctk.StringVar(value="regime: -")
        self._provider_var = ctk.StringVar(value="Provider: ReplayProvider")

        self.grid_columnconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=0)
        self.grid_columnconfigure(2, weight=0)
        self.grid_columnconfigure(3, weight=0)

        left = ctk.CTkFrame(self, fg_color="transparent")
        left.grid(row=0, column=0, sticky="w", padx=10, pady=8)

        self._status_pill = ctk.CTkLabel(
            left,
            textvariable=self._status_var,
            corner_radius=16,
            fg_color=status_pill_fg("IDLE"),
            text_color=("white", "white"),
            padx=12,
            pady=6,
            font=ctk.CTkFont(family="Avenir Next", size=12, weight="bold"),
        )
        self._status_pill.grid(row=0, column=0, padx=(0, 10))

        meta = ctk.CTkFrame(left, fg_color="transparent")
        meta.grid(row=0, column=1, sticky="w")
        meta_font = ctk.CTkFont(family="Avenir Next", size=12)
        self._mode_lbl = ctk.CTkLabel(meta, textvariable=self._mode_var, font=meta_font, text_color=p.muted)
        self._mode_lbl.grid(row=0, column=0, padx=(0, 14))
        self._asof_lbl = ctk.CTkLabel(meta, textvariable=self._asof_var, font=meta_font, text_color=p.muted)
        self._asof_lbl.grid(row=0, column=1, padx=(0, 14))
        self._regime_lbl = ctk.CTkLabel(meta, textvariable=self._regime_var, font=meta_font, text_color=p.muted)
        self._regime_lbl.grid(row=0, column=2, padx=(0, 14))
        self._provider_lbl = ctk.CTkLabel(meta, textvariable=self._provider_var, font=meta_font, text_color=p.muted)
        self._provider_lbl.grid(row=0, column=3)

        right = ctk.CTkFrame(self, fg_color="transparent")
        right.grid(row=0, column=1, columnspan=3, sticky="e", padx=10, pady=8)

        self._run_btn = ctk.CTkButton(
            right,
            text="Run Morning Plan",
            command=self._on_run_plan,
            fg_color=p.accent,
            hover_color=p.accent_hover,
            corner_radius=14,
            height=34,
            font=ctk.CTkFont(family="Avenir Next", size=12, weight="bold"),
        )
        self._run_btn.grid(row=0, column=0, padx=6)
        self._start_btn = ctk.CTkButton(
            right,
            text="START",
            command=self._on_start,
            fg_color=p.success,
            hover_color=p.success_hover,
            corner_radius=14,
            height=34,
            font=ctk.CTkFont(family="Avenir Next", size=12, weight="bold"),
        )
        self._start_btn.grid(row=0, column=1, padx=6)
        self._stop_btn = ctk.CTkButton(
            right,
            text="STOP",
            command=self._on_stop,
            fg_color=p.danger,
            hover_color=p.danger_hover,
            corner_radius=14,
            height=34,
            font=ctk.CTkFont(family="Avenir Next", size=12, weight="bold"),
        )
        self._stop_btn.grid(row=0, column=2, padx=6)

        # Appearance toggle.
        init = initial_settings.appearance if initial_settings is not None else "System"
        self._theme_var = ctk.StringVar(value=normalize_appearance(init))
        self._theme_toggle = ctk.CTkSegmentedButton(
            right,
            values=["System", "Light", "Dark"],
            variable=self._theme_var,
            command=self._on_theme,
            corner_radius=14,
        )
        self._theme_toggle.grid(row=0, column=3, padx=(12, 0))

        self.set_start_enabled(False)
        self.set_stop_enabled(False)

    def _on_theme(self, _value: str) -> None:
        mode = normalize_appearance(self._theme_var.get())
        apply_appearance_mode(mode)
        save_settings(UISettings(appearance=mode))
        if self._on_theme_change is not None:
            self._on_theme_change(mode)

    def set_status(self, status: str) -> None:
        self._status_var.set(str(status))
        # Update pill color based on status.
        self._status_pill.configure(fg_color=status_pill_fg(status))

    def set_mode(self, mode: str) -> None:
        self._mode_var.set(f"Mode: {mode}")

    def set_asof(self, asof: str) -> None:
        self._asof_var.set(f"As-of: {asof}")

    def set_regime(self, label: str, confidence: float) -> None:
        self._regime_var.set(f"Regime: {label} ({confidence:.2f})")

    def set_provider(self, provider_name: str) -> None:
        self._provider_var.set(f"Provider: {provider_name}")

    def set_start_enabled(self, enabled: bool) -> None:
        self._start_btn.configure(state=("normal" if enabled else "disabled"))

    def set_stop_enabled(self, enabled: bool) -> None:
        self._stop_btn.configure(state=("normal" if enabled else "disabled"))
