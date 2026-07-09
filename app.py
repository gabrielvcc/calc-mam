from flask import Flask, request, jsonify
from flask_cors import CORS
import geopandas as gpd
from shapely.geometry import Point
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

def add_frame_result(response, data, pressao_ensaio):
    if not all(key in data and data[key] for key in ("larguratotal", "quantidadefol", "alturafol")):
        return

    larguratotal = float(data["larguratotal"])
    quantidadefol = int(data["quantidadefol"])
    alturafol = float(data["alturafol"])

    if larguratotal <= 0 or quantidadefol <= 0 or alturafol <= 0:
        raise ValueError("Dados da esquadria inválidos")

    lrt = 150
    melast = 70000

    largura_folha = largurafolha(larguratotal, quantidadefol)
    response.update({
        "wx": calcular_wx(pressao_ensaio, largura_folha, alturafol, lrt),
        "jx": calcular_jx(pressao_ensaio, largura_folha, alturafol, melast),
    })

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
        q = calculate_dynamic_pressure(v0, data["s1"], s2_result["value"], data["s3"])
        cp_result = calculate_cp_envelope(data["s2_largura_1"], data["s2_largura_2"], data["s2_altura"], q)
        pressao_ensaio = cp_result["test_pressure"]

        response = {
            "regiao": region,
            "v0": v0,
            "s1": float(data["s1"]),
            "s2": s2_result,
            "s3": float(data["s3"]),
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
        if 'larguratotal' in data and 'quantidadefol' in data and 'alturafol' in data:
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

