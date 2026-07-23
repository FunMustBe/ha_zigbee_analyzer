from __future__ import annotations

from dataclasses import dataclass

from homeassistant.components.sensor import (
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import ZigbeeAnalyzerEntity


@dataclass(frozen=True, kw_only=True)
class ZigbeeAnalyzerSensorDescription(SensorEntityDescription):
    key: str


SENSORS: tuple[ZigbeeAnalyzerSensorDescription, ...] = (

    ZigbeeAnalyzerSensorDescription(
        key="device_count",
        name="Device Count",
        icon="mdi:devices",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="router_count",
        name="Router Count",
        icon="mdi:router-wireless",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="end_device_count",
        name="End Device Count",
        icon="mdi:cellphone",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="coordinator_count",
        name="Coordinator Count",
        icon="mdi:access-point-network",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="link_count",
        name="Link Count",
        icon="mdi:vector-line",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="average_lqi",
        name="Average LQI",
        icon="mdi:wifi",
    ),
    
    ZigbeeAnalyzerSensorDescription(
        key="weak_links",
        name="Weak Links",
        icon="mdi:alert",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="excellent_links",
        name="Excellent Links",
        icon="mdi:check-circle",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="coordinator_children",
        name="Coordinator Children",
        icon="mdi:access-point-network",
    ),

    ZigbeeAnalyzerSensorDescription(
    key="best_router",
    name="Best Router",
    icon="mdi:podium-gold",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="best_router_children",
        name="Best Router Children",
        icon="mdi:account-network",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="best_router_lqi",
        name="Best Router Average LQI",
        icon="mdi:wifi",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="diagnostic_count",
        name="Diagnostic Count",
        icon="mdi:stethoscope",
    ), 

    ZigbeeAnalyzerSensorDescription(
        key="mesh_score",
        name="Mesh Score",
        icon="mdi:star-circle",
    ),

    ZigbeeAnalyzerSensorDescription(
        key="mesh_score",
        name="Mesh Score",
        icon="mdi:star-circle",
    ),    

    ZigbeeAnalyzerSensorDescription(
        key="mesh_rating",
        name="Mesh Rating",
        icon="mdi:shield-check",
    ),    
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:

    coordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities(
        ZigbeeAnalyzerSensor(
            coordinator,
            description,
        )
        for description in SENSORS
    )


class ZigbeeAnalyzerSensor(
    ZigbeeAnalyzerEntity,
    SensorEntity,
):

    entity_description: ZigbeeAnalyzerSensorDescription

    def __init__(
        self,
        coordinator,
        description: ZigbeeAnalyzerSensorDescription,
    ):

        super().__init__(coordinator)

        self.entity_description = description

        self._attr_unique_id = f"zigbee_analyzer_{description.key}"

    @property
    def native_value(self):

        return getattr(
            self.coordinator.data,
            self.entity_description.key,
            None,
        )