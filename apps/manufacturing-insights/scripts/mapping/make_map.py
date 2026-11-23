"""Write industry_map.csv: how each source's categories line up with the page's industry groups.

The CSV is the reviewed, committed artefact; this script only exists so every HS 4-digit code in
chapters 84-85 gets an explicit row (mapped, general capital goods, or not capital goods) and
nothing is silently dropped. Edit the rules here, rerun, review the diff of the CSV.

Confidence: exact = the source category is (nearly) the same activity as the group;
approximate = mostly the same, with known spill-over; loose = only a rough proxy, shown but
flagged. Rows with group "-" are deliberately not used (not manufacturing, or no clean match).

Source category names for RBI and DPIIT follow their published tables; read_raw.py stops on
any name in the downloaded files that is not listed here.
"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / ".cache" / "trade"

# The page's industry groups (combined where sources are coarser than NIC 2-digit).
GROUPS = {
    "FOOD": ("Food, beverages & tobacco", "10 11 12"),
    "TEXT": ("Textiles & apparel", "13 14"),
    "LEATH": ("Leather", "15"),
    "WOOD": ("Wood", "16"),
    "PAPER": ("Paper & printing", "17 18"),
    "PETRO": ("Coke & refined petroleum", "19"),
    "CHEM": ("Chemicals (excl. pharma)", "20"),
    "PHARMA": ("Pharmaceuticals", "21"),
    "RUBBER": ("Rubber & plastics", "22"),
    "NONMET": ("Non-metallic minerals (cement, glass, ceramics)", "23"),
    "METAL": ("Basic & fabricated metals", "24 25"),
    "ELEC": ("Computers & electronics", "26"),
    "ENG": ("Electrical equipment & machinery", "27 28"),
    "TRANS": ("Motor vehicles & other transport", "29 30"),
    "OTHER": ("Furniture & other manufacturing", "31 32"),
}

RBI = [  # RBI "Sectoral Deployment of Bank Credit", Statement 2 (industry-wise); matched by RBI's code
    ("2.1 Mining and Quarrying (incl. Coal)", "-", "", "Not manufacturing"),
    ("2.2 Food Processing", "FOOD", "approximate", "NIC 10; beverages and tobacco are RBI's 2.3, added to the group"),
    ("2.3 Beverage and Tobacco", "FOOD", "exact", "NIC 11-12"),
    ("2.4 Textiles", "TEXT", "approximate", "Cotton, jute, man-made and other textiles; garments partly inside 'Other Textiles'"),
    ("2.5 Leather and Leather Products", "LEATH", "exact", ""),
    ("2.6 Wood and Wood Products", "WOOD", "exact", ""),
    ("2.7 Paper and Paper Products", "PAPER", "approximate", "Printing (NIC 18) has no RBI line of its own"),
    ("2.8 Petroleum, Coal Products and Nuclear Fuels", "PETRO", "exact", ""),
    ("2.9 Chemicals and Chemical Products", "CHEM", "approximate", "Used as RBI's 2.9 minus 2.9.2 Drugs and Pharmaceuticals (fertilisers, petrochemicals, others)"),
    ("2.9.2 Drugs and Pharmaceuticals", "PHARMA", "exact", "Sub-line of 2.9 Chemicals"),
    ("2.10 Rubber, Plastic and their Products", "RUBBER", "exact", ""),
    ("2.11 Glass and Glassware", "NONMET", "approximate", "Glass and cement lines added; bricks and ceramics sit in 'Other Industries'"),
    ("2.12 Cement and Cement Products", "NONMET", "approximate", "See 2.11"),
    ("2.13 Basic Metal and Metal Product", "METAL", "exact", "Iron and steel plus other metals and metal products (NIC 24-25)"),
    ("2.14 All Engineering", "-", "", "Used through its two sub-lines below"),
    ("2.14.1 Electronics", "ELEC", "approximate", "Sub-line of 2.14; RBI's electronics boundary is not published in NIC terms"),
    ("2.14.2 Others", "ENG", "approximate", "All Engineering minus Electronics: electrical equipment, machinery, some fabricated metal"),
    ("2.15 Vehicles, Vehicle Parts and Transport Equipment", "TRANS", "exact", ""),
    ("2.16 Gems and Jewellery", "OTHER", "approximate", "Part of NIC 32 only"),
    ("2.17 Construction", "-", "", "Not manufacturing"),
    ("2.18 Infrastructure", "-", "", "Power, telecom, roads, ports etc.: not manufacturing"),
    ("2.19 Other Industries", "-", "", "Unspecified mix: not used"),
    ("Industries (2.1 to 2.19)", "REFERENCE", "", "All-industry total, the comparison for signal (a); it includes infrastructure and construction"),
]

DPIIT = [  # DPIIT "Sector-wise/year-wise FDI equity inflow" (Table 4); matched ignoring spaces and punctuation
    ("Food Processing Industries", "FOOD", "exact", ""),
    ("Sugar", "FOOD", "exact", ""),
    ("Vegetable Oils And Vanaspati", "FOOD", "exact", ""),
    ("Fermentation Industries", "FOOD", "approximate", "Mostly alcoholic beverages (NIC 11)"),
    ("Tea And Coffee (Processing & Warehousing Coffee & Rubber)", "FOOD", "loose", "Includes plantation-side activity"),
    ("Textiles (Including Dyed, Printed)", "TEXT", "exact", ""),
    ("Coir", "TEXT", "approximate", "Coir products, NIC 13"),
    ("Leather, Leather Goods And Pickers", "LEATH", "exact", ""),
    ("Timber Products", "WOOD", "exact", ""),
    ("Paper And Pulp (Including Paper Products)", "PAPER", "exact", ""),
    ("Printing Of Books (Including Litho Printing Industry)", "PAPER", "exact", ""),
    ("Petroleum & Natural Gas", "PETRO", "loose", "Includes exploration and marketing, not only refining"),
    ("Chemicals (Other Than Fertilizers)", "CHEM", "exact", ""),
    ("Fertilizers", "CHEM", "exact", ""),
    ("Dye-Stuffs", "CHEM", "exact", ""),
    ("Soaps, Cosmetics & Toilet Preparations", "CHEM", "exact", ""),
    ("Glue And Gelatin", "CHEM", "exact", ""),
    ("Photographic Raw Film And Paper", "CHEM", "approximate", "NIC 20"),
    ("Drugs & Pharmaceuticals", "PHARMA", "approximate", "May include medical devices (NIC 32)"),
    ("Rubber Goods", "RUBBER", "exact", "Plastics have no DPIIT sector of their own"),
    ("Cement And Gypsum Products", "NONMET", "exact", ""),
    ("Glass", "NONMET", "exact", ""),
    ("Ceramics", "NONMET", "exact", ""),
    ("Metallurgical Industries", "METAL", "approximate", "Ferrous and non-ferrous metals; may include some mining"),
    ("Electronics", "ELEC", "exact", ""),
    ("Scientific Instruments", "ELEC", "approximate", "NIC 265"),
    ("Mathematical, Surveying And Drawing Instruments", "ELEC", "approximate", "NIC 265"),
    ("Electrical Equipments", "ENG", "approximate", "NIC 27; older data folded some software into this sector"),
    ("Industrial Machinery", "ENG", "exact", "NIC 28"),
    ("Machine Tools", "ENG", "exact", "NIC 28"),
    ("Agricultural Machinery", "ENG", "exact", "NIC 28"),
    ("Earth-Moving Machinery", "ENG", "exact", "NIC 28"),
    ("Boilers And Steam Generating Plants", "ENG", "exact", "NIC 28"),
    ("Prime Mover (Other Than Electrical Generators)", "ENG", "exact", "NIC 28"),
    ("Industrial Instruments", "ENG", "approximate", "Partly NIC 26"),
    ("Miscellaneous Mechanical & Engineering Industries", "ENG", "approximate", "Mixed engineering goods"),
    ("Automobile Industry", "TRANS", "exact", ""),
    ("Railway Related Components", "TRANS", "approximate", ""),
    ("Medical And Surgical Appliances", "OTHER", "approximate", "NIC 325"),
    ("Diamond, Gold Ornaments", "OTHER", "approximate", "Jewellery, NIC 32"),
    ("Defence Industries", "-", "", "Mixed products: not used"),
    ("Commercial, Office & Household Equipments", "-", "", "Mixed: not used"),
    ("Computer Software & Hardware", "-", "", "Mostly software (a service): not used"),
    ("Miscellaneous Industries", "-", "", "Unspecified: not used"),
    ("Services Sector (Fin., Banking, Insurance, Non Fin/Business, Outsourcing, R&D, Courier, Tech. Testing And Analysis, Other)", "-", "", "Not manufacturing"),
    ("Trading", "-", "", "Not manufacturing"),
    ("Retail Trading", "-", "", "Not manufacturing"),
    ("Telecommunications", "-", "", "Telecom services: not manufacturing"),
    ("Construction (Infrastructure) Activities", "-", "", "Not manufacturing"),
    ("Construction Development: Townships, Housing, Built-Up Infrastructure And Construction-Development Projects", "-", "", "Not manufacturing"),
    ("Non-Conventional Energy", "-", "", "Power generation, not manufacturing"),
    ("Power", "-", "", "Not manufacturing"),
    ("Coal Production", "-", "", "Mining, not manufacturing"),
    ("Mining", "-", "", "Not manufacturing"),
    ("Air Transport (Including Air Freight)", "-", "", "Service"),
    ("Sea Transport", "-", "", "Service"),
    ("Ports", "-", "", "Service"),
    ("Hotel & Tourism", "-", "", "Service"),
    ("Hospital & Diagnostic Centres", "-", "", "Service"),
    ("Information & Broadcasting (Including Print Media)", "-", "", "Service"),
    ("Consultancy Services", "-", "", "Service"),
    ("Education", "-", "", "Service"),
    ("Agriculture Services", "-", "", "Not manufacturing"),
    ("RBI's NRI Schemes", "-", "", "Not allocated to a sector"),
]

PLI = [  # the 14 PLI schemes (rows in raw/pli_schemes.csv)
    ("Large Scale Electronics Manufacturing (LSEM)", "ELEC", "exact", "Mobile phones and specified components, NIC 26"),
    ("IT Hardware 2.0", "ELEC", "exact", "Laptops, servers etc., NIC 26"),
    ("Telecom & Networking Products", "ELEC", "exact", "NIC 26"),
    ("High Efficiency Solar PV Modules", "ELEC", "approximate", "Solar cells and modules are NIC 26 (2610); a separate part of the electronics story"),
    ("Pharmaceutical Drugs", "PHARMA", "exact", ""),
    ("Bulk Drugs (KSMs/DIs/APIs)", "PHARMA", "exact", ""),
    ("Medical Devices", "OTHER", "approximate", "NIC 325, with some electro-medical equipment in NIC 26"),
    ("Automobiles & Auto Components", "TRANS", "exact", "NIC 29"),
    ("Drones & Drone Components", "TRANS", "approximate", "NIC 30 (aircraft)"),
    ("ACC Battery", "ENG", "exact", "Batteries are NIC 27 (2720)"),
    ("White Goods (ACs & LED)", "ENG", "approximate", "ACs are NIC 28, LED lights NIC 27"),
    ("Textiles (MMF & technical)", "TEXT", "approximate", "Man-made fibre fabrics (13) and apparel (14)"),
    ("Food Products", "FOOD", "approximate", "NIC 10, some 11"),
    ("Speciality Steel", "METAL", "exact", "NIC 24"),
]

# HS 4-digit rules for chapters 84-85: industry-specific machinery is mapped; general-purpose
# machinery is "general capital goods" (used in the economy-wide total only); consumer and
# intermediate goods (phones, chips, laptops, engines, appliances) are "not capital goods".
HS_GROUP = {
    "FOOD": ("exact", "8438 8478"), "FOOD~": ("approximate", "8434 8435 8437"),
    "TEXT": ("exact", "8444 8445 8446 8447 8448 8449"), "TEXT~": ("approximate", "8451 8452"),
    "LEATH": ("exact", "8453"),
    "WOOD~": ("approximate", "8465"),
    "PAPER": ("exact", "8439 8440 8441 8442"), "PAPER~": ("loose", "8443"),
    "RUBBER": ("exact", "8477"),
    "NONMET~": ("approximate", "8464 8474 8475"),
    "METAL": ("exact", "8454 8455"),
    "ELEC~": ("approximate", "8486"),
    # Machine tools serve several groups at once: kept as one combined buyer group.
    "METALWORK": ("loose", "8456 8457 8458 8459 8460 8461 8462 8463 8466"),
}
HS_NOTES = {
    "8438": "Industrial food and drink machinery", "8478": "Tobacco machinery",
    "8434": "Dairy machinery", "8435": "Juice/wine presses", "8437": "Grain milling",
    "8451": "Includes laundry machines", "8452": "Industrial and household sewing machines",
    "8465": "Woodworking; also plastics/hard-rubber working", "8443": "Printing presses, but also office printers and copiers",
    "8464": "Stone, ceramics and concrete working", "8474": "Mineral crushing and mixing (cement, also mining)",
    "8475": "Glass and lamp assembly machines", "8454": "Converters, ladles, casting machines", "8455": "Rolling mills",
    "8486": "Semiconductor, display and PCB manufacturing machines; SMT assembly lines sit in 8479 (unmapped)",
}
NOT_CAPITAL = set("8401 8403 8407 8408 8409 8411 8415 8418 8450 8470 8471 8472 8473 8476 8482 8483 8484 8487 "
                  "8506 8507 8508 8509 8510 8511 8512 8513 8516 8517 8518 8519 8521 8522 8523 8524 8525 8527 8528 "
                  "8529 8530 8531 8532 8533 8534 8536 8538 8539 8540 8541 8542 8544 8545 8546 8547 8548 8549".split())
METALWORK_GROUPS = "METAL ENG TRANS"   # who buys machine tools: fabricated metal, machinery, vehicles


def main() -> None:
    rows = []
    for g, (name, nic) in GROUPS.items():
        rows.append(("group", g, g, "", f"{name}; NIC {nic}"))
    for src, cats in (("rbi_credit", RBI), ("dpiit_fdi", DPIIT), ("pli", PLI)):
        for cat, g, conf, note in cats:
            rows.append((src, cat, g, conf, note))
    hs = {x["hs4"]: x["description"] for x in json.loads((CACHE / "hs4_inr_crore_2024-25.json").read_text("utf-8"))
          if x["hs4"][:2] in ("84", "85")}
    rule = {}
    for key, (conf, codes) in HS_GROUP.items():
        for c in codes.split():
            rule[c] = (key.rstrip("~"), conf)
    for code, desc in sorted(hs.items()):
        if code in rule:
            g, conf = rule[code]
            note = HS_NOTES.get(code, "")
            if g == "METALWORK":
                g, note = METALWORK_GROUPS, "Machine tools: bought by metal products, machinery and vehicle makers alike (combined)"
            rows.append(("hs4", code, g, conf, f"{desc.title()}. {note}".strip()))
        elif code in NOT_CAPITAL:
            rows.append(("hs4", code, "-", "", f"{desc.title()}. Not capital goods (consumer, component or engine)"))
        else:
            rows.append(("hs4", code, "GENERAL", "", f"{desc.title()}. General-purpose capital goods (economy-wide total only)"))
    with (HERE / "industry_map.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["source", "source_category", "group", "confidence", "note"])
        w.writerows(rows)
    print(f"wrote industry_map.csv: {len(rows)} rows")


if __name__ == "__main__":
    main()
