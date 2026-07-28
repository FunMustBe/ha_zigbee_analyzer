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
    def average_incoming_lqi(self) -> int:

        if self.incoming_links == 0:
            return 0

        return round(self.incoming_lqi / self.incoming_links)

    @property
    def average_outgoing_lqi(self) -> int:

        if self.outgoing_links == 0:
            return 0

        return round(self.outgoing_lqi / self.outgoing_links)

    @property
    def average_lqi(self) -> int:

        values = []

        if self.incoming_links:
            values.append(self.average_incoming_lqi)

        if self.outgoing_links:
            values.append(self.average_outgoing_lqi)

        if not values:
            return 0

        return round(sum(values) / len(values))

    @property
    def child_penalty(self) -> int:
        """
        Kleine Router dürfen ruhig einige Kinder haben.
        Ab 4 Kindern beginnt eine leichte Abwertung.
        """

        return max(0, self.children - 4) * 3

    @property
    def health(self) -> int:

        score = self.average_lqi

        score -= self.child_penalty

        return max(0, min(score, 100))