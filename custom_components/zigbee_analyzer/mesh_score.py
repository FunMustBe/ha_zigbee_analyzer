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
    """Calculate an overall mesh quality score."""

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

            if children > 10:
                score -= 10
                penalties.append(
                    f"Coordinator hat {children} direkte Kinder."
                )

            elif children > 8:
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
                score -= 3
                penalties.append(
                    f"Router '{router.friendly_name}' hat keine Kinder."
                )

        #
        # Schwache Links
        #
        # Nur Links berücksichtigen,
        # die vermutlich echte Parent->Child Beziehungen sind.
        #

        weak_links = 0

        for link in network.links:

            #
            # Neighbor-Table Artefakte ignorieren
            #

            if link.lqi <= 1:
                continue

            #
            # Sehr niedrige LQI ignorieren.
            # Diese entstehen häufig durch unvollständige
            # Neighbor-Informationen des Coordinators.
            #

            if link.lqi < 20:
                continue

            if link.lqi < 40:
                weak_links += 1

        if weak_links:
            score -= weak_links

            penalties.append(
                f"{weak_links} schwache Links"
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