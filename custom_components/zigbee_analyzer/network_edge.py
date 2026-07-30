from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class NetworkEdge:

    source: str

    target: str

    lqi: int

    relationship: int

    active: bool

    bidirectional: bool = False