from flask import Flask, request, jsonify
from flask_cors import CORS
import geopandas as gpd
from shapely.geometry import Point
import math
# App Spotify
from dotenv import load_dotenv
import os
from spotify_app.routes import spotify_bp

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["https://calculoperfil.gabrielvc.com.br", "http://127.0.0.1:5500", "https://spotify.gabrielvc.com.br"])

app.register_blueprint(spotify_bp)

geojson_path = "Regiões.geojson"
gdf = gpd.read_file(geojson_path)

pressao_map = {
    '1': {2: 350, 5: 420, 10: 500, 20: 600, 30: 660},
    '2': {2: 470, 5: 580, 10: 680, 20: 815, 30: 890},
    '3': {2: 610, 5: 750, 10: 890, 20: 1060, 30: 1170},
    '4': {2: 770, 5: 950, 10: 1130, 20: 1350, 30: 1480},
    '5': {2: 950, 5: 1180, 10: 1400, 20: 1660, 30: 1820},
}

v0_map = {
    '1': 30,
    '2': 35,
    '3': 40,
    '4': 45,
    '5': 50,
}

s2_meteorological_parameters = {
    "categoria1": {
        "A": {"bm": 1.10, "p": 0.06},
        "B": {"bm": 1.11, "p": 0.065},
        "C": {"bm": 1.12, "p": 0.07},
    },
    "categoria2": {
        "A": {"bm": 1.0, "p": 0.085},
        "B": {"bm": 1.0, "p": 0.09},
        "C": {"bm": 1.0, "p": 0.10},
    },
    "categoria3": {
        "A": {"bm": 0.94, "p": 0.10},
        "B": {"bm": 0.94, "p": 0.105},
        "C": {"bm": 0.93, "p": 0.115},
    },
    "categoria4": {
        "A": {"bm": 0.86, "p": 0.12},
        "B": {"bm": 0.85, "p": 0.125},
        "C": {"bm": 0.84, "p": 0.135},
    },
    "categoria5": {
        "A": {"bm": 0.74, "p": 0.15},
        "B": {"bm": 0.73, "p": 0.16},
        "C": {"bm": 0.71, "p": 0.175},
    },
}

s2_gust_factor = {
    "A": 1.00,
    "B": 0.98,
    "C": 0.95,
}

facade_cpe_table_nbr_2023 = {
    "rows": [
        {
            "h_over_b": {"min": 0, "max": 0.5, "min_exclusive": False, "max_inclusive": True},
            "a_over_b": {"min": 1, "max": 1.5, "min_inclusive": True, "max_inclusive": True},
            "alpha0": {"A1 e B1": -0.8, "A2 e B2": -0.5, "C": 0.7, "D": -0.4},
            "alpha90": {"A": 0.7, "B": -0.4, "C1 e D1": -0.8, "C2 e D2": -0.4},
            "average_cpe": -0.9,
        },
        {
            "h_over_b": {"min": 0, "max": 0.5, "min_exclusive": False, "max_inclusive": True},
            "a_over_b": {"min": 2, "max": 4, "min_inclusive": True, "max_inclusive": True},
            "alpha0": {"A1 e B1": -0.8, "A2 e B2": -0.4, "C": 0.7, "D": -0.3},
            "alpha90": {"A": 0.7, "B": -0.5, "C1 e D1": -0.9, "C2 e D2": -0.5},
            "average_cpe": -1.0,
        },
        {
            "h_over_b": {"min": 0.5, "max": 1.5, "min_exclusive": True, "max_inclusive": True},
            "a_over_b": {"min": 1, "max": 1.5, "min_inclusive": True, "max_inclusive": True},
            "alpha0": {"A1 e B1": -0.9, "A2 e B2": -0.5, "C": 0.7, "D": -0.5},
            "alpha90": {"A": 0.7, "B": -0.5, "C1 e D1": -0.9, "C2 e D2": -0.5},
            "average_cpe": -1.1,
        },
        {
            "h_over_b": {"min": 0.5, "max": 1.5, "min_exclusive": True, "max_inclusive": True},
            "a_over_b": {"min": 2, "max": 4, "min_inclusive": True, "max_inclusive": True},
            "alpha0": {"A1 e B1": -0.9, "A2 e B2": -0.4, "C": 0.7, "D": -0.3},
            "alpha90": {"A": 0.7, "B": -0.6, "C1 e D1": -0.9, "C2 e D2": -0.5},
            "average_cpe": -1.1,
        },
        {
            "h_over_b": {"min": 1.5, "max": 6, "min_exclusive": True, "max_inclusive": True},
            "a_over_b": {"min": 1, "max": 1.5, "min_inclusive": True, "max_inclusive": True},
            "alpha0": {"A1 e B1": -1.0, "A2 e B2": -0.6, "C": 0.8, "D": -0.6},
            "alpha90": {"A": 0.8, "B": -0.6, "C1 e D1": -1.0, "C2 e D2": -0.6},
            "average_cpe": -1.2,
        },
        {
            "h_over_b": {"min": 1.5, "max": 6, "min_exclusive": True, "max_inclusive": True},
            "a_over_b": {"min": 2, "max": 4, "min_inclusive": True, "max_inclusive": True},
            "alpha0": {"A1 e B1": -1.0, "A2 e B2": -0.5, "C": 0.8, "D": -0.3},
            "alpha90": {"A": 0.8, "B": -0.6, "C1 e D1": -1.0, "C2 e D2": -0.6},
            "average_cpe": -1.2,
        },
    ],
}

internal_pressure_cases = [0.2, -0.3]

glass_equivalence = {
    "insulated": {
        "two_glasses": 1.6,
    },
    "laminated": {
        "two_glasses": 1.3,
    },
    "monolithic": {
        "float": 1.0,
        "armado": 1.3,
        "impresso": 1.1,
        "temperado": 0.77,
    },
}

glass_types = {
    "monolitico_float": {
        "label": "Monolítico float",
        "system": "monolithic",
        "monolithic_factor": "float",
        "minimum_pane_thickness": 3,
    },
    "monolitico_impresso": {
        "label": "Monolítico impresso",
        "system": "monolithic",
        "monolithic_factor": "impresso",
        "minimum_pane_thickness": 3,
    },
    "monolitico_armado": {
        "label": "Monolítico armado",
        "system": "monolithic",
        "monolithic_factor": "armado",
    },
    "monolitico_temperado": {
        "label": "Monolítico temperado",
        "system": "monolithic",
        "monolithic_factor": "temperado",
    },
    "laminado_float_2": {
        "label": "Laminado float - 2 vidros",
        "system": "laminated",
        "monolithic_factor": "float",
        "panes": 2,
        "minimum_pane_thickness": 3,
    },
    "insulado_float_2": {
        "label": "Insulado float - 2 vidros",
        "system": "insulated",
        "composition": "monolithic_monolithic",
        "monolithic_factor": "float",
        "panes": 2,
        "minimum_pane_thickness": 3,
    },
    "insulado_float_laminado": {
        "label": "Insulado float + laminado",
        "system": "insulated",
        "composition": "monolithic_laminated",
        "monolithic_factor": "float",
        "panes": 3,
        "minimum_pane_thickness": 3,
    },
}

glass_deflection_alpha_table_four_sides = [
    (0.1, 2.1143),
    (0.2, 2.1000),
    (0.3, 2.1000),
    (0.4, 1.8714),
    (0.5, 1.6429),
    (0.6, 1.4143),
    (0.7, 1.1857),
    (0.8, 0.9714),
    (0.9, 0.8000),
    (1.0, 0.6571),
]

monolithic_nominal_thicknesses = [4, 6, 8, 10, 12, 14, 16]
composed_nominal_thicknesses = [6, 8, 10, 12, 14, 16]

alloy_properties = {
    "6060-T5": {
        "lrt": 150,
        "melast": 70000,
        "densidade": 0.00270,
    },
    "6063-T6": {
        "lrt": 180,
        "melast": 70000,
        "densidade": 0.00270,
    },
    "6351-T6": {
        "lrt": 290,
        "melast": 70000,
        "densidade": 0.00271,
    },
}

def calcular_pressao(region, pavimentos):
    if region in pressao_map:
        pavimentos_disponiveis = sorted(pressao_map[region].keys())
        pavimentos_usados = next((p for p in pavimentos_disponiveis if p >= pavimentos), None)
        
        if pavimentos_usados:
            return pressao_map[region][pavimentos_usados]
        else:
            # Se pavimentos for > 30, usa o valor de 30
            return pressao_map[region][pavimentos_disponiveis[-1]]
    else:
        return "Região não definida"

def largurafolha(larguratotal, quantidadefol):
    return larguratotal / quantidadefol

def calcular_wx(pressao_ensaio, largurafol, alturafol, lrt):
    return (pressao_ensaio * 1e-6 * largurafol * alturafol**2) / (4 * lrt)

def calcular_jx(pressao_ensaio, largurafol, alturafol, melast):
    jx1 = (5 * pressao_ensaio * 1e-6 * largurafol * alturafol**4) / (384 * melast * (alturafol / 175))
    jx2 = (5 * pressao_ensaio * 1e-6 * largurafol * alturafol**4) / (384 * melast * 20)
    return max(jx1, jx2)

def get_s2_class(height):
    z = float(height)

    if z < 20:
        return "A"

    if z <= 50:
        return "B"

    return "C"

def calculate_s2(category, height):
    z = float(height)

    if z <= 0:
        raise ValueError("Altura da edificação inválida")

    s2_class = get_s2_class(z)
    meteorological = s2_meteorological_parameters.get(category, {}).get(s2_class)
    gust_factor = s2_gust_factor.get(s2_class)

    if not meteorological or not gust_factor:
        raise ValueError("Tabela S2 não cadastrada para categoria/classe selecionada")

    value = meteorological["bm"] * gust_factor * (z / 10) ** meteorological["p"]

    return {
        "value": value,
        "class": s2_class,
        "meteorological": meteorological,
        "gust_factor": gust_factor,
    }

def is_inside_range(range_data, value):
    min_ok = value > range_data["min"] if range_data.get("min_exclusive") else value >= range_data["min"]
    max_ok = value <= range_data["max"] if range_data.get("max_inclusive") else value < range_data["max"]
    return min_ok and max_ok

def find_facade_cpe_row(h_over_b, a_over_b):
    for row in facade_cpe_table_nbr_2023["rows"]:
        if is_inside_range(row["h_over_b"], h_over_b) and is_inside_range(row["a_over_b"], a_over_b):
            return row
    return None

def get_facade_cpe_candidates(row):
    candidates = []

    for zone, cpe in row["alpha0"].items():
        candidates.append({"wind_angle": "α = 0°", "zone": zone, "cpe": cpe})

    for zone, cpe in row["alpha90"].items():
        candidates.append({"wind_angle": "α = 90°", "zone": zone, "cpe": cpe})

    return candidates

def calculate_cp_envelope(length1, length2, height, dynamic_pressure):
    l1 = float(length1)
    l2 = float(length2)
    h = float(height)
    q = float(dynamic_pressure)

    if min(l1, l2, h, q) <= 0:
        raise ValueError("Dimensões e pressão dinâmica devem ser maiores que zero")

    a = max(l1, l2)
    b = min(l1, l2)
    h_over_b = h / b
    a_over_b = a / b
    table_row = find_facade_cpe_row(h_over_b, a_over_b)

    if not table_row:
        raise ValueError("Tabela Cpe não cadastrada para as relações h/b e a/b calculadas")

    cases = []

    for external in get_facade_cpe_candidates(table_row):
        for cpi in internal_pressure_cases:
            cp = external["cpe"] - cpi
            pressure = cp * q
            cases.append({
                "wind_angle": external["wind_angle"],
                "zone": external["zone"],
                "h_over_b": h_over_b,
                "a_over_b": a_over_b,
                "cpe": external["cpe"],
                "cpi": cpi,
                "cp": cp,
                "pressure": pressure,
            })

    governing = max(cases, key=lambda item: abs(item["pressure"]))

    return {
        "governing": governing,
        "positive_pressure": max(item["pressure"] for item in cases),
        "negative_pressure": min(item["pressure"] for item in cases),
        "design_pressure": q,
        "test_pressure": abs(governing["pressure"]),
        "average_cpe": table_row["average_cpe"],
    }

def calculate_dynamic_pressure(v0, s1, s2, s3):
    vk = float(v0) * float(s1) * float(s2) * float(s3)
    return 0.613 * vk**2

def get_effective_s3(s3, use_sealing_factor=False):
    value = float(s3)
    return value * 0.92 if use_sealing_factor else value

def interpolate_alpha_four_sides(ratio):
    if ratio <= 0.1:
        return 2.1143

    if ratio >= 1:
        return 0.6571

    table = glass_deflection_alpha_table_four_sides

    for index in range(len(table) - 1):
        x1, y1 = table[index]
        x2, y2 = table[index + 1]

        if x1 <= ratio <= x2:
            return y1 + ((ratio - x1) / (x2 - x1)) * (y2 - y1)

    return table[-1][1]

def calculate_glass_base_thickness(width_mm, height_mm, design_pressure):
    width_m = float(width_mm) / 1000
    height_m = float(height_mm) / 1000
    pressure = float(design_pressure)

    if min(width_m, height_m, pressure) <= 0:
        raise ValueError("Dados do vidro inválidos")

    larger_side = max(width_m, height_m)
    smaller_side = min(width_m, height_m)
    area = width_m * height_m
    aspect_ratio = larger_side / smaller_side

    if aspect_ratio <= 2.5:
        e1 = math.sqrt((area * pressure) / 100)
    else:
        e1 = (smaller_side * math.sqrt(pressure)) / 6.3

    return {
        "e1": e1,
        "larger_side_m": larger_side,
        "smaller_side_m": smaller_side,
        "area_m2": area,
        "aspect_ratio": aspect_ratio,
    }

def calculate_glass_deflection_requirement(smaller_side_m, larger_side_m, design_pressure):
    ratio = smaller_side_m / larger_side_m
    alpha = interpolate_alpha_four_sides(ratio)
    deflection_limit = min((smaller_side_m * 1000) / 60, 30)
    required_ef = ((alpha * (float(design_pressure) / 1.5) * smaller_side_m**4) / deflection_limit) ** (1 / 3)

    return {
        "alpha": alpha,
        "ratio": ratio,
        "deflection_limit": deflection_limit,
        "required_ef": required_ef,
    }

def next_nominal_glass_thickness(required_total, is_composed):
    catalog = composed_nominal_thicknesses if is_composed else monolithic_nominal_thicknesses

    for thickness in catalog:
        if thickness >= required_total:
            return thickness

    return None

def find_best_insulated_monolithic_composition(required_resistance_er, required_deflection_ef, epsilon1, e3):
    candidates = []

    for first in monolithic_nominal_thicknesses:
        for second in monolithic_nominal_thicknesses:
            total = first + second
            equivalent_resistance = total / (0.9 * epsilon1 * e3)
            equivalent_deflection = total / epsilon1

            if equivalent_resistance >= required_resistance_er and equivalent_deflection >= required_deflection_ef:
                candidates.append({
                    "total": total,
                    "panes": [first, second],
                    "components": [
                        f"1 vidro float {first} mm",
                        "câmara a definir",
                        f"1 vidro float {second} mm",
                    ],
                    "equivalent_resistance": equivalent_resistance,
                    "equivalent_deflection": equivalent_deflection,
                })

    return min(candidates, key=lambda item: (item["total"], max(item["panes"]) - min(item["panes"]))) if candidates else None

def find_best_insulated_mixed_composition(required_resistance_er, required_deflection_ef, epsilon1, epsilon2, e3):
    candidates = []

    for monolithic in monolithic_nominal_thicknesses:
        for laminated_total in composed_nominal_thicknesses:
            total = monolithic + laminated_total
            equivalent_resistance = (monolithic + (laminated_total / (0.9 * epsilon2))) / (0.9 * epsilon1 * e3)
            equivalent_deflection = (monolithic + (laminated_total / epsilon2)) / epsilon1

            if equivalent_resistance >= required_resistance_er and equivalent_deflection >= required_deflection_ef:
                candidates.append({
                    "total": total,
                    "panes": [monolithic, laminated_total / 2, laminated_total / 2],
                    "components": [
                        f"1 vidro float {monolithic} mm",
                        "câmara a definir",
                        f"laminado {format(laminated_total / 2, 'g')} + {format(laminated_total / 2, 'g')} mm",
                    ],
                    "equivalent_resistance": equivalent_resistance,
                    "equivalent_deflection": equivalent_deflection,
                })

    return min(candidates, key=lambda item: (item["total"], item["panes"][0])) if candidates else None

def calculate_glass_result(width_mm, height_mm, wind_pressure, glass_type_key):
    glass_type = glass_types.get(glass_type_key, glass_types["monolitico_float"])
    calculation_pressure = float(wind_pressure) * 1.5
    base = calculate_glass_base_thickness(width_mm, height_mm, calculation_pressure)
    deflection = calculate_glass_deflection_requirement(
        base["smaller_side_m"],
        base["larger_side_m"],
        calculation_pressure,
    )
    reduction_factor = 1.0
    required_resistance_er = base["e1"] * reduction_factor
    e3 = glass_equivalence["monolithic"][glass_type["monolithic_factor"]]
    minimum_pane = glass_type.get("minimum_pane_thickness", 0)

    if glass_type["system"] == "monolithic":
        calculated_total = max(required_resistance_er * e3, deflection["required_ef"])
        required_total = max(calculated_total, minimum_pane)
        nominal_total = next_nominal_glass_thickness(required_total, False)
        checked_total = nominal_total or required_total
        panes = [checked_total]
        equivalent_resistance = checked_total / e3
        equivalent_deflection = checked_total
    elif glass_type["system"] == "laminated":
        epsilon2 = glass_equivalence["laminated"]["two_glasses"]
        required_sum_resistance = required_resistance_er * 0.9 * epsilon2 * e3
        required_sum_deflection = deflection["required_ef"] * epsilon2
        calculated_total = max(required_sum_resistance, required_sum_deflection)
        required_total = max(calculated_total, minimum_pane * 2)
        nominal_total = next_nominal_glass_thickness(required_total, True)
        checked_total = nominal_total or required_total
        pane = checked_total / 2
        panes = [pane, pane]
        equivalent_resistance = checked_total / (0.9 * epsilon2 * e3)
        equivalent_deflection = checked_total / epsilon2
    elif glass_type["system"] == "insulated":
        epsilon1 = glass_equivalence["insulated"]["two_glasses"]
        epsilon2 = glass_equivalence["laminated"]["two_glasses"]

        if glass_type.get("composition") == "monolithic_laminated":
            calculated_total = max(
                required_resistance_er * 0.9 * epsilon1 * e3,
                deflection["required_ef"] * epsilon1,
            )
            required_total = max(calculated_total, minimum_pane * 3)
            composition = find_best_insulated_mixed_composition(
                required_resistance_er,
                deflection["required_ef"],
                epsilon1,
                epsilon2,
                e3,
            )
        else:
            calculated_total = max(
                required_resistance_er * 0.9 * epsilon1 * e3,
                deflection["required_ef"] * epsilon1,
            )
            required_total = max(calculated_total, minimum_pane * 2)
            composition = find_best_insulated_monolithic_composition(
                required_resistance_er,
                deflection["required_ef"],
                epsilon1,
                e3,
            )

        nominal_total = composition["total"] if composition else None
        checked_total = nominal_total or required_total
        panes = composition["panes"] if composition else []
        components = composition["components"] if composition else ["Composição fora do catálogo atual"]
        equivalent_resistance = composition["equivalent_resistance"] if composition else required_resistance_er
        equivalent_deflection = composition["equivalent_deflection"] if composition else deflection["required_ef"]
    else:
        raise ValueError("Tipo de vidro não cadastrado")

    if glass_type["system"] != "insulated":
        components = [f"{glass_type['label']} {format(panes[0], 'g')} mm"] if len(panes) == 1 else [
            f"Vidro {format(pane, 'g')} mm" for pane in panes
        ]

    calculated_deflection = deflection["alpha"] * (calculation_pressure / 1.5) * base["smaller_side_m"]**4 / equivalent_deflection**3

    return {
        "tipo": glass_type["label"],
        "sistema": glass_type["system"],
        "espessura_calculada": calculated_total,
        "espessura_requerida": required_total,
        "espessura_minima": checked_total,
        "espessura_nominal": nominal_total,
        "fora_catalogo": nominal_total is None,
        "catalogo": composed_nominal_thicknesses if glass_type["system"] != "monolithic" else monolithic_nominal_thicknesses,
        "max_catalogo": max(monolithic_nominal_thicknesses) + max(composed_nominal_thicknesses)
        if glass_type["system"] == "insulated"
        else max(composed_nominal_thicknesses if glass_type["system"] != "monolithic" else monolithic_nominal_thicknesses),
        "vidros": panes,
        "componentes": components,
        "observacao_camera": "A espessura da câmara do vidro insulado não entra no cálculo." if glass_type["system"] == "insulated" else None,
        "largura_vidro": width_mm,
        "altura_vidro": height_mm,
        "pressao_vento": float(wind_pressure),
        "pressao": calculation_pressure,
        "fator_pressao_calculo": 1.5,
        "e1": base["e1"],
        "c": reduction_factor,
        "e3": e3,
        "eR": equivalent_resistance,
        "eF": equivalent_deflection,
        "alpha": deflection["alpha"],
        "flecha": calculated_deflection,
        "flecha_limite": deflection["deflection_limit"],
        "relacao_l_L": deflection["ratio"],
        "relacao_L_l": base["aspect_ratio"],
    }

def add_frame_result(response, data, pressao_ensaio):
    if all(key in data and data[key] for key in ("larguratotal", "quantidadefol", "alturafol")):
        larguratotal = float(data["larguratotal"])
        quantidadefol = int(data["quantidadefol"])
        alturafol = float(data["alturafol"])

        if larguratotal <= 0 or quantidadefol <= 0 or alturafol <= 0:
            raise ValueError("Dados da esquadria inválidos")

        alloy_name = data.get("liga", "6060-T5")
        alloy = alloy_properties.get(alloy_name)

        if not alloy:
            raise ValueError("Liga não cadastrada")

        lrt = alloy.get("lrt")
        melast = alloy.get("melast")

        if not lrt or not melast:
            raise ValueError("Propriedades da liga não cadastradas")

        largura_folha = largurafolha(larguratotal, quantidadefol)
        response.update({
            "wx": calcular_wx(pressao_ensaio, largura_folha, alturafol, lrt),
            "jx": calcular_jx(pressao_ensaio, largura_folha, alturafol, melast),
            "liga": {
                "nome": alloy_name,
                "lrt": lrt,
                "melast": melast,
                "densidade": alloy.get("densidade"),
            },
        })

    if data.get("calcular_vidro"):
        glass_width = float(data["largura_vidro"])
        glass_height = float(data["altura_vidro"])

        if glass_width <= 0 or glass_height <= 0:
            raise ValueError("Dimensões do vidro inválidas")

        glass_type = data.get("tipo_vidro", "monolitico_float")
        response["vidro"] = calculate_glass_result(glass_width, glass_height, pressao_ensaio, glass_type)

def encontrar_regiao(latitude, longitude):
    point = Point(longitude, latitude)

    for _, row in gdf.iterrows():
        if row['geometry'].contains(point):
            return row['pressão_vento']

    return None

@app.route('/regiaovento', methods=['POST'])
def get_wind_region():
    data = request.get_json()

    try:
        latitude = data['latitude']
        longitude = data['longitude']
    except KeyError as e:
        return jsonify({"error": f"Dados faltando: {e}"}), 400

    region = encontrar_regiao(latitude, longitude)

    if not region:
        return jsonify({"error": "Ponto fora de todas as regiões"}), 404

    return jsonify({
        "regiao": region,
        "v0": v0_map.get(region),
    })

@app.route('/nbr6123/s2', methods=['POST'])
def get_s2_preview():
    data = request.get_json()

    try:
        result = calculate_s2(data["categoria"], data["altura"])
        return jsonify(result)
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400

@app.route('/nbr6123/calcular', methods=['POST'])
def calculate_nbr6123():
    data = request.get_json()

    try:
        latitude = data["latitude"]
        longitude = data["longitude"]
        region = encontrar_regiao(latitude, longitude)

        if not region:
            return jsonify({"error": "Ponto fora de todas as regiões"}), 404

        v0 = v0_map.get(region)
        if not v0:
            return jsonify({"error": "V0 não definido para a região encontrada"}), 400

        s2_result = calculate_s2(data["s2_categoria"], data["s2_altura"])
        use_sealing_factor = bool(data.get("s3_vedacao"))
        s3_effective = get_effective_s3(data["s3"], use_sealing_factor)
        q = calculate_dynamic_pressure(v0, data["s1"], s2_result["value"], s3_effective)
        cp_result = calculate_cp_envelope(data["s2_largura_1"], data["s2_largura_2"], data["s2_altura"], q)
        pressao_ensaio = cp_result["test_pressure"]

        response = {
            "regiao": region,
            "v0": v0,
            "s1": float(data["s1"]),
            "s2": s2_result,
            "s3": {
                "base": float(data["s3"]),
                "effective": s3_effective,
                "sealing_factor_applied": use_sealing_factor,
            },
            "q": q,
            "cp": cp_result,
            "pressao_ensaio": pressao_ensaio,
        }

        add_frame_result(response, data, pressao_ensaio)

        return jsonify(response)
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400

@app.route('/pressaovento', methods=['POST'])
def get_wind_pressure():
    data = request.get_json()
    print(f"Dados recebidos: {data}")
    
    pressao_ensaio = None
    response = {}
    if 'pressao_personalizada' in data and data['pressao_personalizada']:
        try:
            pressao_ensaio = float(data['pressao_personalizada'])
        except (ValueError, TypeError):
            return jsonify({"error": "Valor de pressão personalizada inválido"}), 400
    else:
        try:
            latitude = data['latitude']
            longitude = data['longitude']
            pavimentos = int(data['pavimentos'])
        except (KeyError, ValueError) as e:
            return jsonify({"error": f"Dados faltando ou inválidos: {e}"}), 400

        region = encontrar_regiao(latitude, longitude)
        
        if not region:
            return jsonify({"error": "Ponto fora de todas as regiões"}), 404

        pressao_ensaio = calcular_pressao(region, pavimentos)

    # Se a pressão foi calculada ou fornecida, prossegue
    if pressao_ensaio is not None and isinstance(pressao_ensaio, (int, float)):
        response["pressao_ensaio"] = pressao_ensaio
        
        # Calcula Wx e Jx se os dados da esquadria estiverem presentes
        if ('larguratotal' in data and 'quantidadefol' in data and 'alturafol' in data) or data.get("calcular_vidro"):
            try:
                add_frame_result(response, data, pressao_ensaio)
            except (ValueError, TypeError):
                # Se os dados da esquadria forem inválidos, continua sem wx e jx
                pass
        
        return jsonify(response)

    return jsonify({"error": "Não foi possível determinar a pressão de ensaio"}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Rota pro UptimeRobot"""
    return "Online!", 200
