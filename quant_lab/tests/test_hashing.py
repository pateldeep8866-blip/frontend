from quantlab.utils.hashing import sha256_json


def test_sha256_json_stable_ordering():
    a = {"b": 1, "a": 2, "nested": {"y": 9, "x": 8}}
    b = {"a": 2, "nested": {"x": 8, "y": 9}, "b": 1}
    assert sha256_json(a) == sha256_json(b)


def test_sha256_json_changes_on_value_change():
    a = {"a": 1}
    b = {"a": 2}
    assert sha256_json(a) != sha256_json(b)

