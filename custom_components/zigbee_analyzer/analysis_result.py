from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class AnalysisResult:
    device_count: int = 0
    router_count: int = 0
    end_device_count: int = 0
    coordinator_count: int = 0

    link_count: int = 0
    average_lqi: int = 0

    weak_links: int = 0
    excellent_links: int = 0

    router_children: dict[str, list[str]] = field(default_factory=dict)
    router_child_count: dict[str, int] = field(default_factory=dict)

    coordinator_children: int = 0

    best_router: str = ""
    best_router_children: int = 0
    best_router_lqi: int = 0

    diagnostics: list = field(default_factory=list)
    diagnostic_count: int = 0

    mesh_score: int = 0
    mesh_rating: str = ""
    mesh_stars: int = 0

    mesh_penalties: list[str] = field(default_factory=list)
    mesh_score_reasons: list[str] = field(default_factory=list)

    #
    # Hotspots
    #

    worst_device: str = ""
    worst_device_lqi: int = 0

    hotspot_count: int = 0

    recommendation_count: int = 0

    top_recommendation_key: str = ""

    top_recommendation_placeholders: dict[str, str] = field(default_factory=dict)

    root_cause_count: int = 0

    top_root_cause: str = ""

    top_root_cause_severity: str = ""

    estimated_mesh_gain: int = 0

# TODO Später löschen
    top_recommendation: str = ""

    top_recommendation_severity: str = ""