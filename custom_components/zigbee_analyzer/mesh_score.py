from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class MeshScoreResult:
    score: int
    rating: str
    stars: int
    penalties: list[str]


class MeshScoreCalculator:

    @staticmethod
    def calculate(network: ZigbeeNetwork) -> MeshScoreResult:

        score = 100
        penalties: list[str] = []

        coordinator = network.coordinator

        #
        # Coordinator
        #

        if coordinator:

            children = network.graph.child_count(
                coordinator.ieee_addr
            )

            if children > 8:

                score -= 10

                penalties.append(
                    f"Coordinator hat {children} direkte Kinder."
                )

            elif children > 5:

                score -= 5

                penalties.append(
                    f"Coordinator hat {children} direkte Kinder."
                )

        #
        # Router ohne Kinder
        #

        for router in network.routers:

            children = network.graph.child_count(
                router.ieee_addr
            )

            if children == 0:

                score -= 5

                penalties.append(
                    f"Router '{router.friendly_name}' hat keine Kinder."
                )

        #
        # Schwache Links
        #

        for link in network.links:

            if link.lqi < 40:

                score -= 2

                penalties.append(
                    f"Schwacher Link ({link.lqi})"
                )

        score = max(score, 0)

        if score >= 95:
            rating = "Excellent"
            stars = 5

        elif score >= 85:
            rating = "Very Good"
            stars = 4

        elif score >= 70:
            rating = "Good"
            stars = 3

        elif score >= 50:
            rating = "Fair"
            stars = 2

        else:
            rating = "Poor"
            stars = 1

        return MeshScoreResult(
            score=score,
            rating=rating,
            stars=stars,
            penalties=penalties,
        )