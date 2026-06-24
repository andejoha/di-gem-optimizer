"""Static game data for the Diablo Immortal gem resonance optimizer.

Contains hardcoded lookup tables for the datasets that are fixed by
the game and never change between player sessions:

- ``COST_1STAR``: upgrade cost table for 1-star gems (ranks 0–10, no sub-ranks).
- ``COST_2STAR``: upgrade cost table for 2-star gems (ranks 0–10).
- ``COST_5STAR``: upgrade cost table for 5-star gems (ranks 0–10 with sub-ranks).
- ``GEMS``: unified gem definition dict mapping integer gem ID to GemDef (includes bonus requirements).
- ``DIRECT_COST_2STAR`` / ``DIRECT_COST_5STAR``: cumulative material requirements
  for direct rank upgrades (rank N → N+1, skipping sub-ranks).
- ``RESONANCE_5STAR``: base resonance by rank and active star count for 5-star gems.
- ``RESONANCE_2STAR``: base resonance by rank for 2-star gems (stored for future use).
- ``RESONANCE_1STAR``: base resonance by rank for 1-star gems (stored for future use).

These replace the previously CSV-based ``--cost-2star``, ``--cost-5star``,
and ``--socket-bonuses`` CLI arguments.  Only player-specific inputs
(gem setup, gem power, inventory) remain as configurable file paths.

If the game is patched with new rank tiers or updated bonus tables, edit
this module directly.
"""

from app.core.models import GemDef, UpgradeCostEntry


def _e(rank: str, gems: int, power: int) -> UpgradeCostEntry:
    return UpgradeCostEntry(corrected_rank=rank, required_gems=gems, required_gem_power=power)


# ---------------------------------------------------------------------------
# 1-star gem upgrade costs
# ---------------------------------------------------------------------------

COST_1STAR: dict[str, UpgradeCostEntry] = {
    "0":  _e("0",  0,   0),
    "1":  _e("1",  1,   0),
    "2":  _e("2",  1,   1),
    "3":  _e("3",  1,   6),
    "4":  _e("4",  1,  16),
    "5":  _e("5",  1,  31),
    "6":  _e("6",  2,  51),
    "7":  _e("7",  3,  76),
    "8":  _e("8",  4, 106),
    "9":  _e("9",  5, 146),
    "10": _e("10", 6, 196),
}
"""Upgrade cost lookup table for 1-star gems.

Keys are rank strings (``"0"`` through ``"10"``; no sub-ranks exist for
1-star gems).  Values are ``UpgradeCostEntry`` instances storing cumulative
gem copies and gem power required to reach that rank from rank 0.
"""


# ---------------------------------------------------------------------------
# 2-star gem upgrade costs
# ---------------------------------------------------------------------------

COST_2STAR: dict[str, UpgradeCostEntry] = {
    "0":    _e("0",    0,   0),
    "1":    _e("1",    1,   0),
    "2":    _e("2",    1,   5),
    "3":    _e("3",    1,  20),
    "4":    _e("4",    2,  45),
    "4.1":  _e("4.1",  3,  55),
    "5":    _e("5",    4,  65),
    "5.1":  _e("5.1",  5,  80),
    "5.2":  _e("5.2",  6,  95),
    "5.3":  _e("5.3",  7, 110),
    "5.4":  _e("5.4",  8, 125),
    "6":    _e("6",    9, 150),
    "6.1":  _e("6.1", 10, 165),
    "6.2":  _e("6.2", 11, 180),
    "6.3":  _e("6.3", 12, 195),
    "6.4":  _e("6.4", 13, 210),
    "7":    _e("7",   14, 235),
    "7.1":  _e("7.1", 15, 250),
    "7.2":  _e("7.2", 16, 265),
    "7.3":  _e("7.3", 17, 280),
    "7.4":  _e("7.4", 18, 295),
    "7.5":  _e("7.5", 19, 310),
    "8":    _e("8",   20, 340),
    "8.1":  _e("8.1", 21, 355),
    "8.2":  _e("8.2", 22, 370),
    "8.3":  _e("8.3", 23, 385),
    "8.4":  _e("8.4", 24, 400),
    "8.5":  _e("8.5", 25, 415),
    "8.6":  _e("8.6", 26, 430),
    "8.7":  _e("8.7", 27, 445),
    "8.8":  _e("8.8", 28, 460),
    "9":    _e("9",   29, 490),
    "9.1":  _e("9.1",  30, 505),
    "9.2":  _e("9.2",  31, 520),
    "9.3":  _e("9.3",  32, 535),
    "9.4":  _e("9.4",  33, 550),
    "9.5":  _e("9.5",  34, 565),
    "9.6":  _e("9.6",  35, 580),
    "9.7":  _e("9.7",  36, 595),
    "9.8":  _e("9.8",  37, 610),
    "9.9":  _e("9.9",  38, 625),
    "9.10": _e("9.10", 39, 640),
    "9.11": _e("9.11", 40, 655),
    "10":   _e("10",   41, 685),
}
"""Upgrade cost lookup table for 2-star gems.

Keys are rank strings (``"0"`` through ``"10"`` including sub-ranks such
as ``"5.2"``).  Values are ``UpgradeCostEntry`` instances storing cumulative
gem copies and gem power required to reach that rank from rank 0.
"""


# ---------------------------------------------------------------------------
# 5-star gem upgrade costs
# ---------------------------------------------------------------------------

COST_5STAR: dict[str, UpgradeCostEntry] = {
    "0":    _e("0",    0,    0),
    "1":    _e("1",    1,    0),
    "2":    _e("2",    1,   50),
    "3":    _e("3",    2,  125),
    "4":    _e("4",    3,  225),
    "4.1":  _e("4.1",  4,  275),
    "4.2":  _e("4.2",  5,  325),
    "4.3":  _e("4.3",  6,  375),
    "4.4":  _e("4.4",  7,  425),
    "5":    _e("5",    8,  475),
    "5.1":  _e("5.1",  9,  535),
    "5.2":  _e("5.2", 10,  595),
    "5.3":  _e("5.3", 11,  655),
    "5.4":  _e("5.4", 12,  715),
    "5.5":  _e("5.5", 13,  775),
    "6":    _e("6",   14,  850),
    "6.1":  _e("6.1", 15,  910),
    "6.2":  _e("6.2", 16,  970),
    "6.3":  _e("6.3", 17, 1030),
    "6.4":  _e("6.4", 18, 1090),
    "6.5":  _e("6.5", 19, 1150),
    "6.6":  _e("6.6", 20, 1210),
    "6.7":  _e("6.7", 21, 1270),
    "6.8":  _e("6.8", 22, 1330),
    "6.9":  _e("6.9", 23, 1390),
    "6.10": _e("6.10", 24, 1450),
    "6.11": _e("6.11", 25, 1510),
    "7":    _e("7",   26, 1575),
    "7.1":  _e("7.1", 27, 1635),
    "7.2":  _e("7.2", 28, 1695),
    "7.3":  _e("7.3", 29, 1755),
    "7.4":  _e("7.4", 30, 1815),
    "7.5":  _e("7.5", 31, 1875),
    "7.6":  _e("7.6", 32, 1935),
    "7.7":  _e("7.7", 33, 1995),
    "7.8":  _e("7.8", 34, 2055),
    "7.9":  _e("7.9", 35, 2115),
    "7.10": _e("7.10", 36, 2175),
    "7.11": _e("7.11", 37, 2235),
    "8":    _e("8",   38, 2300),
    "8.1":  _e("8.1", 39, 2360),
    "8.2":  _e("8.2", 40, 2420),
    "8.3":  _e("8.3", 41, 2480),
    "8.4":  _e("8.4", 42, 2540),
    "8.5":  _e("8.5", 43, 2600),
    "8.6":  _e("8.6", 44, 2660),
    "8.7":  _e("8.7", 45, 2720),
    "8.8":  _e("8.8", 46, 2780),
    "8.9":  _e("8.9", 47, 2840),
    "8.10": _e("8.10", 48, 2900),
    "8.11": _e("8.11", 49, 2960),
    "8.12": _e("8.12", 50, 3020),
    "8.13": _e("8.13", 51, 3080),
    "8.14": _e("8.14", 52, 3140),
    "8.15": _e("8.15", 53, 3200),
    "8.16": _e("8.16", 54, 3260),
    "8.17": _e("8.17", 55, 3320),
    "9":    _e("9",   56, 3375),
    "9.1":  _e("9.1", 57, 3435),
    "9.2":  _e("9.2", 58, 3495),
    "9.3":  _e("9.3", 59, 3555),
    "9.4":  _e("9.4", 60, 3615),
    "9.5":  _e("9.5", 61, 3675),
    "9.6":  _e("9.6", 62, 3735),
    "9.7":  _e("9.7", 63, 3795),
    "9.8":  _e("9.8", 64, 3855),
    "9.9":  _e("9.9", 65, 3915),
    "9.10": _e("9.10", 66, 3975),
    "9.11": _e("9.11", 67, 4035),
    "9.12": _e("9.12", 68, 4095),
    "9.13": _e("9.13", 69, 4155),
    "9.14": _e("9.14", 70, 4215),
    "9.15": _e("9.15", 71, 4275),
    "9.16": _e("9.16", 72, 4335),
    "9.17": _e("9.17", 73, 4395),
    "10":   _e("10",  74, 4450),
}
"""Upgrade cost lookup table for 5-star gems.

Keys are rank strings (``"0"`` through ``"10"`` including sub-ranks such
as ``"6.10"``).  Values are ``UpgradeCostEntry`` instances storing cumulative
gem copies and gem power required to reach that rank from rank 0.
"""


# ---------------------------------------------------------------------------
# Gem definitions with stable integer IDs
# ---------------------------------------------------------------------------
# IDs use the star tier as the leading digit: 5xxx = 5-star, 2xxx = 2-star,
# 1xxx = 1-star. IDs are permanent — new gems always get the next available
# ID within their tier and existing IDs are never reused.

def _g(gem_id: int, name: str, star_rating: int, bonus_ids: list[int]) -> GemDef:
    return GemDef(id=gem_id, name=name, star_rating=star_rating, bonus_gem_ids=bonus_ids)


GEMS: dict[int, GemDef] = {
    # ----- 5-star gems (5001–5027) -----
    # bonus_gem_ids: 5 entries per gem, one per socket (rank 3, 4, 5, 6, 7 unlocks)
    5001: _g(5001, "Phoenix Ashes",          5, [2001, 2003, 2004, 5002, 5004]),
    5002: _g(5002, "Chip of Stone Flesh",    5, [2002, 2006, 2007, 5001, 5005]),
    5003: _g(5003, "Frozen Heart",           5, [2002, 2005, 2012, 5012, 5006]),
    5004: _g(5004, "Howler's Call",          5, [2004, 2005, 2006, 5012, 5001]),
    5005: _g(5005, "Seeping Bile",           5, [2007, 2008, 2001, 5006, 5010]),
    5006: _g(5006, "Blessing of the Worthy", 5, [2003, 2002, 2005, 5007, 5005]),
    5007: _g(5007, "Blood-Soaked Jade",      5, [2006, 2007, 2008, 5012, 5009]),
    5008: _g(5008, "Concentrated Will",      5, [2013, 2004, 2010, 5003, 5011]),
    5009: _g(5009, "Echoing Shade",          5, [2005, 2006, 2007, 5002, 5010]),
    5010: _g(5010, "Bottled Hope",           5, [2008, 2001, 2003, 5004, 5006]),
    5011: _g(5011, "Hellfire Fragment",      5, [2013, 2012, 2010, 5008, 5003]),
    5012: _g(5012, "Zwensons Haunting",      5, [2003, 2006, 2008, 5007, 5009]),
    5013: _g(5013, "Gloom Cask",             5, [2002, 2001, 2012, 5001, 5002]),
    5014: _g(5014, "Starfire Shard",         5, [2013, 2008, 2010, 5011, 5008]),
    5015: _g(5015, "Spiteful Blood",         5, [2005, 2004, 2013, 5003, 5009]),
    5016: _g(5016, "Void Spark",             5, [2011, 2012, 2010, 5004, 5010]),
    5017: _g(5017, "Maw Of The Deep",        5, [2005, 2003, 2011, 5011, 5008]),
    5018: _g(5018, "Roiling Consequence",    5, [2011, 2007, 2004, 5010, 5013]),
    5019: _g(5019, "Hilt of Many Realms",    5, [2011, 2014, 2008, 5007, 5013]),
    5020: _g(5020, "Stormvault",             5, [2016, 2015, 2014, 5015, 5014]),
    5021: _g(5021, "Wulfheort",              5, [2014, 2011, 2017, 5017, 5016]),
    5022: _g(5022, "Golden Firmament",       5, [2018, 2016, 2015, 5014, 5015]),
    5023: _g(5023, "Colossus Engine",        5, [2020, 2015, 2014, 5017, 5016]),
    5024: _g(5024, "Blood Floe",             5, [2023, 2020, 2021, 5014, 5013]),
    5025: _g(5025, "Haunt Coil",             5, [2025, 2016, 2017, 5005, 5015]),
    5026: _g(5026, "Fated Trail",            5, [2014, 2023, 2025, 5006, 5017]),
    5027: _g(5027, "Leviathan Tomb",         5, [2003, 2026, 2028, 5021, 5022]),
    5028: _g(5028, "Hellbound Desire",       5, [2023, 2025, 2017, 5009, 5016]),

    # ----- 2-star gems (2001–2032) -----
    # bonus_gem_ids: 3 entries per gem (rank 3, 5, 7 unlocks)
    2001: _g(2001, "Power & Command",   2, [1007, 2003, 2004]),
    2002: _g(2002, "Follower's Burden", 2, [1017, 2001, 2005]),
    2003: _g(2003, "The Hunger",        2, [1013, 2002, 2007]),
    2004: _g(2004, "Bloody Reach",      2, [1004, 2008, 2001]),
    2005: _g(2005, "Battleguard",       2, [1005, 2004, 2002]),
    2006: _g(2006, "Unity Crystal",     2, [1017, 2002, 2007]),
    2007: _g(2007, "Cutthroat's Grin",  2, [1001, 2006, 2008]),
    2008: _g(2008, "Lightning Core",    2, [1011, 2001, 2003]),
    2009: _g(2009, "Fervent Fang",      2, [1003, 2004, 2005]),
    2010: _g(2010, "Volatility Shard",  2, [1015, 2013, 2012]),
    2011: _g(2011, "Pain Clasp",        2, [1016, 2012, 2003]),
    2012: _g(2012, "The Abiding Curse", 2, [1016, 2007, 2006]),
    2013: _g(2013, "Kir Sling",         2, [1015, 2010, 2012]),
    2014: _g(2014, "Ironbane",          2, [1015, 2010, 2013]),
    2015: _g(2015, "Mother's Lament",   2, [1003, 2002, 2001]),
    2016: _g(2016, "Viper's Bite",      2, [1005, 2010, 2011]),
    2017: _g(2017, "Igneous Scorn",     2, [1004, 2011, 2006]),
    2018: _g(2018, "Tear of the Comet", 2, [1013, 2014, 2013]),
    2019: _g(2019, "Grim Rhythm",       2, [1008, 2011, 2010]),
    2020: _g(2020, "Mossthorn",         2, [1008, 2014, 2015]),
    2021: _g(2021, "Cold Confidant",    2, [1008, 2017, 2016]),
    2022: _g(2022, "Mourneskull",       2, [1018, 2017, 2018]),
    2023: _g(2023, "Mercy's Harvest",   2, [1022, 2020, 2018]),
    2024: _g(2024, "Crimson Behelit",   2, [1021, 2021, 2017]),
    2025: _g(2025, "Specter Glass",     2, [1019, 2020, 2016]),
    2026: _g(2026, "Stubborn Oracle",   2, [1023, 2014, 2015]),
    2027: _g(2027, "Manaflux",          2, [1004, 2023, 2021]),
    2028: _g(2028, "Fading Nostrum",    2, [1005, 2013, 2012]),
    2029: _g(2029, "Rampart Torch",     2, [1021, 2001, 2026]),
    2030: _g(2030, "War Herald",        2, [1024, 2015, 2023]),
    2031: _g(2031, "Tundra Blight",     2, [1026, 2017, 2016]),
    2032: _g(2032, "The Crucible",      2, [1023, 2026, 2023]),
    2033: _g(2033, "Baneboil",          2, [1028, 2029, 2028]),
    2034: _g(2034, "The Jolted Eye",    2, [1012, 2004, 2010]),

    # ----- 1-star gems (1001–1029) -----
    # bonus_gem_ids: 2 entries per gem (rank 3, 7 unlocks)
    1001: _g(1001, "The Black Rose",          1, [1009, 1010]),
    1002: _g(1002, "Nightmare Wreath",        1, [1011, 1012]),
    1003: _g(1003, "Chained Death",           1, [1006, 1007]),
    1004: _g(1004, "Everlasting Torment",     1, [1009, 1010]),
    1005: _g(1005, "Mocking Laughter",        1, [1012, 1007]),
    1006: _g(1006, "Seled's Weakening",       1, [1010, 1014]),
    1007: _g(1007, "Berserker's Eye",         1, [1004, 1005]),
    1008: _g(1008, "Lo's Focused Gaze",       1, [1001, 1016]),
    1009: _g(1009, "Trickshot Gem",           1, [1017, 1002]),
    1010: _g(1010, "Pain of Subjugation",     1, [1012, 1013]),
    1011: _g(1011, "Respite Stone",           1, [1004, 1006]),
    1012: _g(1012, "Ca'arsen's Invigoration", 1, [1014, 1001]),
    1013: _g(1013, "Defiant Soul",            1, [1002, 1003]),
    1014: _g(1014, "Zod Stone",               1, [1005, 1006]),
    1015: _g(1015, "Heartstone",              1, [1013, 1002]),
    1016: _g(1016, "Blessed Pebble",          1, [1014, 1011]),
    1017: _g(1017, "Freedom and Devotion",    1, [1009, 1003]),
    1018: _g(1018, "Exigent Echo",            1, [1001, 1002]),
    1019: _g(1019, "Eye of the Unyielding",   1, [1006, 1007]),
    1020: _g(1020, "Unrefined Passage",       1, [1010, 1009]),
    1021: _g(1021, "Misery Elixir",           1, [1011, 1012]),
    1022: _g(1022, "Lucent Watcher",          1, [1015, 1014]),
    1023: _g(1023, "Entropic Well",           1, [1018, 1016]),
    1024: _g(1024, "Havoc Bearer",            1, [1019, 1017]),
    1025: _g(1025, "Faltergrasp",             1, [1021, 1022]),
    1026: _g(1026, "Surging Sea",             1, [1023, 1024]),
    1027: _g(1027, "Mountain Toe",            1, [1017, 1007]),
    1028: _g(1028, "Flaystone",               1, [1009, 1010]),
    1029: _g(1029, "Taxman's Pity",           1, [1025, 1021]),
    1030: _g(1030, "Interminus Stone",        1, [1015, 1013]),
}
"""All gem definitions keyed by stable integer ID.

ID format: first digit encodes star tier (5xxx/2xxx/1xxx), remaining digits
are sequential within the tier. IDs are permanent — new gems append at the
end of each tier range and existing IDs are never reused.

bonus_gem_ids: ordered list of gem IDs required for each bonus socket.
  - 5-star: 5 entries (sockets unlocked at ranks 3, 4, 5, 6, 7)
  - 2-star: 3 entries (sockets unlocked at ranks 3, 5, 7)
  - 1-star: 2 entries (sockets unlocked at ranks 3, 7)
"""

GEM_BY_NAME: dict[str, GemDef] = {g.name: g for g in GEMS.values()}
"""Lookup table from display name to GemDef. Used for API request validation."""


# ---------------------------------------------------------------------------
# Direct rank upgrade material cost tables
# ---------------------------------------------------------------------------
# These tables encode the CUMULATIVE number of material gems required to bring
# a gem to a given whole rank using the direct upgrade system (rank N → N+1,
# skipping all sub-ranks).
#
# Each entry maps a target whole rank (int) to a dict of {material_rank: count}.
# Material tiers are always rank 1, rank 3, and rank 5.
#
# For ranks 0–4 the direct upgrade is identical in cost to the partial rank
# system (gem power + rank-1 copies), so this table only provides meaningful
# new information starting at rank 5.  Ranks 5+ cost zero gem power — only
# the material gems listed here are consumed.
#
# To compute the incremental cost of a single N → N+1 transition, subtract
# the row for N from the row for N+1 (use ``get_direct_incremental_materials``).

DIRECT_COST_2STAR: dict[int, dict[int, int]] = {
    0:  {1: 0, 3: 0, 5: 0},
    1:  {1: 1, 3: 0, 5: 0},
    2:  {1: 1, 3: 0, 5: 0},
    3:  {1: 1, 3: 0, 5: 0},
    4:  {1: 2, 3: 0, 5: 0},
    5:  {1: 3, 3: 1, 5: 0},
    6:  {1: 3, 3: 2, 5: 1},
    7:  {1: 3, 3: 3, 5: 2},
    8:  {1: 3, 3: 5, 5: 3},
    9:  {1: 3, 3: 6, 5: 5},
    10: {1: 3, 3: 6, 5: 8},
}
"""Cumulative direct-upgrade material requirements for 2-star gems.

Outer key is the target whole rank (0–10).  Inner keys are material tiers
(1, 3, 5); values are cumulative counts of same-name gems at that tier
that must have been consumed to reach the target rank.
"""

DIRECT_COST_5STAR: dict[int, dict[int, int]] = {
    0:  {1: 0, 3:  0, 5: 0},
    1:  {1: 1, 3:  0, 5: 0},
    2:  {1: 1, 3:  0, 5: 0},
    3:  {1: 2, 3:  0, 5: 0},
    4:  {1: 3, 3:  0, 5: 0},
    5:  {1: 4, 3:  2, 5: 0},
    6:  {1: 4, 3:  5, 5: 0},
    7:  {1: 4, 3:  7, 5: 1},
    8:  {1: 4, 3:  9, 5: 2},
    9:  {1: 4, 3: 10, 5: 4},
    10: {1: 4, 3: 11, 5: 6},
}
"""Cumulative direct-upgrade material requirements for 5-star gems.

Same structure as ``DIRECT_COST_2STAR``.
"""


# ---------------------------------------------------------------------------
# Resonance tables
# ---------------------------------------------------------------------------

RESONANCE_5STAR: dict[str, dict[int, int]] = {
    # rank: {2: res_at_2stars, 3: res_at_3stars, 4: res_at_4stars, 5: res_at_5stars}
    "0":    {2: 0,   3: 0,   4: 0,   5: 0},
    "1":    {2: 30,  3: 60,  4: 90,  5: 100},
    "2":    {2: 110, 3: 140, 4: 180, 5: 200},
    "3":    {2: 190, 3: 230, 4: 270, 5: 300},
    "4":    {2: 280, 3: 320, 4: 360, 5: 400},
    "4.1":  {2: 298, 3: 338, 4: 378, 5: 420},
    "4.2":  {2: 316, 3: 356, 4: 396, 5: 440},
    "4.3":  {2: 334, 3: 374, 4: 414, 5: 460},
    "4.4":  {2: 352, 3: 392, 4: 432, 5: 480},
    "5":    {2: 370, 3: 410, 4: 450, 5: 500},
    "5.1":  {2: 384, 3: 424, 4: 464, 5: 516},
    "5.2":  {2: 398, 3: 438, 4: 478, 5: 532},
    "5.3":  {2: 413, 3: 453, 4: 493, 5: 548},
    "5.4":  {2: 427, 3: 467, 4: 507, 5: 564},
    "5.5":  {2: 441, 3: 481, 4: 521, 5: 580},
    "6":    {2: 460, 3: 500, 4: 540, 5: 600},
    "6.1":  {2: 467, 3: 507, 4: 547, 5: 608},
    "6.2":  {2: 474, 3: 514, 4: 554, 5: 616},
    "6.3":  {2: 481, 3: 521, 4: 561, 5: 624},
    "6.4":  {2: 488, 3: 528, 4: 568, 5: 632},
    "6.5":  {2: 496, 3: 536, 4: 576, 5: 640},
    "6.6":  {2: 503, 3: 543, 4: 583, 5: 648},
    "6.7":  {2: 510, 3: 550, 4: 590, 5: 656},
    "6.8":  {2: 517, 3: 557, 4: 597, 5: 664},
    "6.9":  {2: 524, 3: 564, 4: 604, 5: 672},
    "6.10": {2: 532, 3: 572, 4: 612, 5: 680},
    "6.11": {2: 539, 3: 579, 4: 619, 5: 688},
    "7":    {2: 550, 3: 590, 4: 630, 5: 700},
    "7.1":  {2: 557, 3: 597, 4: 637, 5: 708},
    "7.2":  {2: 564, 3: 604, 4: 644, 5: 716},
    "7.3":  {2: 571, 3: 611, 4: 651, 5: 724},
    "7.4":  {2: 578, 3: 618, 4: 658, 5: 732},
    "7.5":  {2: 586, 3: 626, 4: 666, 5: 740},
    "7.6":  {2: 593, 3: 633, 4: 673, 5: 748},
    "7.7":  {2: 600, 3: 640, 4: 680, 5: 756},
    "7.8":  {2: 607, 3: 647, 4: 687, 5: 764},
    "7.9":  {2: 614, 3: 654, 4: 694, 5: 772},
    "7.10": {2: 622, 3: 662, 4: 702, 5: 780},
    "7.11": {2: 629, 3: 669, 4: 709, 5: 788},
    "8":    {2: 640, 3: 680, 4: 720, 5: 800},
    "8.1":  {2: 645, 3: 685, 4: 725, 5: 806},
    "8.2":  {2: 650, 3: 690, 4: 730, 5: 811},
    "8.3":  {2: 655, 3: 695, 4: 735, 5: 817},
    "8.4":  {2: 660, 3: 700, 4: 740, 5: 822},
    "8.5":  {2: 665, 3: 705, 4: 745, 5: 828},
    "8.6":  {2: 670, 3: 710, 4: 750, 5: 833},
    "8.7":  {2: 675, 3: 715, 4: 755, 5: 839},
    "8.8":  {2: 680, 3: 720, 4: 760, 5: 844},
    "8.9":  {2: 685, 3: 725, 4: 765, 5: 850},
    "8.10": {2: 690, 3: 730, 4: 770, 5: 856},
    "8.11": {2: 695, 3: 735, 4: 775, 5: 861},
    "8.12": {2: 700, 3: 740, 4: 780, 5: 867},
    "8.13": {2: 705, 3: 745, 4: 785, 5: 872},
    "8.14": {2: 710, 3: 750, 4: 790, 5: 878},
    "8.15": {2: 715, 3: 755, 4: 795, 5: 883},
    "8.16": {2: 720, 3: 760, 4: 800, 5: 889},
    "8.17": {2: 725, 3: 765, 4: 805, 5: 894},
    "9":    {2: 730, 3: 770, 4: 810, 5: 900},
    "9.1":  {2: 735, 3: 775, 4: 815, 5: 906},
    "9.2":  {2: 740, 3: 780, 4: 820, 5: 911},
    "9.3":  {2: 745, 3: 785, 4: 825, 5: 917},
    "9.4":  {2: 750, 3: 790, 4: 830, 5: 922},
    "9.5":  {2: 755, 3: 795, 4: 835, 5: 928},
    "9.6":  {2: 760, 3: 800, 4: 840, 5: 933},
    "9.7":  {2: 765, 3: 805, 4: 845, 5: 939},
    "9.8":  {2: 770, 3: 810, 4: 850, 5: 944},
    "9.9":  {2: 775, 3: 815, 4: 855, 5: 950},
    "9.10": {2: 780, 3: 820, 4: 860, 5: 956},
    "9.11": {2: 785, 3: 825, 4: 865, 5: 961},
    "9.12": {2: 790, 3: 830, 4: 870, 5: 967},
    "9.13": {2: 795, 3: 835, 4: 875, 5: 972},
    "9.14": {2: 800, 3: 840, 4: 880, 5: 978},
    "9.15": {2: 805, 3: 845, 4: 885, 5: 983},
    "9.16": {2: 810, 3: 850, 4: 890, 5: 989},
    "9.17": {2: 815, 3: 855, 4: 895, 5: 994},
    "10":   {2: 820, 3: 860, 4: 900, 5: 1000},
}
"""Base resonance for 5-star gems by rank and active star count.

Keys are rank strings matching ``COST_5STAR``.  Inner keys are active star
counts (``2``, ``3``, ``4``, ``5``) representing how many of the gem's
5 stars have been activated (minimum 2).
"""

RESONANCE_1STAR: dict[str, int] = {
    "0":  0,
    "1":  15,
    "2":  30,
    "3":  45,
    "4":  60,
    "5":  75,
    "6":  90,
    "7":  105,
    "8":  120,
    "9":  135,
    "10": 150,
}
"""Base resonance for 1-star gems by rank.

Stored for future use. Keys are whole-rank strings only (no sub-ranks).
"""

RESONANCE_2STAR: dict[str, int] = {
    "0":    0,
    "1":    30,
    "2":    60,
    "3":    90,
    "4":    120,
    "4.1":  135,
    "5":    150,
    "5.1":  156,
    "5.2":  162,
    "5.3":  168,
    "5.4":  174,
    "6":    180,
    "6.1":  186,
    "6.2":  192,
    "6.3":  198,
    "6.4":  204,
    "7":    210,
    "7.1":  215,
    "7.2":  220,
    "7.3":  225,
    "7.4":  230,
    "7.5":  235,
    "8":    240,
    "8.1":  243,
    "8.2":  247,
    "8.3":  250,
    "8.4":  253,
    "8.5":  257,
    "8.6":  260,
    "8.7":  263,
    "8.8":  267,
    "9":    270,
    "9.1":  273,
    "9.2":  275,
    "9.3":  275,
    "9.4":  280,
    "9.5":  278,
    "9.6":  285,
    "9.7":  288,
    "9.8":  290,
    "9.9":  293,
    "9.10": 295,
    "9.11": 298,
    "10":   300,
}
"""Base resonance for 2-star gems by rank.

Stored for future use. Currently, main gems (which contribute base resonance)
are always 5-star, so only ``RESONANCE_5STAR`` is used in calculations.
Keys are rank strings matching ``COST_2STAR``.
"""


def get_direct_incremental_materials(
    star_rating: int,
    from_rank: int,
    to_rank: int,
) -> dict[int, int]:
    """Return the incremental material cost for one direct rank transition.

    Computes the difference between the cumulative rows for ``to_rank`` and
    ``from_rank`` in the appropriate direct cost table.  Only non-zero entries
    are included in the returned dict.

    Args:
        star_rating: Star tier of the gem (``2`` or ``5``).
        from_rank: Source whole rank (integer, e.g. ``7``).
        to_rank: Target whole rank (integer, must equal ``from_rank + 1``).

    Returns:
        Dict mapping material tier (``1``, ``3``, or ``5``) to the number of
        same-name gems at that tier required for this upgrade step.  Zero-count
        tiers are omitted.

    Raises:
        KeyError: If ``from_rank`` or ``to_rank`` is not in the table.
        ValueError: If ``star_rating`` is not ``2`` or ``5``.
    """
    if star_rating == 2:
        table = DIRECT_COST_2STAR
    elif star_rating == 5:
        table = DIRECT_COST_5STAR
    else:
        raise ValueError(
            f"Unknown star_rating: {star_rating}. Must be 2 or 5.")

    from_mats = table[from_rank]
    to_mats = table[to_rank]
    return {
        r: to_mats[r] - from_mats[r]
        for r in (1, 3, 5)
        if to_mats[r] - from_mats[r] > 0
    }
