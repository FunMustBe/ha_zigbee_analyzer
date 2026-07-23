from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import ZigbeeNetwork


class NetworkGraph:
    """Fast graph representation of the Zigbee mesh."""

    def __init__(self, network: "ZigbeeNetwork"):

        self._children: dict[str, list[str]] = defaultdict(list)
        self._parent: dict[str, str] = {}

        for link in network.links:

            self._children[link.target_ieee].append(
                link.source_ieee
            )

            self._parent[link.source_ieee] = (
                link.target_ieee
            )

    def children(self, ieee_addr: str) -> list[str]:

        return self._children.get(
            ieee_addr,
            [],
        )

    def parent(self, ieee_addr: str) -> str | None:

        return self._parent.get(
            ieee_addr
        )

    def has_parent(self, ieee_addr: str) -> bool:

        return ieee_addr in self._parent

    def child_count(self, ieee_addr: str) -> int:

        return len(
            self.children(
                ieee_addr
            )
        )