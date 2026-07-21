from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.device_registry import DeviceInfo

from .const import DOMAIN


class ZigbeeAnalyzerEntity(CoordinatorEntity):

    @property
    def device_info(self):

        return DeviceInfo(
            identifiers={(DOMAIN, DOMAIN)},
            name="Zigbee Analyzer",
            manufacturer="FunMustBe",
            model="Analyzer",
        )