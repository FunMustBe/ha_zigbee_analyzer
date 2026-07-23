from __future__ import annotations

from dataclasses import dataclass

from .models import ZigbeeNetwork


@dataclass(slots=True)
class Diagnostic:

    severity: str

    title: str

    description: str


class DiagnosticsAnalyzer:

    @staticmethod
    def analyze(network: ZigbeeNetwork):

        diagnostics = []

        #
        # Schwache Links
        #

        for link in network.links:

            if link.lqi >= 50:
                continue

            source = network.get_node(link.source_ieee)

            target = network.get_node(link.target_ieee)

            diagnostics.append(

                Diagnostic(

                    severity="warning",

                    title="Weak Link",

                    description=(
                        f"{source.friendly_name} → "
                        f"{target.friendly_name} "
                        f"(LQI {link.lqi})"
                    ),

                )

            )

        return diagnostics