from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork
from .network_edge import NetworkEdge


@dataclass(slots=True)
class GraphNode:
    ieee_addr: str
    friendly_name: str
    device_type: str
    degree: int = 0


@dataclass(slots=True)
class NetworkGraph:
    nodes: list[GraphNode]
    edges: list[NetworkEdge]


class NetworkGraphAnalyzer:
    @staticmethod
    def build(
        network: ZigbeeNetwork,
        routers_only: bool = False,
    ) -> NetworkGraph:

        nodes: dict[str, GraphNode] = {}

        #
        # Nodes
        #

        for node in network.nodes:
            #
            # Für Graphalgorithmen interessieren
            # ausschließlich Coordinator + Router
            #

            if routers_only:
                if node.device_type.lower() not in (
                    "coordinator",
                    "router",
                ):
                    continue

            nodes[node.ieee_addr] = GraphNode(
                ieee_addr=node.ieee_addr,
                friendly_name=node.friendly_name,
                device_type=node.device_type,
            )

        #
        # Edges
        #

        edge_list: list[NetworkEdge] = []

        for link in network.links:
            if link.source_ieee not in nodes:
                continue

            if link.target_ieee not in nodes:
                continue

            active = link.lqi > 1

            edge = NetworkEdge(
                source=link.source_ieee,
                target=link.target_ieee,
                lqi=link.lqi,
                relationship=link.relationship,
                active=active,
            )

            edge_list.append(edge)

            if active:
                nodes[edge.source].degree += 1
                nodes[edge.target].degree += 1

        #
        # Bidirectional
        #

        lookup = {(e.source, e.target): e for e in edge_list}

        for edge in edge_list:
            reverse = lookup.get((edge.target, edge.source))

            edge.bidirectional = reverse is not None

        return NetworkGraph(
            nodes=list(nodes.values()),
            edges=edge_list,
        )

    @staticmethod
    def analyze(network: ZigbeeNetwork):

        graph = NetworkGraphAnalyzer.build(network)

        return sorted(
            graph.nodes,
            key=lambda n: n.degree,
            reverse=True,
        )
