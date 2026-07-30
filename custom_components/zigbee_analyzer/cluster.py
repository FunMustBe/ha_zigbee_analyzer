from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class Cluster:

    nodes: list[str]


class ClusterAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[Cluster]:

        adjacency: dict[str, set[str]] = {}

        #
        # Graph erzeugen
        #

        for link in network.links:

            #
            # Nur komplett ungültige Links ignorieren
            #

            if link.lqi <= 1:
                continue

            if link.lqi > 1:

                adjacency.setdefault(link.source_ieee, set()).add(link.target_ieee)
                adjacency.setdefault(link.target_ieee, set()).add(link.source_ieee)

        visited: set[str] = set()

        clusters: list[Cluster] = []

        for ieee in adjacency:

            if ieee in visited:
                continue

            stack = [ieee]

            component: list[str] = []

            while stack:

                current = stack.pop()

                if current in visited:
                    continue

                visited.add(current)

                component.append(current)

                stack.extend(adjacency[current] - visited)

            clusters.append(
                Cluster(
                    nodes=component,
                )
            )

        return sorted(
            clusters,
            key=lambda c: len(c.nodes),
            reverse=True,
        )