from __future__ import annotations

from dataclasses import dataclass

from .device_statistics import DeviceStatistics
from .models import ZigbeeNetwork


@dataclass(slots=True)
class ParentCandidate:
    ieee_addr: str
    friendly_name: str
    score: int


class ParentSelector:
    @staticmethod
    def select_best_parent(
        network: ZigbeeNetwork,
        statistics: dict[str, DeviceStatistics],
    ) -> ParentCandidate | None:

        best: ParentCandidate | None = None

        for router in network.routers:
            stats = statistics.get(router.ieee_addr)

            if stats is None:
                continue

            #
            # Router mit sehr schlechter Qualität ignorieren
            #

            if stats.average_lqi < 40:
                continue

            #
            # Router mit zu vielen Kindern leicht bestrafen
            #

            score = stats.health

            candidate = ParentCandidate(
                ieee_addr=router.ieee_addr,
                friendly_name=router.friendly_name,
                score=score,
            )

            if best is None or candidate.score > best.score:
                best = candidate

        return best
