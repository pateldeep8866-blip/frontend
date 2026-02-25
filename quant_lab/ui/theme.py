from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple


SETTINGS_FILENAME = "ui_settings.json"


@dataclass(frozen=True)
class UISettings:
    appearance: str = "System"  # Dark/Light/System


Color = Tuple[str, str]  # (light, dark)


@dataclass(frozen=True)
class Palette:
    # Surfaces
    bg: Color
    card: Color
    card2: Color
    # Text
    text: Color
    muted: Color
    # Lines
    divider: Color
    # Accents
    accent: Color
    accent_hover: Color
    # Status
    success: Color
    success_hover: Color
    warning: Color
    warning_hover: Color
    danger: Color
    danger_hover: Color
    # Selection
    selected: Color
    selected_hover: Color


def get_palette() -> Palette:
    """
    Simple, neutral "desk" palette.
    """
    return Palette(
        bg=("#F6F7FB", "#0B0F14"),
        card=("#FFFFFF", "#0F172A"),
        card2=("#F1F5F9", "#111C33"),
        text=("#0F172A", "#E5E7EB"),
        muted=("#475569", "#94A3B8"),
        divider=("#E2E8F0", "#1F2A44"),
        accent=("#0EA5E9", "#38BDF8"),
        accent_hover=("#0284C7", "#0EA5E9"),
        success=("#16A34A", "#22C55E"),
        success_hover=("#15803D", "#16A34A"),
        warning=("#F59E0B", "#FBBF24"),
        warning_hover=("#D97706", "#F59E0B"),
        danger=("#DC2626", "#F87171"),
        danger_hover=("#B91C1C", "#EF4444"),
        selected=("#E0F2FE", "#0B2A3A"),
        selected_hover=("#BAE6FD", "#0B3550"),
    )


def resolve_color(c: Color, appearance_mode: str) -> str:
    """
    Resolve a (light,dark) color tuple for external libs (e.g., matplotlib).
    """
    m = str(appearance_mode).strip().lower()
    if m == "light":
        return str(c[0])
    return str(c[1])


def settings_path(default_root: Optional[Path] = None) -> Path:
    root = default_root or Path(__file__).resolve().parent
    return Path(root) / SETTINGS_FILENAME


def normalize_appearance(mode: str) -> str:
    m = str(mode).strip().capitalize()
    if m in {"Dark", "Light", "System"}:
        return m
    return "System"


def load_settings(path: Optional[Path] = None) -> UISettings:
    p = Path(path) if path is not None else settings_path()
    if not p.exists():
        return UISettings()
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return UISettings()
    if not isinstance(obj, dict):
        return UISettings()
    return UISettings(appearance=normalize_appearance(obj.get("appearance", "System")))


def save_settings(settings: UISettings, path: Optional[Path] = None) -> Path:
    p = Path(path) if path is not None else settings_path()
    payload = {"appearance": normalize_appearance(settings.appearance)}
    p.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return p


def apply_appearance_mode(mode: str) -> str:
    """
    Apply appearance mode to CustomTkinter if available.
    Returns normalized mode.
    """
    m = normalize_appearance(mode)
    try:
        import customtkinter as ctk  # type: ignore

        ctk.set_appearance_mode(m)
    except Exception:
        # UI can still run (or tests can pass) without CustomTkinter installed.
        pass
    return m


def status_pill_fg(status: str) -> Color:
    """
    Color for status pill by engine state.
    """
    p = get_palette()
    s = str(status).upper().strip()
    if s == "RESEARCHING":
        return p.warning
    if s == "PLAN_READY":
        return p.success
    if s == "LIVE":
        return p.accent
    if s == "STOPPED":
        return p.danger
    return p.card2
