from dataclasses import dataclass, field


@dataclass(slots=True)
class ZigbeeNode:
    ieee_addr: str
    friendly_name: str
    network_address: int
    device_type: str
    manufacturer: str | None = None
    model: str | None = None
    last_seen: int | None = None


@dataclass(slots=True)
class ZigbeeLink:
    source_ieee: str
    target_ieee: str
    lqi: int
    depth: int
    relationship: int
    routes: list = field(default_factory=list)


@dataclass(slots=True)
class ZigbeeNetwork:
    nodes: list[ZigbeeNode] = field(default_factory=list)
    links: list[ZigbeeLink] = field(default_factory=list)

    @property
    def routers(self):
        return [n for n in self.nodes if n.device_type == "Router"]

    @property
    def end_devices(self):
        return [n for n in self.nodes if n.device_type == "EndDevice"]

    @property
    def coordinator(self):
        for node in self.nodes:
            if node.device_type == "Coordinator":
                return node
        return None

    @property
    def node_map(self):

        return {
            node.ieee_addr: node
            for node in self.nodes
        }


    def get_node(self, ieee_addr):

        return self.node_map.get(ieee_addr)