from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class Recommendation:
    severity: str
    title: str
    description: str


class RecommendationAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork) -> list[Recommendation]:

        recommendations: list[Recommendation] = []

        coordinator = network.coordinator

        if coordinator is None:
            return recommendations

        #
        # Endgeräte direkt am Coordinator
        #

        for node in network.children_of(coordinator.ieee_addr):

            if not node.is_end_device:
                continue

            recommendations.append(
                Recommendation(
                    severity="warning",
                    title="Move end device to router",
                    description=(
                        f"{node.friendly_name} is directly connected "
                        "to the coordinator. A nearby router would "
                        "improve the mesh."
                    ),
                )
            )

        #
        # Router ohne Kinder
        #

        for router in network.routers:

            if len(network.children_of(router.ieee_addr)) == 0:

                recommendations.append(
                    Recommendation(
                        severity="info",
                        title="Unused router",
                        description=(
                            f"Router '{router.friendly_name}' currently "
                            "has no child devices."
                        ),
                    )
                )

        return recommendations