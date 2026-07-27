from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class Recommendation:
    severity: str

    title: str
    title_de: str

    description: str
    description_de: str


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

                    title="End device connected to coordinator",

                    title_de="Endgerät direkt am Coordinator",

                    description=(
                        f"{node.friendly_name} is currently connected "
                        f"directly to the Zigbee Coordinator. "
                        f"If a nearby router is available, repairing "
                        f"this device may improve the mesh quality."
                    ),

                    description_de=(
                        f"{node.friendly_name} ist derzeit direkt mit "
                        f"dem Zigbee-Koordinator verbunden. "
                        f"Falls sich ein Router in der Nähe befindet, "
                        f"kann ein erneutes Anlernen die Netzqualität "
                        f"verbessern."
                    )

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

                    title="Router currently has no child devices",

                    title_de="Router besitzt keine Endgeräte",

                    description=(
                        f"The router '{router.friendly_name}' currently "
                        f"has no child devices. If this router is "
                        f"strategically placed, repairing nearby devices "
                        f"may improve the network."
                    ),

                    description_de=(
                        f"Der Router '{router.friendly_name}' besitzt "
                        f"derzeit keine Endgeräte. Falls sich Geräte "
                        f"in seiner Nähe befinden, kann ein erneutes "
                        f"Anlernen die Last im Mesh besser verteilen."
                    )

                )

            )

        return recommendations