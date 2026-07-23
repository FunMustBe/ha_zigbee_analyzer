from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class RouterInfo:
    ieee_addr: str
    friendly_name: str
    children: int = 0
    average_lqi: int = 0


class TopologyAnalyzer:
    """Analyze the Zigbee network topology."""

    @staticmethod
    def router_children(network: ZigbeeNetwork) -> dict[str, list[str]]:
        """Return all children for every router."""

        result: dict[str, list[str]] = {}

        for router in network.routers:
            result[router.ieee_addr] = []

        for link in network.links:
            if link.target_ieee in result:
                result[link.target_ieee].append(link.source_ieee)

        return result

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[RouterInfo]:
        """Return routers sorted by quality."""

        children = TopologyAnalyzer.router_children(network)

        routers: list[RouterInfo] = []

        for router in network.routers:

            lqi_values: list[int] = []

            for link in network.links:
                if link.target_ieee == router.ieee_addr:
                    lqi_values.append(link.lqi)

            average_lqi = (
                round(sum(lqi_values) / len(lqi_values))
                if lqi_values
                else 0
            )

            routers.append(
                RouterInfo(
                    ieee_addr=router.ieee_addr,
                    friendly_name=router.friendly_name,
                    children=len(children[router.ieee_addr]),
                    average_lqi=average_lqi,
                )
            )

        routers.sort(
            key=lambda r: (r.children, r.average_lqi),
            reverse=True,
        )

        return routers