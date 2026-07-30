from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork
from .network_edge import NetworkEdge


@dataclass(slots=True)
class GraphNode:

    ieee_addr: str

    friendly_name: str

    degree: int = 0


@dataclass(slots=True)
class NetworkGraph:

    nodes: list[GraphNode]

    edges: list[NetworkEdge]


class NetworkGraphAnalyzer:

    @staticmethod
    def build(network: ZigbeeNetwork) -> NetworkGraph:

        nodes: dict[str, GraphNode] = {}

        edges: list[NetworkEdge] = []

        #
        # Nodes
        #

        for node in network.nodes:

            nodes[node.ieee_addr] = GraphNode(
                ieee_addr=node.ieee_addr,
                friendly_name=node.friendly_name,
            )

        #
        # Edges
        #

        for link in network.links:

            active = link.lqi > 1

            edge = NetworkEdge(
                source=link.source_ieee,
                target=link.target_ieee,
                lqi=link.lqi,
                relationship=link.relationship,
                active=active,
            )

            edges.append(edge)

            if active:

                if edge.source in nodes:
                    nodes[edge.source].degree += 1

                if edge.target in nodes:
                    nodes[edge.target].degree += 1

        #
        # bidirectional bestimmen
        #

        lookup = {
            (e.source, e.target): e
            for e in edges
        }

        for edge in edges:

            reverse = lookup.get(
                (edge.target, edge.source)
            )

            if reverse:
                edge.bidirectional = True

        return NetworkGraph(
            nodes=list(nodes.values()),
            edges=edges,
        )

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[GraphNode]:

        graph = NetworkGraphAnalyzer.build(network)

        return sorted(
            graph.nodes,
            key=lambda n: n.degree,
            reverse=True,
        )