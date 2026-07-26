from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class Hotspot:

    friendly_name: str
    average_lqi: int
    link_count: int


class HotspotAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[Hotspot]:

        devices: dict[str, list[int]] = {}

        for link in network.links:

            if link.lqi <= 1:
                continue

            devices.setdefault(
                link.source_ieee,
                []
            ).append(link.lqi)

        result: list[Hotspot] = []

        for node in network.nodes:

            values = devices.get(node.ieee_addr)

            if not values:
                continue

            result.append(
                Hotspot(
                    friendly_name=node.friendly_name,
                    average_lqi=round(sum(values) / len(values)),
                    link_count=len(values),
                )
            )

        result.sort(
            key=lambda x: x.average_lqi
        )

        return result