from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class DeviceStatistics:

    ieee_addr: str

    friendly_name: str

    incoming_lqi: int = 0
    outgoing_lqi: int = 0

    incoming_links: int = 0
    outgoing_links: int = 0

    children: int = 0

    @property
    def average_lqi(self) -> int:

        values = []

        if self.incoming_links:
            values.append(self.incoming_lqi)

        if self.outgoing_links:
            values.append(self.outgoing_lqi)

        if not values:
            return 0

        return round(sum(values) / len(values))

    @property
    def health(self) -> int:

        score = self.average_lqi

        score += self.children * 2

        return min(score, 100)