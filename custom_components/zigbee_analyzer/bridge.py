from __future__ import annotations

from dataclasses import dataclass

from .network_graph import NetworkGraphAnalyzer
from .models import ZigbeeNetwork


@dataclass(slots=True)
class Bridge:

    source: str
    target: str
    lqi: int


class BridgeAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[Bridge]:

        graph = NetworkGraphAnalyzer.build(network)

        adjacency: dict[str, list[tuple[str, int]]] = {}

        #
        # Nur aktive Links
        #

        for edge in graph.edges:

            if not edge.active:
                continue

            adjacency.setdefault(edge.source, []).append((edge.target, edge.lqi))
            adjacency.setdefault(edge.target, []).append((edge.source, edge.lqi))

        visited: set[str] = set()

        tin: dict[str, int] = {}

        low: dict[str, int] = {}

        timer = 0

        bridges: list[Bridge] = []

        def dfs(v: str, parent: str | None):

            nonlocal timer

            visited.add(v)

            tin[v] = timer

            low[v] = timer

            timer += 1

            for to, lqi in adjacency.get(v, []):

                if to == parent:
                    continue

                if to in visited:

                    low[v] = min(low[v], tin[to])

                else:

                    dfs(to, v)

                    low[v] = min(low[v], low[to])

                    if low[to] > tin[v]:

                        bridges.append(
                            Bridge(
                                source=v,
                                target=to,
                                lqi=lqi,
                            )
                        )

        for node in adjacency:

            if node not in visited:

                dfs(node, None)

        lookup = {
            node.ieee_addr: node.friendly_name
            for node in network.nodes
        }

        bridges.sort(
            key=lambda bridge: bridge.lqi
        )

        return [
            Bridge(
                source=lookup.get(b.source, b.source),
                target=lookup.get(b.target, b.target),
                lqi=b.lqi,
            )
            for b in bridges
        ]