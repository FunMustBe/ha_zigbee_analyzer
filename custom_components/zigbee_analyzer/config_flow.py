from __future__ import annotations

from homeassistant import config_entries
from homeassistant.const import CONF_NAME

from .const import DOMAIN, NAME


class ZigbeeAnalyzerConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    """Handle a config flow for Zigbee Analyzer."""

    VERSION = 1

    async def async_step_user(
        self,
        user_input=None,
    ):
        """Handle the initial setup."""

        if user_input is not None:

            return self.async_create_entry(
                title=NAME,
                data=user_input,
            )

        return self.async_show_form(
            step_id="user"
        )