from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


class ZigbeeAnalyzerEntity(CoordinatorEntity):

    _attr_has_entity_name = True

    @property
    def device_info(self):

        return DeviceInfo(
            identifiers={(DOMAIN, DOMAIN)},
            name="Zigbee Analyzer",
            manufacturer="FunMustBe",
            model="Mesh Analyzer",
        )