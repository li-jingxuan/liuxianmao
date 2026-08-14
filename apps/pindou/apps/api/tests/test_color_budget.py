from __future__ import annotations

import pytest

from pindou.imaging.color_budget import (
    ColorBudgetBand,
    classify_color_budget,
    resolve_color_budget,
)


@pytest.mark.parametrize(
    ("grid_size", "expected_max", "expected_band"),
    [
        (8, 8, ColorBudgetBand.RESTRAINED),
        (31, 8, ColorBudgetBand.RESTRAINED),
        (32, 30, ColorBudgetBand.BALANCED),
        (63, 30, ColorBudgetBand.BALANCED),
        (64, 54, ColorBudgetBand.RICH),
        (95, 54, ColorBudgetBand.RICH),
        (96, 54, ColorBudgetBand.RICH),
        (156, 54, ColorBudgetBand.RICH),
    ],
)
def test_auto_color_budget_follows_grid_boundaries(
    grid_size: int,
    expected_max: int,
    expected_band: ColorBudgetBand,
) -> None:
    budget = resolve_color_budget(
        grid_size=grid_size,
        color_set_size=264,
        legacy_max_colors=None,
    )

    assert budget.mode == "auto"
    assert budget.policy_version == "grid-color-budget-v2"
    assert budget.effective_max_colors == expected_max
    assert budget.prompt_band is expected_band


def test_explicit_budget_does_not_tighten_grid_aware_prompt_band() -> None:
    budget = resolve_color_budget(
        grid_size=104,
        color_set_size=48,
        legacy_max_colors=11,
    )

    assert budget.mode == "legacy-explicit"
    assert budget.effective_max_colors == 11
    assert budget.prompt_band is ColorBudgetBand.RICH


def test_color_budget_never_exceeds_available_colors_or_cells() -> None:
    assert (
        resolve_color_budget(
            grid_size=4,
            color_set_size=3,
            legacy_max_colors=24,
        ).effective_max_colors
        == 3
    )
    assert (
        resolve_color_budget(
            grid_size=2,
            color_set_size=24,
            legacy_max_colors=8,
        ).effective_max_colors
        == 4
    )


@pytest.mark.parametrize(
    ("effective_max_colors", "expected"),
    [
        (8, ColorBudgetBand.RESTRAINED),
        (11, ColorBudgetBand.RESTRAINED),
        (12, ColorBudgetBand.BALANCED),
        (17, ColorBudgetBand.BALANCED),
        (18, ColorBudgetBand.RICH),
        (24, ColorBudgetBand.RICH),
    ],
)
def test_color_budget_prompt_band_boundaries(
    effective_max_colors: int,
    expected: ColorBudgetBand,
) -> None:
    assert classify_color_budget(effective_max_colors) is expected
