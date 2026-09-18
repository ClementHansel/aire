"""PT Jasa Instrumentasi Teknologi — LK-421-IDN (Amd-1, 30 Juli 2025).

Compact scope aimed at laboratory and process work: temperature enclosures,
mass to 400 kg, a full volumetric glassware set, pressure in PSI (hydraulic to
10.000 psi), a little dimensional, pH and stopwatch.

Amd-1 was an address change and replaces the original appendix.
"""
from lab_seed_lib import emit

TENANT = "1c0ca9f2-06f6-42d3-89e2-6ab6ff41f997"

LAB = dict(
    name="PT Jasa Instrumentasi Teknologi",
    lk="LK-421-IDN",
    until="2028-11-21",
    address="Latinos Business District, Jl. Raya Rawa Buntu No.3 Blok C11, Serpong, "
            "Tangerang Selatan, Banten",
    phone="021 74792243",
    email="info@jasainstrumentasiteknologi.com",
    source="LK 421 IDN (L) AMD1_2025.pdf",
    notes="Amendemen ke-1 penetapan 30 Juli 2025 (perubahan alamat, menggantikan lampiran asli). "
          "Tekanan dinyatakan dalam PSI; hidraulik sampai 10.000 psi.",
)

KAN208 = "KAN Pd-02.08:2019"

DATA = [
 ("Suhu dan Kelembapan", [
  ("Inkubator", "C", "temperature", "KAN Pd-02.04:2019", [("35~50", "0.89 C"), ("50~100", "1.2 C")]),
  ("Freezer / Chiller", "C", "temperature", "KAN Pd-02.04:2019", [("-20~-10", "1.1 C")]),
  ("Cool Storage / Refrigerator", "C", "temperature", "KAN Pd-02.04:2019", [("2~15", "1.4 C")]),
  ("Oven", "C", "temperature", "KAN Pd-02.04:2019", [("80~300", "1.4 C")]),
  ("Oilbath", "C", "temperature", "IK-JIT-S.05", [("150~200", "0.92 C")]),
  ("Waterbath", "C", "temperature", "IK-JIT-S.04", [("50~100", "0.84 C")]),
  ("COD Reactor", "C", "temperature", "IK-JIT-S.13", [("50~200", "1.1 C")]),
  ("Temperatur dalam Mesin (flashpoint)", "C", "temperature", "IK-JIT-S.12", [("161~192", "0.63 C")]),
  ("Termometer Digital", "C", "temperature", "SNSU PK.S-02:2021", [("0~500", "0.13 C")]),
  ("Temperature Gauge", "C", "temperature", "SNSU PK.S-02:2021", [("0~500", "1.2 C")]),
  ("Temperature Recorder", "C", "temperature", "SNSU PK.S-02:2021", [("35~200", "0.87 C")]),
 ]),
 ("Massa", [
  ("Timbangan (Analitik, Elektronik, Mekanik)", "g", "mass", "CSIRO 2010",
   [("0~200", "0.22 mg"), ("200~500", "0.010 g"), ("500~1000", "0.011 g")]),
  ("Timbangan (Analitik, Elektronik, Mekanik)", "kg", "mass", "CSIRO 2010",
   [("1~3", "0.011 g"), ("3~10", "5.2 g"), ("10~40", "5.3 g"), ("40~50", "0.010 kg"),
    ("50~200", "0.011 kg"), ("200~400", "0.20 kg")]),
  ("Anak Timbangan", "g", "mass", "OIML R111-1:2004 (direct comparison)",
   [("1", "0.085 mg"), ("2", "0.11 mg"), ("5", "0.23 mg"), ("10", "0.46 mg"), ("20", "0.64 mg"),
    ("50", "0.77 mg"), ("100", "1.3 mg"), ("200", "2.5 mg"), ("2000", "0.026 g")]),
 ]),
 ("Volume", [
  ("Pipet Volume", "mL", "volume", "IK-JIT-V.01; " + KAN208,
   [("2", "0.0030 mL"), ("5", "0.0040 mL"), ("10", "0.0050 mL"), ("25", "0.010 mL"),
    ("50", "0.018 mL"), ("100", "0.036 mL")]),
  ("Pipet Ukur", "mL", "volume", "IK-JIT-V.02; " + KAN208,
   [("2", "0.0030 mL"), ("5", "0.0070 mL"), ("10", "0.015 mL"), ("20", "0.016 mL")]),
  ("Buret", "mL", "volume", "IK-JIT-V.03; " + KAN208,
   [("5", "0.0060 mL"), ("10", "0.0080 mL"), ("25", "0.010 mL"), ("50", "0.018 mL"),
    ("100", "0.12 mL")]),
  ("Labu Takar", "mL", "volume", "IK-JIT-V.04; " + KAN208,
   [("5", "0.0070 mL"), ("10", "0.0080 mL"), ("25", "0.014 mL"), ("50", "0.067 mL"),
    ("100", "0.085 mL"), ("250", "0.091 mL"), ("500", "0.21 mL"), ("1000", "0.39 mL"),
    ("2000", "0.75 mL")]),
  ("Gelas Ukur", "mL", "volume", "IK-JIT-V.05; " + KAN208,
   [("10", "0.013 mL"), ("25", "0.034 mL"), ("50", "0.036 mL"), ("100", "0.11 mL"),
    ("250", "0.20 mL"), ("500", "0.39 mL"), ("1000", "0.78 mL"), ("2000", "1.6 mL")]),
  ("Dispensette", "mL", "volume", "IK-JIT-V.07",
   [("5", "0.012 mL"), ("10", "0.024 mL"), ("50", "0.12 mL"), ("100", "0.24 mL"), ("200", "0.48 mL")]),
  ("Piston Buret (Automatic Titrator)", "mL", "volume", "IK-JIT-V.08",
   [("10", "0.0090 mL"), ("20", "0.018 mL"), ("50", "0.034 mL")]),
  ("POVA (Micropipet)", "uL", "volume", "SNSU PK.M-01:2020",
   [("100~200", "0.82 uL"), ("200~500", "1.1 uL"), ("500~1000", "1.9 uL")]),
  ("POVA (Micropipet)", "mL", "volume", "SNSU PK.M-01:2020",
   [("1~2.5", "7.2 uL"), ("2.5~5", "10 uL"), ("5~10", "18 uL")]),
 ]),
 ("Tekanan", [
  ("Pneumatic Pressure Gauge (media udara)", "psi", "pressure", "DKD-R 6-1 (2014)",
   [("0~20", "0.29 psi"), ("20~35", "0.29 psi"), ("35~60", "0.57 psi"), ("60~100", "1.1 psi"),
    ("100~150", "1.1 psi"), ("150~300", "2.3 psi"), ("300~500", "2.4 psi")]),
  ("Hydraulic Pressure Gauge (media oil)", "psi", "pressure", "DKD-R 6-1 (2014)",
   [("0~1000", "5.7 psi"), ("1000~1500", "11 psi"), ("1500~2000", "11 psi"),
    ("2000~3000", "28 psi"), ("3000~5000", "31 psi"), ("5000~10000", "57 psi")]),
 ]),
 ("Panjang", [
  ("Outside Micrometer", "mm", "length", "JIS B 7502:2016; SNSU PK.P-01:2020",
   [("0~25", "0.85 um"), ("25~50", "0.94 um"), ("50~75", "0.98 um"), ("75~100", "5.7 um")]),
  ("Ultrasonic Thickness Gauge", "mm", "length", "ASTM E 317-06", [("0~100", "11 um")]),
  ("Digital / Dial / Thickness Gauge", "mm", "length", "ASME B89.1.10",
   [("0~10", "1.4 um"), ("10~25", "7.2 um"), ("25~100", "57 um")]),
  ("Caliper", "mm", "length", "JIS B 7507:2016; SNSU PK.P-02.2:2020", [("0~150", "14 um")]),
 ]),
 ("Instrumen Analitik", [
  ("pH Meter", "pH", "ph", "ASTM E70-97 R02:2002",
   [("4", "0.023 pH"), ("7", "0.027 pH"), ("10", "0.033 pH")]),
 ]),
 ("Waktu dan Frekuensi", [
  ("Stopwatch", "s", "time", "SNSU PK.W-01:2020", [("10~3600", "0.32 s")]),
 ]),
]

if __name__ == "__main__":
    print(emit(TENANT, LAB, DATA))
