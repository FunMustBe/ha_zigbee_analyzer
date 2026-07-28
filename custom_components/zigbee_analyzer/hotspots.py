from __future__ import annotations

from dataclasses import dataclass

from .device_statistics import DeviceStatistics
from .models import ZigbeeNetwork


@dataclass(slots=True)
class Hotspot:

    statistics: DeviceStatistics


class HotspotAnalyzer:

    @staticmethod
    def build_statistics(network: ZigbeeNetwork) -> dict[str, DeviceStatistics]:

        stats: dict[str, DeviceStatistics] = {}

        #
        # Geräte anlegen
        #

        for node in network.nodes:

            stats[node.ieee_addr] = DeviceStatistics(
                ieee_addr=node.ieee_addr,
                friendly_name=node.friendly_name,
            )

        #
        # Links
        #

        for link in network.links:

            if link.lqi <= 1:
                continue

            src = stats.get(link.source_ieee)
            dst = stats.get(link.target_ieee)

            if src:

                src.outgoing_lqi += link.lqi
                src.outgoing_links += 1

            if dst:

                dst.incoming_lqi += link.lqi
                dst.incoming_links += 1

        #
        # Kinder
        #

        for router in network.routers:

            stats[router.ieee_addr].children = len(
                network.children_of(
                    router.ieee_addr
                )
            )

        return stats

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[Hotspot]:

        stats = HotspotAnalyzer.build_statistics(network)

        result = [
            Hotspot(statistics=s)
            for s in stats.values()
            if s.average_lqi > 0
        ]

        result.sort(
            key=lambda x: x.statistics.health
        )

        return result