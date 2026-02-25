from ui.theme import UISettings, load_settings, save_settings


def test_settings_persistence(tmp_path):
    p = tmp_path / "ui_settings.json"
    s0 = load_settings(p)
    assert s0.appearance in {"Dark", "Light", "System"}

    save_settings(UISettings(appearance="Dark"), p)
    s1 = load_settings(p)
    assert s1.appearance == "Dark"

    save_settings(UISettings(appearance="Light"), p)
    s2 = load_settings(p)
    assert s2.appearance == "Light"

