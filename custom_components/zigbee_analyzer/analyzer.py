from homeassistant.core import State
from .topology import TopologyAnalyzer
from .analysis_result import AnalysisResult
from .health import HealthAnalyzer
from .topology import TopologyAnalyzer
from .diagnostics import DiagnosticsAnalyzer
from .mesh_score import MeshScoreCalculator
from .hotspots import HotspotAnalyzer
from .recommendations import RecommendationAnalyzer
from .root_cause import RootCauseAnalyzer

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

        mesh = MeshScoreCalculator.calculate(
            network
        )
           
        best_router = ""

        best_router_children = 0

        best_router_lqi = 0

        if routers:

            best_router = routers[0].friendly_name

            best_router_children = routers[0].children

            best_router_lqi = routers[0].average_lqi

            hotspots = HotspotAnalyzer.analyze(network)

            recommendations = RecommendationAnalyzer.analyze(network)

            recommendation_count = len(recommendations)

            top_recommendation_key = ""
            top_recommendation_placeholders = {}

            if recommendations:
                top_recommendation_key = recommendations[0].translation_key
                top_recommendation_placeholders = recommendations[0].placeholders
                top_recommendation_severity = recommendations[0].severity
            else:
                top_recommendation_severity = ""

            worst_device = ""
            worst_device_lqi = 0

            if hotspots:

                worst = hotspots[0].statistics
                worst_device = worst.friendly_name
                worst_device_lqi = worst.average_lqi      

        statistics = HotspotAnalyzer.build_statistics(network)

        diagnoses = RootCauseAnalyzer.analyze(
            network,
            statistics,
        )

        root_cause_count = len(diagnoses)

        top_root_cause = ""
        top_root_cause_severity = ""
        estimated_mesh_gain = 0

        if diagnoses:

            top_root_cause = diagnoses[0].friendly_name

            top_root_cause_severity = diagnoses[0].severity

            estimated_mesh_gain = diagnoses[0].estimated_gain
        
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
            mesh_score=mesh.score,
            mesh_rating=mesh.rating,
            mesh_stars=mesh.stars,
            mesh_penalties=mesh.penalties,
            worst_device=worst_device,
            worst_device_lqi=worst_device_lqi,
            hotspot_count=len(hotspots),
            recommendation_count=recommendation_count,
            top_recommendation_key=top_recommendation_key,
            top_recommendation_placeholders=top_recommendation_placeholders,
            top_recommendation=(
                recommendations[0].translation_key
                if recommendations
                else ""
            ),
            root_cause_count=root_cause_count,
            top_root_cause=top_root_cause,
            top_root_cause_severity=top_root_cause_severity,
            estimated_mesh_gain=estimated_mesh_gain,    
            top_recommendation_severity=top_recommendation_severity,        
        )