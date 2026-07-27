from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class Recommendation:
    severity: str

    translation_key: str

    placeholders: dict[str, str]

class RecommendationAnalyzer:

    @staticmethod
    def analyze(
        network: ZigbeeNetwork,
    ) -> list[Recommendation]:

        recommendations: list[Recommendation] = []

        coordinator = network.coordinator

        if coordinator is None:
            return recommendations

        #
        # Endgeräte direkt am Coordinator
        #

        for node in network.children_of(
            coordinator.ieee_addr
        ):

            if not node.is_end_device:
                continue

            recommendations.append(
                Recommendation(
                    severity="warning",
                    translation_key="end_device_connected_to_coordinator",
                    placeholders={
                        "device": node.friendly_name,
                    },
                )
            )

        #
        # Router ohne Kinder
        #

        for router in network.routers:

            if len(network.children_of(router.ieee_addr)) != 0:
                continue

            recommendations.append(
                Recommendation(
                    severity="info",
                    translation_key="unused_router",
                    placeholders={
                        "router": router.friendly_name,
                    },
                )
            )

        return recommendations