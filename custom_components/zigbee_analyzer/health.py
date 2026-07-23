from __future__ import annotations

from .models import ZigbeeNetwork


class HealthAnalyzer:

    @staticmethod
    def coordinator_children(network: ZigbeeNetwork) -> int:

        coordinator = network.coordinator

        if coordinator is None:
            return 0

        count = 0

        for link in network.links:

            if link.target_ieee == coordinator.ieee_addr:

                count += 1

        return count