from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

@dataclass(slots=True)
class ZigbeeNode:
    ieee_addr: str
    friendly_name: str
    device_type: str
    network_address: int

    manufacturer: str | None = None
    model: str | None = None
    last_seen: int | None = None

    @property
    def is_router(self) -> bool:
        return self.device_type == "Router"

    @property
    def is_end_device(self) -> bool:
        return self.device_type == "EndDevice"

    @property
    def is_coordinator(self) -> bool:
        return self.device_type == "Coordinator"


@dataclass(slots=True)
class ZigbeeLink:
    source_ieee: str
    target_ieee: str
    lqi: int

    depth: int = 0
    relationship: int = 0
    routes: list = field(default_factory=list)


@dataclass
class ZigbeeNetwork:
    nodes: list[ZigbeeNode] = field(default_factory=list)
    links: list[ZigbeeLink] = field(default_factory=list)

    @property
    def node_map(self) -> dict[str, ZigbeeNode]:
        return {
            node.ieee_addr: node
            for node in self.nodes
        }

    @property
    def coordinator(self) -> ZigbeeNode | None:

        for node in self.nodes:
            if node.is_coordinator:
                return node

        return None

    @property
    def routers(self) -> list[ZigbeeNode]:
        return [
            node
            for node in self.nodes
            if node.is_router
        ]

    @property
    def end_devices(self) -> list[ZigbeeNode]:
        return [
            node
            for node in self.nodes
            if node.is_end_device
        ]
    
    @cached_property
    def graph(self):

        from .graph import NetworkGraph

        return NetworkGraph(self)
    
    def get_node(
        self,
        ieee_addr: str,
    ) -> ZigbeeNode | None:

        return self.node_map.get(
            ieee_addr
        )

    def children_of(
        self,
        ieee_addr: str,
    ) -> list[ZigbeeNode]:

        result = []

        for link in self.links:

            if link.target_ieee != ieee_addr:
                continue

            node = self.get_node(
                link.source_ieee
            )

            if node:

                result.append(node)

        return result

    def parent_of(
        self,
        ieee_addr: str,
    ) -> ZigbeeNode | None:

        for link in self.links:

            if link.source_ieee != ieee_addr:
                continue

            return self.get_node(
                link.target_ieee
            )

        return None