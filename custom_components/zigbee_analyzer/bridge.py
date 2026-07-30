from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork
from .network_graph import NetworkGraphAnalyzer


@dataclass(slots=True)
class Bridge:
    source: str
    target: str
    lqi: int


class BridgeAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[Bridge]:

        #
        # Nur Routergraph!
        #

        graph = NetworkGraphAnalyzer.build(
            network,
            routers_only=True,
        )

        adjacency: dict[str, list[tuple[str, int]]] = {}

        for edge in graph.edges:

            if not edge.active:
                continue

            adjacency.setdefault(
                edge.source,
                [],
            ).append(
                (
                    edge.target,
                    edge.lqi,
                )
            )

            adjacency.setdefault(
                edge.target,
                [],
            ).append(
                (
                    edge.source,
                    edge.lqi,
                )
            )

        visited = set()

        tin = {}

        low = {}

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

                    low[v] = min(
                        low[v],
                        tin[to],
                    )

                    continue

                dfs(to, v)

                low[v] = min(
                    low[v],
                    low[to],
                )

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

                dfs(
                    node,
                    None,
                )

        lookup = {
            n.ieee_addr: n.friendly_name
            for n in network.nodes
        }

        return [
            Bridge(
                source=lookup.get(b.source, b.source),
                target=lookup.get(b.target, b.target),
                lqi=b.lqi,
            )
            for b in sorted(
                bridges,
                key=lambda x: x.lqi,
            )
        ]