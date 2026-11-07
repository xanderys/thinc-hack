"""Transparent recommender: five planner rules on the hourly physics. See docs/rules.md."""
from .core import RULES_VERSION, recommend, rules_table
from .split import test_ids

__all__ = ["recommend", "test_ids", "RULES_VERSION", "rules_table"]
