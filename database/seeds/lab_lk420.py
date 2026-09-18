"""PT Teknora Sukses Cemerlang — LK-420-IDN, base appendix (2023) + Supl-1 (2026).

The supplement states it is "bagian yang tidak terpisahkan" — an inseparable
part of the base appendix — so this file merges BOTH. Taking only the newer
document would silently drop most of the lab's scope.

EXTRACTION WARNING: the base appendix is the worst-rendering certificate in the
set. It loses the degree symbol entirely ("30 °C ~ 70 °C" arrives as
"30 0C ~ 70 0C") and detaches the method column from its rows, so method codes
float pages away from the entries they belong to. Every temperature range below
was read against its neighbours to confirm the intended value; where the source
is genuinely ambiguous the row is verified=False.
"""
from lab_seed_lib import emit

TENANT = "1c0ca9f2-06f6-42d3-89e2-6ab6ff41f997"

LAB = dict(
    name="PT Teknora Sukses Cemerlang",
    lk="LK-420-IDN",
    until="2028-10-30",
    address="Bukit Dago Housing Estate Blok BDU No. 86, Rawakalong, Gunung Sindur, "
            "Kabupaten Bogor, Jawa Barat",
    phone="(021) 75881307",
    email="rheny.ahmada@teknora.co.id; suharjo.suharjo@teknora.co.id",
    source="LK 420 IDN (L)_31Okt2023.pdf + LK 420 IDN (L)_Supl1_2026.pdf",
    notes="Lampiran dasar penetapan 31 Oktober 2023 digabung dengan Suplemen-1 "
          "penetapan 15 Juli 2026 (suplemen tidak terpisahkan dari lampiran dasar). "
          "Timbangan sampai 4000 kg dan tegangan tinggi sampai 100 kV.",
)

DATA = [
 ("Suhu dan Kelembapan", [
  ("Oven, Incubator", "C", "temperature", "IK-TH-01", [("30~70", "0.70 C"), ("70~200", "0.92 C")]),
  ("Climatic Chamber", "C", "temperature", "IK-TH-01", [("20~40", "0.70 C")]),
  ("Micro Liquid Bath", "C", "temperature", "IK-TH-03", [("-20~200", "0.57 C")]),
  ("Dry Well Block", "C", "temperature", "IK-TH-04", [("-20~400", "0.53 C")]),
  ("Refrigerator", "C", "temperature", "IK-TH-05", [("-20~25", "0.69 C")]),
  ("Autoclave - suhu", "C", "temperature", "IK-TH-06", [("30~135", "0.67 C")]),
  ("Autoclave - tekanan", "bar", "pressure", "IK-TH-06", [("0~2.5", "0.007 bar")]),
  ("Termometer Gelas", "C", "temperature", "IK-TH-09", [("0~200", "0.33 C")]),
  ("Termometer Radiasi", "C", "temperature", "IK-TH-10", [("25~200", "1.6 C"), ("200~400", "2.6 C")]),
  ("Digital Thermometer with Sensor (Termokopel Tipe K, RTD PT-100)", "C", "temperature", "IK-TH-11",
   [("-20~200", "0.30 C")]),
  ("Temperature Indicator by Simulation - Termokopel Tipe J", "C", "temperature", "IK-TH-12",
   [("-200~1200", "0.20 C")]),
  ("Temperature Indicator by Simulation - Termokopel Tipe K", "C", "temperature", "IK-TH-12",
   [("-100~1300", "0.21 C")]),
  ("Temperature Indicator by Simulation - Termokopel Tipe T", "C", "temperature", "IK-TH-12",
   [("-200~0", "0.21 C"), ("0~400", "0.21 C")]),
  ("Temperature Indicator by Simulation - Termokopel Tipe S", "C", "temperature", "IK-TH-12",
   [("0~1600", "0.45 C")]),
  ("Temperature Indicator by Simulation - RTD PT-100", "C", "temperature", "IK-TH-13",
   [("-100~400", "0.22 C")]),
  ("Temperature Transmitter (Termokopel Tipe K, RTD PT-100; output 4-20 mA)", "C", "temperature", "IK-TH-14",
   [("-100~200", "1.0 C")]),
  ("Thermohygrometer - suhu", "C", "temperature", "IK-TH-16", [("15~40", "0.43 C")]),
  ("Thermohygrometer - kelembapan", "%rh", "humidity", "IK-TH-16", [("30~90", "2.7 %RH")]),
 ]),
 ("Massa", [
  ("Timbangan (Elektronik, Mekanik)", "g", "mass", "CSIRO 2010 (pengukuran langsung)",
   [("0.001~100", "0.13 mg"), ("100~200", "0.23 mg"), ("200~500", "2.2 mg"), ("500~1000", "2.6 mg")]),
  ("Timbangan (Elektronik, Mekanik)", "kg", "mass", "CSIRO 2010 (pengukuran langsung)",
   [("1~10", "3.1 g"), ("10~20", "5.3 g")]),
  ("Timbangan (Elektronik, Mekanik)", "kg", "mass", "I-CAL-GUI-018 (metode substitusi)",
   [("20~400", "0.32 kg"), ("400~4000", "6.2 kg")]),
  ("Anak Timbangan", "kg", "mass", "CSIRO 2010 (metode perbandingan)",
   [("1", "0.10 g"), ("10", "0.10 g"), ("20", "0.10 g")]),
  # Supl-1
  ("Timbangan Elektronik", "kg", "mass", "IK-MK-01; SNSU.PK.M-07", [("400~1000", "0.23 kg")],
   True, "Suplemen-1 (15 Juli 2026)"),
 ]),
 ("Tekanan", [
  ("Pneumatic Pressure (Analogue Pressure, Electromechanical Manometer, Pressure Transducer/Transmitter/Recorder)",
   "bar", "pressure", "IK-MK-03", [("-0.9~0", "0.0020 bar"), ("0~20", "0.0068 bar")]),
  ("Hydraulic Pressure (Analogue Pressure, Electromechanical Manometer, Pressure Transducer/Transmitter/Recorder)",
   "bar", "pressure", "IK-MK-03", [("0~350", "0.28 bar"), ("0~500", "0.85 bar")]),
  ("Safety Valve (Pneumatic)", "bar", "pressure", "IK-MK-04", [("2~20", "0.0096 bar")]),
  # Supl-1
  ("Hydraulic Pressure (Analogue Pressure, Electromechanical Manometer, Pressure Transducer/Transmitter)",
   "bar", "pressure", "IK-MK-03", [("0~700", "0.21 bar")], True, "Suplemen-1 (15 Juli 2026)"),
  ("Pneumatic Pressure (Analogue Pressure, Electromechanical Manometer, Pressure Transducer/Transmitter)",
   "Pa", "pressure", "IK-MK-11",
   [("0~60", "1.2 Pa"), ("60~100", "1.2 Pa"), ("100~250", "1.6 Pa"), ("250~500", "1.7 Pa"),
    ("500~1000", "3.3 Pa"), ("1000~2500", "5.9 Pa")], True, "Suplemen-1 (15 Juli 2026)"),
  ("Barometer", "hPa", "pressure", "IK-MK-12", [("900~1100", "0.62 hPa")], True, "Suplemen-1 (15 Juli 2026)"),
 ]),
 ("Gaya", [
  ("Push Pull", "kgf", "force", "IK-MK-06 (pengukuran langsung)",
   [("0~20", "0.16 kgf"), ("20~50", "0.18 kgf")]),
  ("Mesin Tarik", "kgf", "force", "IK-MK-09 (perbandingan langsung)",
   [("100~950", "0.34 % of reading"), ("950~10000", "0.15 % of reading")]),
  ("Mesin Tekan", "kgf", "force", "IK-MK-09 (perbandingan langsung)",
   [("100~950", "0.35 % of reading"), ("950~10000", "0.20 % of reading")]),
  ("Load Cell Tarik", "kgf", "force", "IK-MK-10 (perbandingan langsung)",
   [("100~950", "0.35 % of reading"), ("950~10000", "0.20 % of reading")]),
  ("Load Cell Tekan", "kgf", "force", "IK-MK-10 (perbandingan langsung)",
   [("100~950", "0.36 % of reading"), ("1000~10000", "0.20 % of reading")]),
 ]),
 ("Torsi", [
  ("Torsi Meter, Torque Wrench", "Nm", "torque", "IK-MK-07 (perbandingan langsung)",
   [("20~100", "0.71 Nm"), ("100~1000", "0.69 % of reading")]),
  ("Torsi Analyzer", "Nm", "torque", "IK-MK-08 (pengukuran langsung)", [("0~1000", "1.3 Nm")]),
 ]),
 ("Aliran", [
  ("Anemometer", "m/s", "speed", "IK-IL-01", [("1~15", "0.51 m/s")]),
 ]),
 ("Kelistrikan", [
  ("AC Voltage Source (f=50 Hz~2 kHz)", "mV", "voltage", "IK-KL-02", [("10~100", "0.19 mV")]),
  ("AC Voltage Source (f=50 Hz~2 kHz)", "V", "voltage", "IK-KL-02",
   [("0.1~1", "7.1 mV"), ("1~10", "0.26 V"), ("10~100", "0.30 V"), ("100~750", "0.85 V")]),
  ("AC High Voltage Source (f=50 Hz)", "kV", "voltage", "IK-KL-01",
   [("1~10", "0.20 kV"), ("10~100", "2.1 kV")]),
  ("DC Voltage Source", "mV", "voltage", "IK-KL-02", [("20~100", "0.042 mV")]),
  ("DC Voltage Source", "V", "voltage", "IK-KL-02",
   [("0.1~1", "0.17 mV"), ("1~10", "1.0 mV"), ("10~100", "0.012 V"), ("100~1000", "0.13 V")]),
  ("DC High Voltage Source", "kV", "voltage", "IK-KL-02",
   [("1~10", "0.22 kV"), ("10~100", "1.7 kV")]),
  ("DC Volt Meter", "mV", "voltage", "IK-KL-03", [("0~100", "10 uV"), ("100~1000", "98 uV")]),
  ("DC Volt Meter", "V", "voltage", "IK-KL-03",
   [("1~10", "0.93 mV"), ("10~100", "9.3 mV"), ("100~1000", "81 mV")]),
  ("DC Volt Meter", "kV", "voltage", "IK-KL-03", [("1~20", "0.28 kV")]),
  ("AC Volt Meter (f=10 Hz~5 kHz)", "mV", "voltage", "IK-KL-03", [("20~200", "0.46 mV")]),
  ("AC Volt Meter (f=10 Hz~5 kHz)", "V", "voltage", "IK-KL-03",
   [("0.2~2", "1.9 mV"), ("2~20", "21 mV"), ("20~200", "0.25 V"), ("200~1000", "1.4 V")]),
  ("AC Volt Meter (f=50 Hz)", "kV", "voltage", "IK-KL-03", [("1~15", "0.23 kV")]),
  ("AC Current Source (f=40 Hz~1 kHz)", "mA", "current", "IK-KL-04",
   [("2~10", "0.012 mA"), ("10~100", "0.15 mA")]),
  ("AC Current Source (f=40 Hz~1 kHz)", "A", "current", "IK-KL-04",
   [("0.1~1", "7.0 mA"), ("1~10", "0.031 A"), ("10~100", "2.4 A"), ("100~700", "16 A"),
    ("700~1000", "23 A")]),
  ("DC Current Source", "mA", "current", "IK-KL-04",
   [("1~10", "0.029 mA"), ("10~100", "0.31 mA")]),
  ("DC Current Source", "A", "current", "IK-KL-04",
   [("0~1", "2.4 mA"), ("1~10", "19 mA"), ("10~100", "2.4 A"), ("100~700", "16 A"),
    ("700~1000", "23 A")]),
  ("AC Current Meter (f=40 Hz~1 kHz)", "mA", "current", "IK-KL-05",
   [("0.2~2", "2.1 uA"), ("2~20", "20 uA"), ("20~200", "0.2 mA")]),
  ("AC Current Meter (f=40 Hz~1 kHz)", "A", "current", "IK-KL-05",
   [("0.2~2", "2.6 mA"), ("2~10", "25 mA")]),
  ("DC Current Meter", "mA", "current", "IK-KL-05",
   [("0.2~2", "0.3 uA"), ("2~20", "3.3 uA"), ("20~200", "38 uA")]),
  ("DC Current Meter", "A", "current", "IK-KL-05",
   [("0.2~2", "1.3 mA"), ("2~10", "6.8 mA")]),
  ("AC Clamp Meter (f=40 Hz~1 kHz)", "A", "current", "IK-KL-06",
   [("1~20", "0.12 A"), ("20~200", "1.1 A"), ("200~500", "1.8 A"), ("500~1000", "3.0 A")]),
  ("DC Clamp Meter", "A", "current", "IK-KL-06",
   [("1~20", "0.12 A"), ("20~200", "1.1 A"), ("200~500", "1.4 A"), ("500~1000", "2.1 A")]),
  ("Ohm Meter", "Ohm", "resistance", "IK-KL-09",
   [("0.1~1", "5.8 mOhm"), ("1~10", "12 mOhm"), ("10~100", "58 mOhm"), ("100~1000", "0.65 Ohm")]),
  ("Ohm Meter", "kOhm", "resistance", "IK-KL-09",
   [("1~10", "6.4 Ohm"), ("10~100", "0.12 kOhm"), ("100~1000", "0.25 kOhm")]),
  ("Ohm Meter", "MOhm", "resistance", "IK-KL-09",
   [("1~10", "7.4 kOhm"), ("10~100", "0.75 MOhm")]),
  ("Mega Ohm / Insulation Tester (25 V~10 kV)", "GOhm", "resistance", "IK-KL-08",
   [("0.1~1", "0.012 GOhm"), ("1~10", "0.19 GOhm"), ("10~100", "1.5 GOhm")]),
  ("Resistor Box (4 wire)", "Ohm", "resistance", "IK-KL-07",
   [("1~10", "0.012 Ohm"), ("10~100", "0.023 Ohm"), ("100~1000", "0.16 Ohm")]),
  ("Resistor Box (2 wire)", "kOhm", "resistance", "IK-KL-09",
   [("1~10", "1.5 Ohm"), ("10~100", "15 Ohm")]),
  ("Resistor Box (2 wire)", "MOhm", "resistance", "IK-KL-09",
   [("0.1~1", "0.13 kOhm"), ("1~10", "7.9 kOhm"), ("10~100", "0.94 MOhm")]),
  # Supl-1
  ("Gaussmeter - media elektromagnetik", "mT", "magnetic_flux", "IK-KL-10",
   [("20~100", "0.40 % of reading")], True, "Suplemen-1 (15 Juli 2026)"),
  ("Gaussmeter - media magnet permanen", "mT", "magnetic_flux", "IK-KL-10",
   [("20~300", "0.40 % of reading")], True, "Suplemen-1 (15 Juli 2026)"),
  ("Gaussmeter - media magnet tetap", "mT", "magnetic_flux", "IK-KL-10",
   [("50~750", "0.40 % of reading")], True, "Suplemen-1 (15 Juli 2026)"),
 ]),
 ("Waktu dan Frekuensi", [
  ("Stopwatch & Timer", "s", "time", "IK-TF-01", [("5~3600", "0.52 s")]),
  ("RPM Meter", "rpm", "rotation", "IK-TF-02",
   [("30~3000", "0.1 rpm"), ("3000~30000", "0.6 rpm"), ("30000~90000", "0.6 rpm")]),
  ("Sumber Frekuensi", "Hz", "frequency", "IK-TF-03", [("0.1~1000", "0.0010 Hz")]),
  ("Sumber Frekuensi", "kHz", "frequency", "IK-TF-03", [("1~10", "0.010 Hz"), ("10~1000", "0.14 Hz")]),
  ("Sumber Frekuensi", "MHz", "frequency", "IK-TF-03", [("1~25", "1.1 Hz")]),
  ("Frequency Counter", "Hz", "frequency", "IK-TF-04", [("0.1~1000", "0.06 Hz")]),
  ("Frequency Counter", "kHz", "frequency", "IK-TF-04", [("1~100", "0.13 Hz")]),
  ("Frequency Counter", "MHz", "frequency", "IK-TF-04", [("0.1~1", "1.2 Hz"), ("1~25", "29 Hz")]),
  ("Oscilloscope - vertical deflection", None, None, "IK-TF-05",
   [("2 mV/div ~ 20 V/div", "0.20 % of reading")]),
  ("Oscilloscope - horizontal deflection", None, None, "IK-TF-05",
   [("50 ns/div ~ 1 s/div", "0.20 % of reading")]),
  # Supl-1
  ("Sound Level Meter (SPL Max 114 dB)", "Hz", "frequency", "IK-IL-06",
   [("63~1000", "0.30 dB"), ("2000~8000", "0.50 dB"), ("12500", "0.60 dB")],
   True, "Suplemen-1 (15 Juli 2026)"),
  ("Sound Calibrator (f=1000 Hz)", "dB", "sound", "IK-IL-07", [("94~114", "0.11 dB")],
   True, "Suplemen-1 (15 Juli 2026)"),
 ]),
 ("Akustik dan Vibrasi", [
  # The base appendix prints the 8000~12500 Hz band twice with different values.
  ("Sound Level Meter (Max SPL 94 dB)", "Hz", "frequency", "IK-IL-03", [("63~4000", "0.4 dB")]),
  ("Sound Level Meter (Max SPL 94 dB)", None, None, "IK-IL-03",
   [("f 8000 Hz ~ 12 500 Hz", "0.5 dB"), ("f 8000 Hz ~ 12 500 Hz", "0.6 dB")], False,
   "Sumber mencetak pita frekuensi yang sama dua kali dengan nilai berbeda, perlu konfirmasi"),
  ("Vibration Meter (f=12.5 Hz~1000 Hz)", "m/s2", "acceleration", "IK-IL-04",
   [("3~50", "1.8 % of reading")]),
  ("Exciter / Meja Vibrasi / Vibration Calibrator (f=12.5 Hz~2000 Hz)", "m/s2", "acceleration", "IK-IL-05",
   [("3~100", "1.8 % of reading")]),
 ]),
 ("Fotometri", [
  ("Luxmeter", "lux", "light", "IK-IL-02", [("60~1900", "2.5 % of reading")]),
 ]),
 ("Instrumen Analitik", [
  ("UVA Meter", "uW/cm2", "irradiance", "IK-IL-08 (substitution)",
   [("300~1000", "3.8 % of reading"), ("1000~5000", "4.3 % of reading")],
   True, "Suplemen-1 (15 Juli 2026)"),
 ]),
]

if __name__ == "__main__":
    print(emit(TENANT, LAB, DATA))
