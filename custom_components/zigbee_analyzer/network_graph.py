from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class GraphNode:

    ieee_addr: str

    friendly_name: str

    degree: int = 0


class NetworkGraphAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[GraphNode]:

        nodes: dict[str, GraphNode] = {}

        #
        # Alle Geräte anlegen
        #

        for node in network.nodes:

            nodes[node.ieee_addr] = GraphNode(
                ieee_addr=node.ieee_addr,
                friendly_name=node.friendly_name,
            )

        #
        # Jede Verbindung erhöht den Degree
        #

        for link in network.links:

            if link.lqi <= 1:
                continue

            if link.source_ieee in nodes:
                nodes[link.source_ieee].degree += 1

            if link.target_ieee in nodes:
                nodes[link.target_ieee].degree += 1

        return sorted(
            nodes.values(),
            key=lambda n: n.degree,
            reverse=True,
        )