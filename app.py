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
                larguratotal = float(data['larguratotal'])
                quantidadefol = int(data['quantidadefol'])
                alturafol = float(data['alturafol'])
                lrt = 150  # N/mm²
                melast = 70000  # MPa

                largura_folha = largurafolha(larguratotal, quantidadefol)
                wx = calcular_wx(pressao_ensaio, largura_folha, alturafol, lrt)
                jx = calcular_jx(pressao_ensaio, largura_folha, alturafol, melast)

                response.update({"wx": wx, "jx": jx})
            except (ValueError, TypeError):
                # Se os dados da esquadria forem inválidos, continua sem wx e jx
                pass
        
        return jsonify(response)

    return jsonify({"error": "Não foi possível determinar a pressão de ensaio"}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Rota pro UptimeRobot"""
    return "Online!", 200

