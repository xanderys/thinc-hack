"""Paths and the frozen engine."""
import pickle
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
OUT = ENGINE / ".cache" / "synthetic"  # gitignored: synthetic rows, engine pickle, report.json


def load_engine():
    """(engine, pickle path): the frozen engine, trained exactly as app.main does; cached by the same key."""
    from app import data, main
    from app.model import Engine
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"engine-{main.cache_key()}.pkl"
    if path.exists():
        eng = pickle.loads(path.read_bytes())
        if hasattr(eng, "restore_globals"):  # module state set in fit()
            eng.restore_globals()
        return eng, path
    df, stats = data.load()
    eng = Engine(df, stats).fit()
    for old in OUT.glob("engine-*.pkl"):
        old.unlink()
    path.write_bytes(pickle.dumps(eng))
    return eng, path
