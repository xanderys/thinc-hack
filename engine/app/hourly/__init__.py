"""Hourly physics: simulate, validate_physics, optimum. See docs/physics.md."""
from .optimum import optimum
from .sim import SimResult, replay_2025, simulate
from .validate import validate_physics

__all__ = ["simulate", "validate_physics", "optimum", "SimResult", "replay_2025"]
