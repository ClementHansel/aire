"""PT Calibramed — LK-128-IDN (Amd-1, 22 April 2026).

A dedicated MEDICAL device calibration lab: incubators, infusion/syringe pumps,
ECG, sphygmomanometers, centrifuges, blood-bank refrigerators. Almost every
method is a Kemenkes (SK Dirjen Pelayanan Kesehatan) procedure rather than an
ISO/JIS one — this is the partner for hospital and clinic equipment, not for
industrial instruments.

Amd-1 replaces the original appendix, so this is the whole current scope.
"""
from lab_seed_lib import emit

TENANT = "1c0ca9f2-06f6-42d3-89e2-6ab6ff41f997"

LAB = dict(
    name="PT Calibramed",
    lk="LK-128-IDN",
    until="2027-09-06",
    address="Jl. Dr. Saharjo No 41 E, Manggarai, Tebet, Jakarta Selatan, DKI Jakarta",
    phone="(021) 28542554",
    email=None,
    source="LK 128 IDN (L) Amd1_22April2026.pdf",
    notes="Amendemen ke-1 penetapan 22 April 2026 (menggantikan lampiran asli). "
          "SPESIALIS ALAT KESEHATAN — metode mengacu SK Dirjen Pelayanan Kesehatan (Kemenkes), "
          "bukan lab industri umum.",
)

M24 = "SK Dirjen Pelayanan Kesehatan No. HK.02.02/D/43649/2024"
M20 = "SK Dirjen Pelayanan Kesehatan No. HK.02.02/V/0412/2020"

DATA = [
 ("Suhu dan Kelembapan", [
  ("Infant Incubator", "C", "temperature", M24 + " (KMK-MK-054.0)", [("20~40", "0.9 C")]),
  ("Inkubator Laboratorium", "C", "temperature", M24 + " (KMK-MK-055.0)", [("30~40", "0.98 C")]),
  ("Medical Refrigerator", "C", "temperature", M24 + " (KMK-MK-066.0)", [("2~8", "0.7 C")]),
  ("Thermohygrometer - suhu", "C", "temperature", M20 + " (MK-049-18)", [("20~35", "0.95 C")]),
  ("Thermohygrometer - kelembapan", "%rh", "humidity", M20 + " (MK-049-18)", [("40~70", "2.9 %rh")]),
  ("Bloodbank Refrigerator", "C", "temperature", M24 + " (KMK-MK-015.0)", [("2~8", "0.61 C")]),
  ("Medical Freezer", "C", "temperature", M24 + " (KMK-MK-065.0)", [("-20~-5", "0.62 C")]),
  ("Sterilisator", "C", "temperature", M24 + " (KMK-MK-092.0)", [("100~150", "0.62 C")]),
  ("Oven", "C", "temperature", M24 + " (KMK-MK-076.0)", [("30~150", "0.62 C")]),
 ]),
 ("Massa", [
  ("Timbangan Dewasa", "kg", "mass", M24 + " (KMK-MK-103.0; KMK-MK-104.0)", [("0~120", "0.49 kg")]),
  ("Timbangan Bayi", "kg", "mass", M24 + " (KMK-MK-100.0; KMK-MK-101.0)", [("0~20", "4.9 g")]),
 ]),
 ("Volume", [
  ("Mikropipet", "uL", "volume", M20 + " (MK-033-18)",
   [("0.2~50", "0.70 uL"), ("50~100", "0.70 uL"), ("100~500", "0.70 uL"), ("500~1000", "1.0 uL")]),
 ]),
 ("Tekanan", [
  ("Pressure Meter", "mmHg", "pressure", M20 + " (MK-019-18); MK/PM-01", [("0~350", "0.10 mmHg")]),
  ("Sphygmomanometer", "mmHg", "pressure", M24 + " (KMK-MK-090.0)", [("0~250", "0.85 mmHg")]),
  ("Suction Pump", "mmHg", "pressure", M24 + " (KMK-MK-114.0)", [("-600~0", "5.8 mmHg")]),
  ("Bed Side Monitor - tekanan", "mmHg", "pressure", M24 + " (KMK-MK-012.0)", [("60~150", "0.59 mmHg")]),
  ("Blood Pressure Monitor", "mmHg", "pressure", M24 + " (KMK-MK-012.0)", [("60~150", "0.59 mmHg")]),
 ]),
 ("Aliran", [
  ("Infusion Pump", "mL/h", "volumeflow_mlh", M24 + " (KMK-MK-053.0)", [("0~500", "1.0 mL/h")]),
  ("Syringe Pump", "mL/h", "volumeflow_mlh", M24 + " (KMK-MK-095.0)", [("0~100", "1.0 mL/h")]),
  ("Flowmeter", "L/min", "flow", M24 + " (KMK-MK-044.0)", [("1~15", "0.42 L/min")]),
 ]),
 ("Kelistrikan", [
  ("ECG Simulator", "Hz", "frequency", M20 + " (MK-098-19)",
   [("1~2", "0.12 Hz"), ("2~10", "0.12 Hz"), ("10~40", "0.12 Hz"), ("40~50", "0.12 Hz"),
    ("50~60", "0.12 Hz"), ("60~100", "0.12 Hz")]),
  ("ECG Recorder - heart rate", "bpm", "heartrate", M24 + " (KMK-MK-031.0)", [("30~240", "0.60 bpm")]),
  ("ECG Recorder - amplitudo", "mm", "length", M24 + " (KMK-MK-031.0)",
   [("5~20", "0.65 mm"), ("25~50", "0.65 mm")]),
  ("Elektrostimulator - frekuensi", "Hz", "frequency", M24 + " (KMK-MK-038.0)", [("80~200", "1.30 Hz")]),
  ("Elektrostimulator - intensitas", "mA", "current", M24 + " (KMK-MK-038.0)", [("10~50", "0.13 mA")]),
  ("Elektrostimulator - pulse duration", "us", "time", M24 + " (KMK-MK-038.0)", [("100~200", "1.3 us")]),
 ]),
 ("Waktu dan Frekuensi", [
  ("Centrifuge - putaran", "rpm", "rotation", M24 + " (KMK-MK-020.0)", [("30~12000", "2.4 rpm")]),
  ("Centrifuge - waktu", "s", "time", M24 + " (KMK-MK-020.0)", [("300~600", "0.70 s")]),
  ("Rotator", "rpm", "rotation", M24 + " (KMK-MK-088.0)", [("60~300", "0.64 rpm")]),
  ("Stirrer", "rpm", "rotation", M24 + " (KMK-MK-093.0)", [("30~1500", "0.64 rpm")]),
  ("Tachometer", "rpm", "rotation", M20 + " (MK-048-18)", [("30~90000", "0.29 rpm")]),
  ("Bed Side Monitor - ECG heart rate", "bpm", "heartrate", M24 + " (KMK-MK-012.0)", [("30~240", "0.59 bpm")]),
  ("Cardiotocograph", "bpm", "heartrate", M24 + " (KMK-MK-019.0)", [("30~240", "0.59 bpm")]),
  ("Fetal Doppler", "bpm", "heartrate", M24 + " (KMK-MK-043.0)", [("30~240", "0.59 bpm")]),
 ]),
]

if __name__ == "__main__":
    print(emit(TENANT, LAB, DATA))
