"""
Tests for the data pipeline and the data.json the website loads.

Run from the repository root:
    python -m unittest discover tests

Only the Python standard library is needed.
"""

import json
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import boundaries  # noqa: E402
import prepare_data  # noqa: E402
import update_data  # noqa: E402

# A few rows in VPD's CSV format, one for each case prepare_data.py handles.
# X/Y for City Hall and Stanley Park come from pyproj (EPSG:4326 -> EPSG:26910).
SAMPLE_CSV = """TYPE,YEAR,MONTH,DAY,HOUR,MINUTE,HUNDRED_BLOCK,NEIGHBOURHOOD,X,Y
Theft of Bicycle,2025,3,14,18,0,12XX W 12TH AVE,Fairview,491712.7,5456487.93
Homicide,2026,6,2,,0,OFFSET TO PROTECT PRIVACY,West End,489698.45,5461004.88
Mischief,2026,6,1,25,0,OFFSET TO PROTECT PRIVACY,Fairview,0,0
Offence Against a Person,2026,5,9,,,OFFSET TO PROTECT PRIVACY,Strathcona,0,0
Mischief,2026,6,1,3,0,1XX MAIN ST,Somewhere,400000,5456487.93
Mischief,2026,2,30,3,0,1XX MAIN ST,Fairview,491712.7,5456487.93
,,,,,,,,,
"""


class TestHelpers(unittest.TestCase):
    def test_utm_matches_pyproj(self):
        # (easting, northing) -> (lat, lng), reference values from pyproj
        known = {
            (491712.7, 5456487.93): (49.2611, -123.1139),    # City Hall
            (489698.45, 5461004.88): (49.3017, -123.1417),   # Stanley Park
            (497685.19, 5453958.61): (49.2384, -123.0318),   # Joyce station
        }
        for (e, n), (lat, lng) in known.items():
            got = prepare_data.utm10n_to_latlng(e, n)
            self.assertAlmostEqual(got[0], lat, places=5)   # 1e-5 degree is about 1 m
            self.assertAlmostEqual(got[1], lng, places=5)

    def test_to_float_and_to_int(self):
        self.assertEqual(prepare_data.to_float("3.5"), 3.5)
        self.assertEqual(prepare_data.to_int("7.0"), 7)
        for bad in ("", None, "abc"):
            self.assertIsNone(prepare_data.to_float(bad))
            self.assertIsNone(prepare_data.to_int(bad))

    def test_row_date(self):
        self.assertEqual(prepare_data.row_date({"YEAR": "2025", "MONTH": "3", "DAY": "14"}), date(2025, 3, 14))
        self.assertIsNone(prepare_data.row_date({"YEAR": "2025", "MONTH": "2", "DAY": "30"}))
        self.assertIsNone(prepare_data.row_date({"YEAR": "2025", "MONTH": "", "DAY": "1"}))

    def test_plain_refuses_markup(self):
        self.assertEqual(prepare_data.plain("Kitsilano"), "Kitsilano")
        with self.assertRaises(SystemExit):
            prepare_data.plain("<script>")

    def test_big_drop(self):
        def data(n):
            return {"points": {"type": [0] * n}}

        edge = round(100 * (1 - update_data.MAX_DROP))
        self.assertFalse(update_data.big_drop(data(100), data(edge)))
        self.assertTrue(update_data.big_drop(data(100), data(edge - 1)))

    def test_without_timestamp(self):
        a = {"generated": "2026-01-01T00:00:00", "latestDate": "2025-12-31"}
        b = {"generated": "2026-02-01T00:00:00", "latestDate": "2025-12-31"}
        self.assertEqual(update_data.without_timestamp(a), update_data.without_timestamp(b))


class TestPrepareData(unittest.TestCase):
    """Runs prepare_data.py on SAMPLE_CSV, the same way update_data.py does."""

    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path, out = Path(tmp) / "sample.csv", Path(tmp) / "data.json"
            csv_path.write_text(SAMPLE_CSV, encoding="utf-8")
            subprocess.run(
                [sys.executable, str(update_data.PREPARE), str(csv_path), "--out", str(out)],
                check=True, capture_output=True,
            )
            cls.data = json.loads(out.read_text(encoding="utf-8"))

    def test_keeps_only_valid_rows(self):
        p = self.data["points"]
        self.assertEqual(len(p["type"]), 2)   # no location, outside Vancouver, bad date and blank rows dropped
        self.assertEqual(self.data["noLocationByYear"], {"2025": 0, "2026": 2})

    def test_counts_violent_crime_by_neighbourhood(self):
        # Only offences against a person: the Mischief row with no location isn't one
        self.assertEqual(self.data["violentByHood"], {"Strathcona": {"2026": 1}})

    def test_points_decode_back_to_place(self):
        p = self.data["points"]
        places = sorted(((p["lat0"] + lat) / 1e4, (p["lng0"] + lng) / 1e4) for lat, lng in zip(p["lat"], p["lng"]))
        self.assertEqual(places, [(49.2611, -123.1139), (49.3017, -123.1417)])

    def test_dates_types_and_hours(self):
        d, p = self.data, self.data["points"]
        self.assertEqual(d["years"], [2025, 2026])
        self.assertEqual(d["latestDate"], "2026-06-02")
        self.assertEqual(d["partialYear"], 2026)
        rows = sorted(zip(p["year"], p["md"], p["hour"], (d["types"][t]["label"] for t in p["type"])))
        self.assertEqual(rows, [(2025, 314, 18, "Bike theft"), (2026, 602, -1, "Homicide")])
        self.assertTrue(next(t for t in d["types"] if t["vpd"] == "Homicide")["blurred"])

    def test_output_passes_the_shape_check(self):
        self.assertIsNone(update_data.shape_problem(self.data))


class TestBoundaries(unittest.TestCase):
    def test_city_names_become_vpd_names(self):
        ring = [[-123.1, 49.28], [-123.11, 49.28], [-123.11, 49.29], [-123.1, 49.28]]
        city = {"features": [
            {"properties": {"name": "Downtown"}, "geometry": {"type": "Polygon", "coordinates": [ring]}},
            {"properties": {"name": "Kitsilano"}, "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]}},
        ]}
        out = boundaries.convert(city)
        self.assertEqual([f["properties"]["name"] for f in out["features"]], ["Central Business District", "Kitsilano"])
        self.assertEqual(out["features"][1]["geometry"]["coordinates"], [[ring]])

    def test_published_boundaries_match_vpd_names(self):
        names = {f["properties"]["name"] for f in json.loads(boundaries.OUT.read_text(encoding="utf-8"))["features"]}
        vpd = {h["name"] for h in json.loads(update_data.OUT.read_text(encoding="utf-8"))["neighbourhoods"]}
        # Every City area is a VPD neighbourhood; VPD's only extras are the two the app handles itself (see hoodAt)
        self.assertEqual(vpd - names, {"Musqueam", "Stanley Park"})
        self.assertLessEqual(names, vpd)


class TestPage(unittest.TestCase):
    """Catches an older app.js landing on main: a button the page shows but nothing in app.js wires up."""

    def test_every_button_is_used_by_app_js(self):
        page = (REPO_ROOT / "web" / "index.html").read_text(encoding="utf-8")
        app = (REPO_ROOT / "web" / "app.js").read_text(encoding="utf-8")
        ids = re.findall(r'<button[^>]*\bid="([^"]+)"', page)
        self.assertTrue(ids)
        for button in ids:
            with self.subTest(button):
                self.assertIn(f'"{button}"', app)


class TestShapeCheck(unittest.TestCase):
    """update_data.py refuses a data.json that web/app.js couldn't read."""

    @classmethod
    def setUpClass(cls):
        cls.text = update_data.OUT.read_text(encoding="utf-8")

    def test_published_data_passes(self):
        self.assertIsNone(update_data.shape_problem(json.loads(self.text)))

    def test_broken_data_is_refused(self):
        breaks = {
            "version": lambda d: d.update(version=2),
            "empty": lambda d: d["points"].update({col: [] for col in d["points"] if col not in ("lat0", "lng0")}),
            "short column": lambda d: d["points"]["lat"].pop(),
            "unknown type": lambda d: d["points"]["type"].__setitem__(0, len(d["types"])),
            "bad hour": lambda d: d["points"]["hour"].__setitem__(0, 24),
            "unlisted year": lambda d: d["years"].pop(),
        }
        for name, break_it in breaks.items():
            with self.subTest(name):
                data = json.loads(self.text)
                break_it(data)
                self.assertIsNotNone(update_data.shape_problem(data))
