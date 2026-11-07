"""Transparent recommender. rules-2-physics (default): the home's own hourly physics and sourced economics, no fitted
constants. rules-1 (calibrated) stays importable as the comparison column. See docs/rules.md."""
from .physics import RULES_VERSION, day, frontier, recommend, rules_table
from .split import test_ids
from . import calibrated, rules3, rules4

__all__ = ["recommend", "frontier", "day", "test_ids", "RULES_VERSION", "rules_table", "calibrated", "rules3", "rules4"]
