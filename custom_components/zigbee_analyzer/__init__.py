from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry

from .const import DOMAIN


async def async_setup(
    hass: HomeAssistant,
    config: dict,
) -> bool:
    """Set up Zigbee Analyzer."""

    hass.data.setdefault(DOMAIN, {})

    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Set up Zigbee Analyzer from a config entry."""

    hass.data.setdefault(DOMAIN, {})

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload Zigbee Analyzer."""

    return True