from __future__ import annotations

from dataclasses import dataclass

from .device_statistics import DeviceStatistics
from .models import ZigbeeNetwork


@dataclass(slots=True)
class DeviceDiagnosis:
    ieee_addr: str
    friendly_name: str

    severity: str

    reason_key: str

    recommendation_key: str

    estimated_gain: int


class RootCauseAnalyzer:

    @staticmethod
    def analyze(
        network: ZigbeeNetwork,
        statistics: dict[str, DeviceStatistics],
    ) -> list[DeviceDiagnosis]:

        diagnoses: list[DeviceDiagnosis] = []

        coordinator = network.coordinator

        if coordinator is None:
            return diagnoses

        for node in network.children_of(coordinator.ieee_addr):

            if not node.is_end_device:
                continue

            diagnoses.append(

                DeviceDiagnosis(

                    ieee_addr=node.ieee_addr,

                    friendly_name=node.friendly_name,

                    severity="warning",

                    reason_key="connected_to_coordinator",

                    recommendation_key="repair_near_router",

                    estimated_gain=8,

                )

            )

        return diagnoses