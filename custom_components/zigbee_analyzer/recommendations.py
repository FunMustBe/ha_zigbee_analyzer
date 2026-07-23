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
    def analyze(
        network: ZigbeeNetwork,
    ) -> list[Recommendation]:

        recommendations = []

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

                    title="End device connected to coordinator",

                    description=(
                        f"{node.friendly_name} "
                        "should preferably connect "
                        "through a router."
                    )

                )

            )

        return recommendations