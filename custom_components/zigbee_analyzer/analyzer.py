from homeassistant.core import State

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
    def analyze(self) -> dict:

        network = self._build_network()

        routers = [
            node for node in network.nodes
            if node.device_type == "Router"
        ]

        end_devices = [
            node for node in network.nodes
            if node.device_type == "EndDevice"
        ]

        coordinators = [
            node for node in network.nodes
            if node.device_type == "Coordinator"
        ]

        lqi_values = [
            link.lqi
            for link in network.links
        ]

        average_lqi = (
            round(sum(lqi_values) / len(lqi_values))
            if lqi_values
            else 0
        )

        return {
            "device_count": len(network.nodes),
            "router_count": len(routers),
            "end_device_count": len(end_devices),
            "coordinator_count": len(coordinators),
            "link_count": len(network.links),
            "average_lqi": average_lqi,
        }    