from homeassistant.core import State


class MeshAnalyzer:
    """Analyzes a Zigbee2MQTT network map."""

    def __init__(self, network_map: State | None):

        self.network_map = network_map

    def analyze(self):

        if self.network_map is None:
            return {}

        nodes = self.network_map.attributes.get("nodes", [])

        links = self.network_map.attributes.get("links", [])

        routers = [
            node
            for node in nodes
            if node.get("type") == "Router"
        ]

        end_devices = [
            node
            for node in nodes
            if node.get("type") == "EndDevice"
        ]

        coordinators = [
            node
            for node in nodes
            if node.get("type") == "Coordinator"
        ]

        lqi_values = [
            link.get("lqi", 0)
            for link in links
        ]

        average_lqi = (
            round(sum(lqi_values) / len(lqi_values))
            if lqi_values
            else 0
        )

        return {

            "device_count": len(nodes),

            "router_count": len(routers),

            "end_device_count": len(end_devices),

            "coordinator_count": len(coordinators),

            "link_count": len(links),

            "average_lqi": average_lqi,
        }