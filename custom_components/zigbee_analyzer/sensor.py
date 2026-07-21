from homeassistant.components.sensor import SensorEntity

from .entity import ZigbeeAnalyzerEntity


SENSORS = [
    (
        "device_count",
        "Device Count",
        "mdi:devices",
    ),
]


async def async_setup_entry(
    hass,
    entry,
    async_add_entities,
):

    coordinator = hass.data["zigbee_analyzer"][entry.entry_id]

    entities = []

    for key, name, icon in SENSORS:

        entities.append(
            ZigbeeAnalyzerSensor(
                coordinator,
                key,
                name,
                icon,
            )
        )

    async_add_entities(entities)


class ZigbeeAnalyzerSensor(
    ZigbeeAnalyzerEntity,
    SensorEntity,
):

    def __init__(
        self,
        coordinator,
        key,
        name,
        icon,
    ):

        super().__init__(coordinator)

        self._key = key
        self._attr_name = f"Zigbee {name}"
        self._attr_unique_id = f"zigbee_{key}"
        self._attr_icon = icon

    @property
    def native_value(self):

        return self.coordinator.data.get(self._key)