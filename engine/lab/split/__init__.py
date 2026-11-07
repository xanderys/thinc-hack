"""Fixed calibration split (seed 42, per installer, half fit and half test). Built by make_split.py; ids only."""
from pathlib import Path

HERE = Path(__file__).parent


def _read(name):
    return [x for x in (HERE / name).read_text().split("\n") if x]


def load_split() -> tuple[list[str], list[str]]:
    """Read the id files; when absent (a clean clone, they are gitignored), rebuild the same split from seed 42 and write them."""
    if not ((HERE / "fit_ids.txt").exists() and (HERE / "test_ids.txt").exists()):
        from .make_split import build
        fit, test = build()
        (HERE / "fit_ids.txt").write_text("\n".join(fit) + "\n")
        (HERE / "test_ids.txt").write_text("\n".join(test) + "\n")
    return _read("fit_ids.txt"), _read("test_ids.txt")


def counts(df=None) -> dict:
    """Fit and test sizes; per installer when a frame with project_id and installer_id is given."""
    fit, test = load_split()
    out = {"fit": len(fit), "test": len(test)}
    if df is not None:
        f, t = set(fit), set(test)
        for inst, g in df.groupby("installer_id"):
            ids = g.project_id.astype(str)
            out[inst] = {"fit": int(ids.isin(f).sum()), "test": int(ids.isin(t).sum())}
    return out
