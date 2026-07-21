from __future__ import annotations

from datetime import timedelta

import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .analyzer import MeshAnalyzer
from .const import NETWORKMAP_SENSOR

_LOGGER = logging.getLogger(__name__)

class ZigbeeAnalyzerCoordinator(DataUpdateCoordinator):

    def __init__(self, hass: HomeAssistant):

        super().__init__(
            hass,
            _LOGGER,
            name="zigbee_analyzer",
            update_interval=timedelta(seconds=30),
        )

    async def _async_update_data(self):

        state = self.hass.states.get(NETWORKMAP_SENSOR)

        analyzer = MeshAnalyzer(state)

        return analyzer.analyze()