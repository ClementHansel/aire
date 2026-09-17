"""
Generate the lab_capabilities seed for LK-240-IDN (PT Dinamika Kalibrasi Indonesia).

Why the data is written out by hand instead of parsed from the PDF: extraction
quality varies badly across KAN certificates. One in this set loses the degree
symbol entirely, so "30 C ~ 70 C" arrives as "30 0C ~ 70 0C", and its method
column detaches from its rows. A parser that is wrong in that way does not fail
loudly -- it produces a plausible row that tells a customer yes when the answer
is no. So the ranges and uncertainties below are transcribed and checked against
the certificate, and the only thing code does here is mechanical unit conversion,
which is arithmetic and testable.

Each entry: (instrument, [(range_text, uncertainty)], unit, quantity, method)
Ranges use "a~b" for an interval and a bare value for a single point.

Run:  python lk240_capabilities.py > lk240_seed.sql
"""

TENANT = "1c0ca9f2-06f6-42d3-89e2-6ab6ff41f997"
LK = "LK-240-IDN"

# Multiplier to the canonical unit for each quantity.
CANON = {
    "temperature": ("C", {"C": 1}),
    "humidity": ("%rh", {"%rh": 1}),
    "voltage": ("V", {"uV": 1e-6, "mV": 1e-3, "V": 1, "kV": 1e3}),
    "current": ("A", {"uA": 1e-6, "mA": 1e-3, "A": 1}),
    "resistance": ("Ohm", {"uOhm": 1e-6, "mOhm": 1e-3, "Ohm": 1,
                            "kOhm": 1e3, "MOhm": 1e6, "GOhm": 1e9}),
    "capacitance": ("F", {"pF": 1e-12, "nF": 1e-9, "uF": 1e-6, "F": 1}),
    "inductance": ("H", {"mH": 1e-3, "H": 1}),
    "power": ("W", {"W": 1, "kW": 1e3}),
    "time": ("s", {"ns": 1e-9, "us": 1e-6, "ms": 1e-3, "s": 1}),
    "frequency": ("Hz", {"Hz": 1, "kHz": 1e3, "MHz": 1e6}),
    "rotation": ("rpm", {"rpm": 1}),
    "mass": ("kg", {"mg": 1e-6, "g": 1e-3, "kg": 1}),
    "volume": ("L", {"uL": 1e-6, "mL": 1e-3, "L": 1}),
    "pressure": ("bar", {"bar": 1, "kPa": 0.01, "kgf/cm2": 0.980665}),
    "ph": ("pH", {"pH": 1}),
    "gas_percent": ("%", {"%": 1}),
    "gas_ppm": ("ppm", {"ppm": 1}),
    "tds": ("mg/L", {"mg/L": 1}),
}

# group -> list of (instrument, unit, quantity, method, [(range_text, uncertainty)])
DATA = [
 ("Suhu dan Kelembapan", [
  ("Sensor Temperatur dengan Indikator (Termometer Kontak)", "C", "temperature", "SNSU PK.S-02:2021",
   [("-10~0","0.042 C"),("0~50","0.11 C"),("50~100","0.22 C"),("100~200","0.42 C"),
    ("200~300","0.60 C"),("300~400","0.81 C"),("400~500","1.2 C"),("500~1000","3.4 C")]),
  ("Alat Ukur Kelembaban Relatif (Thermohygrometer) - suhu", "C", "temperature", "JIS Z 8710:1993",
   [("20~40","0.53 C")]),
  ("Alat Ukur Kelembaban Relatif (Thermohygrometer) - kelembapan", "%rh", "humidity", "DKD-R 5-8:2019",
   [("30~75","2.8 %rh")]),
  ("Thermometer Radiasi / Inframerah (Infrared Thermometer)", "C", "temperature", "ASTM E2847:2014",
   [("50~200","2.0 C"),("200~300","3.2 C"),("300~500","3.5 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe J", "C", "temperature", "EURAMET CG-11:2011",
   [("-200~500","0.059 C"),("500~1100","0.069 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe K", "C", "temperature", "EURAMET CG-11:2011",
   [("-200~0","0.061 C"),("0~1000","0.064 C"),("1000~1370","0.071 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe T", "C", "temperature", "EURAMET CG-11:2011",
   [("-200~100","0.057 C"),("100~350","0.060 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe E", "C", "temperature", "EURAMET CG-11:2011",
   [("-200~250","0.051 C"),("250~800","0.048 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe N", "C", "temperature", "EURAMET CG-11:2011",
   [("-200~1000","0.060 C"),("1000~1300","0.071 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe B", "C", "temperature", "EURAMET CG-11:2011",
   [("400~1000","0.30 C"),("1000~1800","0.31 C")]),
  ("Indikator Temperatur Tanpa Sensor - Termokopel Tipe R/S", "C", "temperature", "EURAMET CG-11:2011",
   [("0~300","0.18 C"),("300~1750","0.18 C")]),
  ("Indikator Temperatur Tanpa Sensor - RTD PT100", "C", "temperature", "EURAMET CG-11:2011",
   [("-10~0","0.60 C"),("0~300","0.63 C")]),
  ("Sensor RTD PT100", "C", "temperature", "JIS C 1604:2013",
   [("-10~0","0.21 C"),("0~100","0.21 C"),("100~300","0.67 C")]),
  ("Sensor Termokopel Tipe K", "C", "temperature", "ASTM E220:2019",
   [("0~100","0.28 C"),("100~300","0.67 C"),("300~500","1.4 C"),("500~800","2.9 C"),("800~1000","3.1 C")]),
  ("Inkubator", "C", "temperature", "KAN Pd-02.04:2019", [("25~75","2.1 C")]),
  ("Oven", "C", "temperature", "KAN Pd-02.04:2019", [("25~50","2.6 C"),("50~300","3.5 C")]),
  ("Refrigerator", "C", "temperature", "KAN Pd-02.04:2019", [("4~8","1.8 C")]),
  ("Freezer", "C", "temperature", "KAN Pd-02.04:2019", [("-20~-10","1.1 C"),("-10~0","2.9 C")]),
  ("Climatic Chamber - suhu", "C", "temperature", "DKD-R 5-7 2018-09",
   [("20~30","2.0 C"),("30~40","2.9 C")]),
  ("Climatic Chamber - kelembapan", "%rh", "humidity", "DKD-R 5-7 2018-09",
   [("30~50","2.6 %rh"),("50~80","3.5 %rh")]),
  ("Dry Block / Dry Well", "C", "temperature", "EURAMET No.13 Ver.4:2015",
   [("-10~0","0.71 C"),("0~200","1.2 C"),("200~500","2.5 C")]),
 ]),
 ("Kelistrikan", [
  ("DC Voltmeter", "mV", "voltage", "IK.KL-04:2019", [("0~19.90","6.2 uV"),("20~199","58 uV")]),
  ("DC Voltmeter", "V", "voltage", "IK.KL-04:2019",
   [("0.2~1.99","1.8 mV"),("2~19.9","6.1 mV"),("20~199","58 mV"),("100~1000","0.58 V")]),
  ("AC Voltmeter (f=20 Hz~20 kHz)", "mV", "voltage", "IK.KL-02:2019",
   [("1~20","0.039 mV"),("20~199","0.14 mV")]),
  ("AC Voltmeter (f=20 Hz~20 kHz)", "V", "voltage", "IK.KL-02:2019",
   [("0.2~1.99","0.030 V"),("2~19.9","0.039 V")]),
  ("AC Voltmeter (f=40 Hz~1 kHz)", "V", "voltage", "IK.KL-02:2019",
   [("20~199","0.14 V"),("100~1000","0.76 V")]),
  ("DC Amperemeter", "mA", "current", "IK.KL-03:2022",
   [("0~0.199","0.60 uA"),("0.2~1.99","0.61 uA"),("2~19.9","6.0 uA"),("20~199","0.061 mA")]),
  ("DC Amperemeter", "A", "current", "IK.KL-03:2022", [("0.2~1.99","2.1 mA"),("2~20","0.061 A")]),
  ("AC Amperemeter (f=20 Hz~1 kHz)", "mA", "current", "IK.KL-01:2022",
   [("0.01~0.199","0.65 uA"),("0.2~1.99","1.2 uA"),("2~19.9","0.014 mA"),("20~199","0.12 mA")]),
  ("AC Amperemeter (f=40~500 Hz)", "A", "current", "IK.KL-01:2022",
   [("0.2~1.99","1.0 mA"),("2~20","9.2 mA")]),
  ("DC Clampmeter", "A", "current", "IK.KL-03:2022", [("0.2~20","0.058 A"),("20~1000","0.84 A")]),
  ("AC Clampmeter", "A", "current", "IK.KL-01:2022", [("0.2~20","0.058 A"),("20~1000","1.1 A")]),
  ("Ohmmeter", "Ohm", "resistance", "IK.KL-07:2019",
   [("1~19","0.059 Ohm"),("19~90","0.061 Ohm"),("90~900","0.59 Ohm")]),
  ("Ohmmeter", "kOhm", "resistance", "IK.KL-07:2019",
   [("0.9~9","6.1 Ohm"),("9~90","0.059 kOhm"),("90~900","0.59 kOhm")]),
  ("Ohmmeter", "MOhm", "resistance", "IK.KL-07:2019", [("0.9~9","5.9 kOhm"),("9~90","0.12 MOhm")]),
  ("Kapasitansi Meter", "nF", "capacitance", "IK.KL-06:2017",
   [("1","3.1 pF"),("10","0.014 nF"),("20","0.022 nF"),("50","0.047 nF"),
    ("100","0.092 nF"),("200","0.19 nF"),("500","0.46 nF")]),
  ("Kapasitansi Meter", "uF", "capacitance", "IK.KL-06:2017",
   [("1","0.023 uF"),("10","0.074 uF"),("20","0.12 uF"),("50","0.29 uF")]),
  ("Oscilloscope - Amplitude", "mV", "voltage", "IK.KL-10:2017",
   [("10~50","0.35 mV"),("50~200","0.77 mV")]),
  ("Oscilloscope - Amplitude", "V", "voltage", "IK.KL-10:2017",
   [("0.2~10","0.059 V"),("10~200","0.59 V")]),
  ("Oscilloscope - Periode", "ns", "time", "IK.KL-10:2017",
   [("10","0.058 ns"),("10~500","0.58 ns")]),
  ("Oscilloscope - Periode", "us", "time", "IK.KL-10:2017",
   [("0.5~5","0.0060 ns"),("5~50","0.058 us"),("50~500","0.58 us")]),
  ("Oscilloscope - Periode", "ms", "time", "IK.KL-10:2017",
   [("0.5~1","0.0058 us"),("1~10","0.058 ms"),("10~500","0.58 ms")]),
  ("Oscilloscope - Periode", "s", "time", "IK.KL-10:2017", [("0.5~1","5.8 ms")]),
  ("AC Wattmeter (f=50 Hz)", "W", "power", "IK.KL-08:2017", [("100~1000","1.4 W")]),
  ("AC Wattmeter (f=50 Hz)", "kW", "power", "IK.KL-08:2017", [("1~10","11 W")]),
  ("Insulation Meter", "MOhm", "resistance", "IK.KL-09:2017",
   [("0.1~1","0.058 MOhm"),("1~10","0.078 MOhm"),("10~100","0.62 MOhm")]),
  ("Insulation Meter", "GOhm", "resistance", "IK.KL-09:2017",
   [("0.1~1","0.059 GOhm"),("1~10","0.12 GOhm"),("10~100","0.57 GOhm")]),
  ("DC Voltage Source", "mV", "voltage", "IK.KL-04a:2025", [("50~100","0.013 mV")]),
  ("DC Voltage Source", "V", "voltage", "IK.KL-04a:2025",
   [("0.1~1","0.00009 V"),("1~10","0.0026 V"),("10~100","0.041 V"),("100~1000","0.41 V")]),
  ("AC Voltage Source", "mV", "voltage", "IK.KL-02a:2025", [("50~100","0.79 mV")]),
  ("AC Voltage Source", "V", "voltage", "IK.KL-02a:2025",
   [("0.1~0.5","0.0048 V"),("0.5~5","0.044 V"),("5~50","0.44 V"),("50~750","0.83 V")]),
  ("DC Current Source", "mA", "current", "IK.KL-03a:2025",
   [("5~10","0.0081 mA"),("10~100","0.064 mA")]),
  ("DC Current Source", "A", "current", "IK.KL-03a:2025", [("0.1~1","0.0013 A"),("1~3","0.0099 A")]),
  ("AC Current Source", "A", "current", "IK.KL-01a:2025",
   [("0.2~0.5","0.0013 A"),("0.5~1","0.0040 A"),("1~2","0.0069 A"),("2~3","0.0096 A")]),
  ("Resistor Source", "Ohm", "resistance", "IK.KL-07C:2025", [("0~100","0.017 Ohm")]),
  ("Resistor Source", "kOhm", "resistance", "IK.KL-07C:2025",
   [("0.1~1","0.00014 kOhm"),("1~10","0.0014 kOhm"),("10~100","0.014 kOhm")]),
  ("Resistor Source", "MOhm", "resistance", "IK.KL-07C:2025",
   [("0.1~1","0.00072 MOhm"),("1~10","0.0016 MOhm"),("10~100","0.95 MOhm")]),
  ("Micro Ohm Meter", "uOhm", "resistance", "IK.KL-07B:2025",
   [("50","0.51 uOhm"),("100","0.95 uOhm"),("150","1.4 uOhm"),("200","1.9 uOhm")]),
  ("Micro Ohm Meter", "mOhm", "resistance", "IK.KL-07B:2025",
   [("0.5","2.9 uOhm"),("1","5.8 uOhm"),("1.5","8.7 uOhm"),("2","12 uOhm"),("5","12 uOhm"),
    ("10","0.023 mOhm"),("15","0.035 mOhm"),("20","0.046 mOhm"),("50","0.058 mOhm"),
    ("100","0.12 mOhm"),("150","0.17 mOhm"),("200","0.23 mOhm")]),
  ("Micro Ohm Meter", "Ohm", "resistance", "IK.KL-07B:2025",
   [("0.5","0.58 mOhm"),("1","1.2 mOhm"),("1.5","1.7 mOhm"),("2","2.3 mOhm")]),
  ("Clamp Resistance Meter", "Ohm", "resistance", "IK.KL-07a:2025",
   [("1~10","0.013 Ohm"),("10~110","0.11 Ohm"),("110~2500","1.1 Ohm")]),
  ("Induktansi Meter", "mH", "inductance", "IK.KL-06a:2025",
   [("1~2","0.006 mH"),("2~10","0.030 mH"),("10~20","0.23 mH"),("20~50","0.61 mH"),
    ("50~100","1.2 mH"),("100~200","2.3 mH"),("200~500","6.0 mH")]),
  ("Induktansi Meter", "H", "inductance", "IK.KL-06a:2025", [("0.5~1","0.012 H")]),
  ("Signal Generator / Frequency Source", "Hz", "frequency", "IK.KL-05a:2025", [("5~1000","0.12 Hz")]),
  ("Signal Generator / Frequency Source", "kHz", "frequency", "IK.KL-05a:2025", [("1~300","0.12 kHz")]),
 ]),
 ("Waktu dan Frekuensi", [
  ("Tachometer / RPM Meter", "rpm", "rotation", "IK.KL-11:2017", [("1200~99000","0.84 rpm")]),
  ("Stopwatch, Timer", "s", "time", "SNSU PK.W-01:2020", [("10~1800","0.11 s")]),
 ]),
 ("Massa", [
  ("Timbangan", "g", "mass", "SNSU PK.M-02:2021",
   [("0~80","0.43 mg"),("80~200","0.49 mg"),("200~1000","0.017 g"),
    ("1000~5000","0.018 g"),("5000~30000","0.17 g")]),
  ("Timbangan", "kg", "mass", "SNSU PK.M-02:2021",
   [("30~60","8.3 g"),("60~150","8.6 g"),("150~300","0.010 kg"),
    ("300~500","0.41 kg"),("500~1000","0.41 kg")]),
  ("Anak Timbangan", "g", "mass", "SNSU PK.M-04:2022",
   [("0.001","0.054 mg"),("0.002","0.054 mg"),("0.005","0.054 mg"),("0.01","0.054 mg"),
    ("0.02","0.054 mg"),("0.05","0.054 mg"),("0.1","0.054 mg"),("0.2","0.054 mg"),
    ("0.5","0.054 mg"),("1","0.055 mg"),("2","0.055 mg"),("5","0.056 mg"),
    ("10","0.056 mg"),("20","0.059 mg"),("50","0.21 mg"),("100","0.23 mg"),
    ("200","0.36 mg"),("500","0.29 mg")]),
  ("Anak Timbangan", "kg", "mass", "SNSU PK.M-04:2022",
   [("1","8.1 mg"),("2","8.1 mg"),("5","12 mg"),("10","0.083 g"),("20","0.089 g")]),
  ("Beban", "kg", "mass", "SNSU PK.M-04:2022", [("25","0.093 g"),("30","0.10 g")]),
 ]),
 ("Volume", [
  ("Burette", "mL", "volume", "SNSU PK.M-05:2023", [("10","0.021 mL"),("50","0.043 mL")]),
  ("Gelas Ukur", "mL", "volume", "SNSU PK.M-05:2023",
   [("10","0.048 mL"),("25","0.11 mL"),("50","0.21 mL"),("100","0.22 mL")]),
  ("Labu Ukur", "mL", "volume", "SNSU PK.M-05:2023", [("100","0.082 mL"),("1000","0.52 mL")]),
  ("Pipet Ukur", "mL", "volume", "SNSU PK.M-05:2023", [("10","0.040 mL"),("50","0.073 mL")]),
  ("Pipet Volume", "mL", "volume", "SNSU PK.M-05:2023", [("10","0.010 mL"),("50","0.015 mL")]),
  ("Mikropipet", "uL", "volume", "ISO 8655-2:2022 & ISO 8655-6:2022",
   [("2~20","0.03 uL"),("20~200","0.23 uL"),("100~1000","1.2 uL")]),
 ]),
 ("Tekanan", [
  ("Vacuum Gauge", "bar", "pressure", "IK-KT-01:2025", [("-0.9~0","0.0071 bar")]),
  ("Pressure Gauge (Pneumatic)", "bar", "pressure", "IK-KT-01:2025", [("0~60","0.0071 bar")]),
  ("Pressure Gauge (Hydraulic)", "bar", "pressure", "IK-KT-01:2025",
   [("50~100","0.21 bar"),("100~1000","0.21 bar")]),
  ("Differential Pressure Gauge", "kPa", "pressure", "IK-KT-01:2025", [("-60~60","0.015 kPa")]),
  ("Pressure Transmitter (output 4-20 mA)", "bar", "pressure", "IK-KT-02:2025",
   [("60~120","0.25 bar"),("120~180","0.25 bar"),("180~240","0.25 bar"),("240~300","0.25 bar")]),
  ("Safety Valve", "bar", "pressure", "IK-KT-03:2025", [("20","0.054 bar")]),
  ("Pressure Switch", "kgf/cm2", "pressure", "IK-KT-03:2025",
   [("100","1.2 kgf/cm2"),("100~200","1.4 kgf/cm2"),("200~300","0.66 kgf/cm2")]),
 ]),
 ("Instrumen Analitik", [
  ("Gas Detector - O2", "%", "gas_percent", "IK-KG01:2025", [("18","0.81 %")]),
  ("Gas Detector - CO", "ppm", "gas_ppm", "IK-KG01:2025", [("100","4.0 ppm")]),
  ("Gas Detector - H2S", "ppm", "gas_ppm", "IK-KG01:2025", [("25","2.5 ppm")]),
  ("Gas Detector - CH4 (LEL)", "%", "gas_percent", "IK-KG01:2025", [("2.5","0.39 %")]),
  ("Indoor & Outdoor Gas Ambient Analyzer - O2", "%", "gas_percent", "IK-KG03:2025", [("18","0.79 %")]),
  ("Indoor & Outdoor Gas Ambient Analyzer - CO", "ppm", "gas_ppm", "IK-KG03:2025", [("100","4.0 ppm")]),
  ("Indoor & Outdoor Gas Ambient Analyzer - H2S", "ppm", "gas_ppm", "IK-KG03:2025", [("25","2.5 ppm")]),
  ("Indoor & Outdoor Gas Ambient Analyzer - CH4 (LEL)", "%", "gas_percent", "IK-KG03:2025", [("2.5","0.39 %")]),
  ("Gas Analyzer - O2", "%", "gas_percent", "IK-KG02:2025", [("20.9","0.89 %")]),
  ("Gas Analyzer - CO2", "%", "gas_percent", "IK-KG02:2025", [("40","1.8 %")]),
  ("Gas Analyzer - H2S", "ppm", "gas_ppm", "IK-KG02:2025", [("50","5.1 ppm")]),
  ("Gas Analyzer - Methana (CH4)", "%", "gas_percent", "IK-KG02:2025", [("60","2.4 %")]),
  ("pH Meter", "pH", "ph", "ASTM E70-07:2024", [("4","0.021 pH"),("7","0.021 pH"),("10","0.031 pH")]),
  ("TDS Meter", "mg/L", "tds", "ASTM D 1125:2023", [("1000","5.1 mg/L"),("1500","5.1 mg/L")]),
 ]),
]


def esc(s):
    return s.replace("'", "''")


def search_key(s):
    out = []
    for ch in s.lower():
        out.append(ch if (ch.isalnum() or ch.isspace()) else " ")
    return " ".join("".join(out).split())


def si(value, unit, quantity):
    canon_unit, table = CANON[quantity]
    if unit not in table:
        raise SystemExit("unknown unit %r for quantity %r" % (unit, quantity))
    return float(value) * table[unit], canon_unit


def main():
    rows = []
    order = 0
    for group, instruments in DATA:
        for instrument, unit, quantity, method, ranges in instruments:
            for range_text, uncertainty in ranges:
                order += 1
                if "~" in range_text:
                    lo, hi = range_text.split("~")
                    lo_si, cu = si(lo, unit, quantity)
                    hi_si, _ = si(hi, unit, quantity)
                    pt_si = None
                else:
                    lo_si = hi_si = None
                    pt_si, cu = si(range_text, unit, quantity)
                rows.append((group, instrument, search_key(instrument),
                             "%s %s" % (range_text, unit), unit, quantity, cu,
                             lo_si, hi_si, pt_si, uncertainty, method, order))

    print("BEGIN;")
    print("DELETE FROM lab_capabilities WHERE partner_id IN "
          "(SELECT id FROM lab_partners WHERE tenant_id='%s' AND lk_number='%s');" % (TENANT, LK))
    print("DELETE FROM lab_partners WHERE tenant_id='%s' AND lk_number='%s';" % (TENANT, LK))
    print("""INSERT INTO lab_partners
  (tenant_id, name, lk_number, is_own_lab, accredited_until, address, phone, email, source_document, notes)
VALUES ('%s', 'PT Dinamika Kalibrasi Indonesia', '%s', TRUE, DATE '2031-06-13',
  'Ruko Graha Boulevard Blok B22, Gading Serpong, Curug Sangereng, Kelapa Dua, Kab. Tangerang, Banten',
  '021 3971 3008', 'dki@kalibrasindonesia.com',
  'LK-240-IDN (L) 14 Juni 2026.pdf',
  'Laboratorium milik tenant sendiri. Penetapan 14 Juni 2026.');""" % (TENANT, LK))

    print("INSERT INTO lab_capabilities (tenant_id, partner_id, measurement_group, instrument,"
          " instrument_search, range_text, unit, quantity, canonical_unit, range_min_si,"
          " range_max_si, range_point_si, uncertainty, method, verified, sort_order) VALUES")
    vals = []
    for (g, ins, key, rtext, unit, q, cu, lo, hi, pt, unc, meth, o) in rows:
        def n(x):
            return "NULL" if x is None else repr(round(x, 12))
        vals.append(
            "('%s', (SELECT id FROM lab_partners WHERE tenant_id='%s' AND lk_number='%s'),"
            " '%s', '%s', '%s', '%s', '%s', '%s', '%s', %s, %s, %s, '%s', '%s', TRUE, %d)"
            % (TENANT, TENANT, LK, esc(g), esc(ins), esc(key), esc(rtext), esc(unit),
               q, cu, n(lo), n(hi), n(pt), esc(unc), esc(meth), o))
    print(",\n".join(vals) + ";")
    print("COMMIT;")
    print("SELECT count(*) AS seeded FROM lab_capabilities WHERE tenant_id='%s';" % TENANT)


if __name__ == "__main__":
    main()
