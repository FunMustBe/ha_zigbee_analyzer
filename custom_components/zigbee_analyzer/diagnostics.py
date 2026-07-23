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

            source_name = source.friendly_name if source else link.source_ieee

            target_name = target.friendly_name if target else link.target_ieee

            diagnostics.append(

                Diagnostic(

                    severity="warning",

                    title="Weak Link",

                    description=(
                        f"{source_name} → "
                        f"{target_name} "
                        f"(LQI {link.lqi})"
                    ),

                )

            )

        return diagnostics