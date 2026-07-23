from __future__ import annotations

from .models import ZigbeeLink
from .models import ZigbeeNetwork
from .models import ZigbeeNode


class NetworkParser:

    @staticmethod
    def parse(data: dict) -> ZigbeeNetwork:

        network = ZigbeeNetwork()

        #
        # Nodes
        #

        for item in data.get("nodes", []):

            network.nodes.append(
                ZigbeeNode(
                    ieee_addr=item["ieeeAddr"],
                    friendly_name=item["friendlyName"],
                    device_type=item["type"],
                    network_address=item["networkAddress"],
                    manufacturer=item.get("manufacturerName"),
                    model=item.get("modelID"),
                    last_seen=item.get("lastSeen"),
                )
            )

        #
        # Links
        #

        for item in data.get("links", []):

            network.links.append(
                ZigbeeLink(
                    source_ieee=item["sourceIeeeAddr"],
                    target_ieee=item["targetIeeeAddr"],
                    lqi=item.get("lqi", 0),
                    depth=item.get("depth", 0),
                    relationship=item.get("relationship", 0),
                )
            )

        return network