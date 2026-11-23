"""1. Download the raw MoSPI series into scripts/.cache/ (re-runs fetch only what changed).

  IIP monthly and annual, both base years (2011-12 and 2022-23)
  ASI 2-digit NIC x state x year for the indicators the page uses (NIC 2008, combined sector)
  WPI (base 2011-12) by financial year, from the Office of the Economic Adviser (DPIIT), which
  compiles WPI: its "Manufactured products" index deflates ASI's rupee values. (The same numbers
  are on eSankhyiki, but only as ~150,000 item rows; OEA's one workbook is the light route.)
"""
from common import fetch_all, download, CACHE
import json

ASI_INDICATORS = {
    1: "factories",           # Number of Factories
    3: "fixed_capital",       # Fixed Capital (Rs lakh)
    15: "output",             # Total Output (Rs lakh)
    19: "gva",                # Gross Value Added (Rs lakh)
    31: "persons",            # Total Number of Persons Engaged
    32: "workers",            # Total Number of Workers
    43: "wages",              # Wages and Salaries incl. employer's contribution (Rs lakh)
    23: "gfcf",               # Gross Fixed Capital Formation (Rs lakh): the investment screen
}


def main() -> None:
    raw = {}
    raw["iip_monthly"] = fetch_all("iip/getIIPMonthly", {}, "iip_monthly")
    raw["iip_annual"] = fetch_all("iip/getIIPAnnual", {}, "iip_annual")
    for code, key in ASI_INDICATORS.items():
        raw[f"asi_{key}"] = fetch_all(
            "asi/getASIData",
            {"classification_year": 2008, "indicator_code": code, "nic_type": "2-digit", "sector": "Combined"},
            f"asi_{key}",
        )
    download("https://eaindustry.nic.in/indx_download_1112/fin_year_index.xls", CACHE / "wpi_fin_year_index.xls")
    for k, rows in raw.items():
        (CACHE / f"{k}.json").write_text(json.dumps(rows), "utf-8")
    print("raw series saved in scripts/.cache/*.json")


if __name__ == "__main__":
    main()
