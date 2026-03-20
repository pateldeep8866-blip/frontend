# assets/__init__.py — Asset-class model registry
from assets.base_asset import BaseAssetModel
from assets.crypto_model import CryptoAssetModel
from assets.equities_model import EquitiesAssetModel

__all__ = ["BaseAssetModel", "CryptoAssetModel", "EquitiesAssetModel"]


def get_model(asset_class: str) -> BaseAssetModel:
    """Factory: return the right asset model for an asset_class string."""
    mapping = {
        "crypto":   CryptoAssetModel,
        "equities": EquitiesAssetModel,
    }
    cls = mapping.get(asset_class)
    if cls is None:
        raise ValueError(f"No asset model for asset_class={asset_class!r}")
    return cls()
