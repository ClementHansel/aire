"""
Shared emitter for KAN accreditation scopes -> lab_partners / lab_capabilities.

One data module per laboratory (lab_<lk>.py) supplies LAB + DATA; this turns
them into SQL. Code does unit arithmetic only. The ranges and uncertainties
themselves are transcribed by hand from each certificate, because pdf-parse
output is not trustworthy across this document set -- one certificate loses the
degree symbol entirely ("30 C ~ 70 C" arrives as "30 0C ~ 70 0C") and another
detaches the method column from its rows. A parser wrong in that way does not
fail loudly; it produces a plausible row that tells a customer yes when the
answer is no.

LAB  = dict(name, lk, until='YYYY-MM-DD'|None, address, phone, email, source, own=False, notes='')
DATA = [(group, [(instrument, unit, quantity, method, [(range_text, uncertainty)], *verified)])]
       range_text: "a~b" for an interval, a bare value for a single point.
       verified:   optional 5th element, default True. Set False for any row the
                   source rendered ambiguously -- unverified rows are stored but
                   can never answer a customer (see LabScopeService).

       quantity None = the row has no scalar magnitude to compare against, e.g.
       a current-transformer RATIO ("3200 A / 1 A") or an energy meter rated as
       "% of scale" over a voltage AND current window. range_text is kept
       verbatim and the SI columns stay NULL, so the row can be shown and quoted
       but never silently range-matched. Forcing such a row onto a scale (say,
       calling a 3200 A / 1 A CT "3200 A") would make it answer magnitude
       questions it does not actually answer.
"""

CANON = {
    "temperature": ("C", {"C": 1}),
    "humidity": ("%rh", {"%rh": 1}),
    "voltage": ("V", {"uV": 1e-6, "mV": 1e-3, "V": 1, "kV": 1e3}),
    "current": ("A", {"uA": 1e-6, "mA": 1e-3, "A": 1}),
    "resistance": ("Ohm", {"uOhm": 1e-6, "mOhm": 1e-3, "Ohm": 1,
                            "kOhm": 1e3, "MOhm": 1e6, "GOhm": 1e9}),
    "capacitance": ("F", {"pF": 1e-12, "nF": 1e-9, "uF": 1e-6, "F": 1}),
    "inductance": ("H", {"uH": 1e-6, "mH": 1e-3, "H": 1}),
    "power": ("W", {"W": 1, "kW": 1e3}),
    "time": ("s", {"ns": 1e-9, "us": 1e-6, "ms": 1e-3, "s": 1}),
    "frequency": ("Hz", {"Hz": 1, "kHz": 1e3, "MHz": 1e6, "GHz": 1e9}),
    "rotation": ("rpm", {"rpm": 1}),
    "mass": ("kg", {"mg": 1e-6, "g": 1e-3, "kg": 1, "ton": 1e3}),
    "volume": ("L", {"uL": 1e-6, "mL": 1e-3, "L": 1}),
    "pressure": ("bar", {"bar": 1, "mbar": 1e-3, "kPa": 0.01, "MPa": 10,
                          "psi": 0.0689476, "kgf/cm2": 0.980665,
                          # 1 mmHg = 133.322 Pa
                          "mmHg": 0.00133322,
                          "Pa": 1e-5, "hPa": 1e-3}),
    "magnetic_flux": ("mT", {"mT": 1, "T": 1e3, "G": 0.1}),
    # Hardness scales are NOT interconvertible (HRA/HRC/HRD measure with
    # different indenters and loads), so each is its own quantity rather than
    # one "hardness" that would silently compare across scales.
    "hardness_hra": ("HRA", {"HRA": 1}),
    "hardness_hrc": ("HRC", {"HRC": 1}),
    "hardness_hrd": ("HRD", {"HRD": 1}),
    "durometer": ("skala", {"skala": 1}),
    "turbidity": ("NTU", {"NTU": 1}),
    "concentration": ("mg/L", {"mg/L": 1}),
    "water_content": ("mg/g", {"mg/g": 1}),
    "wavelength": ("nm", {"nm": 1}),
    "absorbance": ("abs", {"abs": 1}),
    "calorific": ("cal/g", {"cal/g": 1}),
    "moisture_percent": ("%", {"%": 1}),
    "gas_percent_mol": ("% mol", {"% mol": 1}),
    "massflow": ("t/h", {"t/h": 1}),
    "volumeflow_mlh": ("mL/h", {"mL/h": 1}),
    "heartrate": ("bpm", {"bpm": 1}),
    "inclination": ("mm/m", {"mm/m": 1}),
    "force": ("N", {"N": 1, "kN": 1e3, "kgf": 9.80665, "tf": 9806.65, "gf": 0.00980665}),
    "torque": ("Nm", {"Nm": 1, "Ncm": 0.01, "kgf.m": 9.80665, "kgf.cm": 0.0980665}),
    "length": ("mm", {"um": 1e-3, "mm": 1, "cm": 10, "m": 1e3, "km": 1e6}),
    # RF/optical levels. dBm is logarithmic, so these are NOT convertible to or
    # comparable with a linear power quantity -- kept as their own scale.
    "level_dbm": ("dBm", {"dBm": 1}),
    "attenuation_db": ("dB", {"dB": 1}),
    "datarate": ("bps", {"bps": 1, "kbps": 1e3, "Mbps": 1e6, "MBps": 1e6, "Gbps": 1e9}),
    "modulation_percent": ("%", {"%": 1}),
    # Apparent power (VA) is deliberately separate from real power (W): they are
    # only equal at unity power factor, so letting a kVA row answer a watt
    # question would overstate the scope.
    "apparent_power": ("VA", {"VA": 1, "kVA": 1e3}),
    "angle": ("deg", {"deg": 1, "menit": 1.0 / 60}),
    "ph": ("pH", {"pH": 1}),
    "conductivity": ("uS/cm", {"uS/cm": 1, "mS/cm": 1e3}),
    "gas_percent": ("%", {"%": 1}),
    "gas_ppm": ("ppm", {"ppm": 1}),
    "tds": ("mg/L", {"mg/L": 1, "ppm": 1}),
    "flow": ("L/min", {"L/min": 1, "m3/h": 16.6667, "L/h": 1.0 / 60}),
    "energy": ("kWh", {"kWh": 1, "Wh": 1e-3}),
    "sound": ("dB", {"dB": 1}),
    "light": ("lux", {"lux": 1, "Lux": 1}),
    "speed": ("m/s", {"m/s": 1, "ft/sec": 0.3048, "mph": 0.44704, "knots": 0.514444}),
    "energy_joule": ("joule", {"joule": 1}),
    # Shore hardness scales, like Rockwell, are not interconvertible.
    "hardness_shore_a": ("HA", {"HA": 1}),
    "hardness_shore_d": ("HD", {"HD": 1}),
    "hardness_shore_c": ("HC", {"HC": 1}),
    "refractive_index": ("nD20", {"nD20": 1}),
    "brix": ("%Brix", {"%Brix": 1}),
    "colour_temp": ("K", {"K": 1}),
    "irradiance": ("uW/cm2", {"uW/cm2": 1}),
    "altitude": ("m", {"m": 1}),
    "velocity_mm_s": ("mm/s", {"mm/s": 1}),
    "displacement_mm": ("mm", {"mm": 1, "um": 1e-3}),
    "optical_density": ("D", {"D": 1}),
    "transmittance": ("%T", {"%T": 1}),
    "tds_ppt": ("ppt", {"ppt": 1}),
    "acceleration": ("m/s2", {"m/s2": 1}),
    "percent_reading": ("%", {"%": 1}),
    "density": ("g/cm3", {"g/cm3": 1}),
    "viscosity": ("cP", {"cP": 1, "cSt": 1}),
}


def esc(s):
    return str(s).replace("'", "''")


def search_key(s):
    out = []
    for ch in str(s).lower():
        out.append(ch if (ch.isalnum() or ch.isspace()) else " ")
    return " ".join("".join(out).split())


def si(value, unit, quantity, where):
    if quantity not in CANON:
        raise SystemExit("unknown quantity %r (%s)" % (quantity, where))
    canon_unit, table = CANON[quantity]
    if unit not in table:
        raise SystemExit("unknown unit %r for %r (%s)" % (unit, quantity, where))
    return float(value) * table[unit], canon_unit


def emit(tenant, LAB, DATA):
    lk = LAB["lk"]
    out = []
    w = out.append
    w("BEGIN;")
    w("DELETE FROM lab_capabilities WHERE partner_id IN "
      "(SELECT id FROM lab_partners WHERE tenant_id='%s' AND lk_number='%s');" % (tenant, lk))
    w("DELETE FROM lab_partners WHERE tenant_id='%s' AND lk_number='%s';" % (tenant, lk))

    def q(v):
        return "NULL" if v in (None, "") else "'%s'" % esc(v)

    w("INSERT INTO lab_partners (tenant_id, name, lk_number, is_own_lab, accredited_until,"
      " address, phone, email, source_document, notes) VALUES ('%s', '%s', '%s', %s, %s, %s, %s, %s, %s, %s);"
      % (tenant, esc(LAB["name"]), lk, "TRUE" if LAB.get("own") else "FALSE",
         ("DATE '%s'" % LAB["until"]) if LAB.get("until") else "NULL",
         q(LAB.get("address")), q(LAB.get("phone")), q(LAB.get("email")),
         q(LAB.get("source")), q(LAB.get("notes"))))

    rows, order = [], 0
    for group, instruments in DATA:
        for entry in instruments:
            instrument, unit, quantity, method, ranges = entry[:5]
            verified = entry[5] if len(entry) > 5 else True
            # 7th element: per-row note. Used where one LK number covers several
            # physical sites (Telkom has four) and the scope differs between
            # them -- which site can do the work is the routing answer.
            note = entry[6] if len(entry) > 6 else None
            for range_text, unc in ranges:
                order += 1
                where = "%s / %s / %s" % (lk, instrument, range_text)
                if quantity is None:
                    # Descriptive row: keep the wording, refuse to invent a scale.
                    rows.append((group, instrument, search_key(instrument),
                                 str(range_text), unit, None, None,
                                 None, None, None, unc, method, verified, note, order))
                    continue
                if "~" in str(range_text):
                    lo, hi = str(range_text).split("~")
                    lo_si, cu = si(lo, unit, quantity, where)
                    hi_si, _ = si(hi, unit, quantity, where)
                    pt_si = None
                else:
                    lo_si = hi_si = None
                    pt_si, cu = si(range_text, unit, quantity, where)
                rows.append((group, instrument, search_key(instrument),
                             "%s %s" % (range_text, unit), unit, quantity, cu,
                             lo_si, hi_si, pt_si, unc, method, verified, note, order))

    if rows:
        w("INSERT INTO lab_capabilities (tenant_id, partner_id, measurement_group, instrument,"
          " instrument_search, range_text, unit, quantity, canonical_unit, range_min_si,"
          " range_max_si, range_point_si, uncertainty, method, verified, notes, sort_order) VALUES")
        vals = []
        for (g, ins, key, rtext, unit, qty, cu, lo, hi, pt, unc, meth, ver, note, o) in rows:
            def n(x):
                return "NULL" if x is None else repr(round(x, 12))
            vals.append(
                "('%s', (SELECT id FROM lab_partners WHERE tenant_id='%s' AND lk_number='%s'),"
                " '%s', '%s', '%s', '%s', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %d)"
                % (tenant, tenant, lk, esc(g), esc(ins), esc(key), esc(rtext),
                   q(unit), q(qty), q(cu), n(lo), n(hi), n(pt), q(unc), q(meth),
                   "TRUE" if ver else "FALSE", q(note), o))
        w(",\n".join(vals) + ";")
    w("COMMIT;")
    w("SELECT '%s' AS lk, count(*) AS rows, count(*) FILTER (WHERE verified) AS verified"
      " FROM lab_capabilities c JOIN lab_partners p ON p.id=c.partner_id WHERE p.lk_number='%s';" % (lk, lk))
    return "\n".join(out)
