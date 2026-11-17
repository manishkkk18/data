# CPCB station reports (Delhi PM2.5, 2022–2024)

OpenAQ has no Delhi readings from mid-October 2022 through 2024. These files fill that gap
with CPCB's own daily station averages. They are downloaded by hand because the CPCB portal
needs a captcha.

## Download

1. Open https://airquality.cpcb.gov.in/ccr/ and solve the captcha.
2. Go to **Advanced Search** (or the data repository page) and choose:
   - State **Delhi**, City **Delhi**, then one **Station** from the list below
   - Parameter **PM2.5** only
   - Criteria / averaging **24 Hours**
   - Report format **Tabular**
   - From **15-09-2022** to **15-12-2024**. If the portal refuses such a long range,
     do one report per season instead: 15 Sep – 15 Dec of 2022, 2023 and 2024.
3. Download the report as **Excel** and save it in this folder. Keep the file name the
   portal gives, or name it after the station. Several files per station are fine.

Stations, spread across the city (all long-running reference monitors):

| North | Central | South | East | West |
|---|---|---|---|---|
| Narela – DPCC | ITO – CPCB | R K Puram – DPCC | Anand Vihar – DPCC | Punjabi Bagh – DPCC |
| Jahangirpuri – DPCC | Mandir Marg – DPCC | Sirifort – CPCB | Nehru Nagar – DPCC | Dwarka-Sector 8 – DPCC |
| Rohini – DPCC | Lodhi Road – IMD | Okhla Phase-2 – DPCC |  | Najafgarh – DPCC |

## Process (no keys needed)

```bash
cd pipeline
PYTHONPATH=. python -m smokewatch.cpcb                  # -> data/cpcb/delhi_pm25_daily.json
PYTHONPATH=. python -m smokewatch.season --apply-cpcb   # fills only the days OpenAQ is missing
```

A Delhi day needs at least 3 stations and at least half the usual number; otherwise it stays a gap.
