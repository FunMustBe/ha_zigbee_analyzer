from homeassistant.core import State
from .topology import TopologyAnalyzer
from .analysis_result import AnalysisResult
from .health import HealthAnalyzer
from .topology import TopologyAnalyzer
from .diagnostics import DiagnosticsAnalyzer

from .models import (
    ZigbeeLink,
    ZigbeeNetwork,
    ZigbeeNode,
)


class MeshAnalyzer:

    def __init__(self, state: State | None):

        self.state = state

    def _build_network(self) -> ZigbeeNetwork:

        network = ZigbeeNetwork()

        if self.state is None:
            return network

        for node in self.state.attributes.get("nodes", []):

            network.nodes.append(
                ZigbeeNode(
                    ieee_addr=node.get("ieeeAddr", ""),
                    friendly_name=node.get("friendlyName", ""),
                    network_address=node.get("networkAddress", 0),
                    device_type=node.get("type", ""),
                    manufacturer=node.get("manufacturerName"),
                    model=node.get("modelID"),
                    last_seen=node.get("lastSeen"),
                )
            )

        for link in self.state.attributes.get("links", []):

            network.links.append(
                ZigbeeLink(
                    source_ieee=link.get("sourceIeeeAddr", ""),
                    target_ieee=link.get("targetIeeeAddr", ""),
                    lqi=link.get("lqi", 0),
                    depth=link.get("depth", 0),
                    relationship=link.get("relationship", 0),
                    routes=link.get("routes", []),
                )
            )

        return network

    def analyze(self):

        network = self._build_network()

        routers = TopologyAnalyzer.analyze(network)
        diagnostics = DiagnosticsAnalyzer.analyze(network)

        lqi_values = [
            link.lqi
            for link in network.links
        ]

        average_lqi = (
            round(sum(lqi_values) / len(lqi_values))
            if lqi_values else 0
        )

        weak_links = len(
            [l for l in network.links if l.lqi < 80]
        )

        excellent_links = len(
            [l for l in network.links if l.lqi >= 150]
        )

        router_children = TopologyAnalyzer.router_children(network)

        router_child_count = {
            ieee: len(children)
            for ieee, children in router_children.items()
        }

        coordinator_children = (
            HealthAnalyzer.coordinator_children(network)
        )     
           
        best_router = ""

        best_router_children = 0

        best_router_lqi = 0

        if routers:

            best_router = routers[0].friendly_name

            best_router_children = routers[0].children

            best_router_lqi = routers[0].average_lqi
        
        return AnalysisResult(
            device_count=len(network.nodes),
            router_count=len(network.routers),
            end_device_count=len(network.end_devices),
            coordinator_count=1 if network.coordinator else 0,
            link_count=len(network.links),
            average_lqi=average_lqi,
            weak_links=weak_links,
            excellent_links=excellent_links,
            router_children=router_children,
            router_child_count=router_child_count,
            coordinator_children=coordinator_children,
            best_router=best_router,
            best_router_children=best_router_children,
            best_router_lqi=best_router_lqi,
            diagnostics=diagnostics,
            diagnostic_count=len(diagnostics),
        )