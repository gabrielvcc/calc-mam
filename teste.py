import rasterio
from rasterio.windows import Window
from rasterio.windows import transform as window_transform
from pyproj import Transformer
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
# ======================================================
# CONFIGURAÇÕES
# ======================================================
arquivo = "morretes_dem.tiff"
lat = -25.466569
lon = -48.920446
raio_analise = 2000     # metros
passo = 30              # metros
# ======================================================
# COORDENADAS
# ======================================================
transformer = Transformer.from_crs(
    "EPSG:4326",
    "EPSG:32722",
    always_xy=True
)
x,y = transformer.transform(
    lon,
    lat
)
print("\nCOORDENADA UTM")
print(x)
print(y)
# ======================================================
# ABRIR DEM
# ======================================================
with rasterio.open(arquivo) as dem:
    print("\nINFORMAÇÕES DEM")
    print("CRS:", dem.crs)
    print("Resolução:", dem.res)
    print("Tamanho:", dem.width, "x", dem.height)
    # Localiza exatamente o pixel da coordenada
    col, row = dem.index(x, y)
    print("\nPIXEL ORIGINAL")
    print(col, row)
    # Altitude exata usando interpolação do Rasterio
    altitude_original = next(dem.sample([(x, y)]))[0]
    print("\nALTITUDE DIRETA DEM")
    print(round(float(altitude_original), 2), "m")
    # Lê o raster inteiro
    relevo = dem.read(1).astype(float)
    # Trata NoData
    if dem.nodata is not None:
        relevo[relevo == dem.nodata] = np.nan
    # Guarda a posição do ponto
    centro_col = col
    centro_row = row
    # Resolução do raster (m/pixel)
    pixel_x = abs(dem.res[0])
    pixel_y = abs(dem.res[1])
# ======================================================
# VALIDAÇÃO
# ======================================================
alt_recorte = relevo[
    centro_col,
    centro_row
]
print("\nALTITUDE RECORTE")
print(
    round(float(alt_recorte),2),
    "m"
)
if abs(
    altitude_original-alt_recorte
) > 5:
    print("\nERRO: DEM NÃO COINCIDE")
    exit()
alt_ponto = float(
    alt_recorte
)
# ======================================================
# LIMPEZA
# ======================================================
relevo = relevo.astype(float)
relevo[
    relevo < -100
]=np.nan
# ======================================================
# DIREÇÕES
# ======================================================
direcoes={
"N":90,
"NE":45,
"E":0,
"SE":-45,
"S":-90,
"SW":-135,
"W":180,
"NW":135,
"NNE":67.5,
"ENE":22.5,
"ESE":-22.5,
"SSE":-67.5,
"SSW":-112.5,
"WSW":-157.5,
"WNW":157.5,
"NNW":112.5
}
# ======================================================
# PERFIL RADIAL
# ======================================================
def perfil_direcao(angulo):
    dados = []
    rad = np.radians(angulo)
    dx = np.cos(rad)
    # Raster cresce para baixo
    dy = -np.sin(rad)
    distancia = 0
    while distancia <= raio_analise:
        px = int(round(
            centro_col +
            dx * (distancia / pixel_x)
        ))
        py = int(round(
            centro_row +
            dy * (distancia / pixel_y)
        ))
        if (
            0 <= px < relevo.shape[1] and
            0 <= py < relevo.shape[0]
        ):
            altitude = relevo[py, px]
            if not np.isnan(altitude):
                dados.append([
                    distancia,
                    float(altitude)
                ])
        distancia += passo
    return pd.DataFrame(
        dados,
        columns=[
            "distancia",
            "altitude"
        ]
    )
# ======================================================
# ANALISAR PERFIS
# ======================================================
perfis={}
subidas={}
print("\n====================")
print("PERFIS")
print("====================")
for nome,angulo in direcoes.items():
    df=perfil_direcao(
        angulo
    )
    df["dif"] = (
        df.altitude-alt_ponto
    )
    perfis[nome]=df
    subidas[nome]=df.dif.max()
    print(
        nome,
        "Subida:",
        round(float(subidas[nome]),2)
    )
direcao=max(
    subidas,
    key=subidas.get
)
perfil=perfis[direcao]
print("\n====================")
print("DIREÇÃO DOMINANTE")
print("====================")
print(direcao)
print(
    "Subida:",
    round(float(subidas[direcao]),2),
    "m"
)
# ======================================================
# ANÁLISE DE ANÉIS
# ======================================================
print("\n====================")
print("ANÉIS")
print("====================")
for raio in [100,250,500,1000,2000]:
    valores=[]
    for nome,df in perfis.items():
        valores.extend(
            df[
                df.distancia<=raio
            ].altitude.tolist()
        )
    print(
        raio,
        "m:",
        round(np.mean(valores),2),
        "média |",
        round(np.max(valores),2),
        "máx"
    )
# ======================================================
# GEOMETRIA DO MORRO
# ======================================================
perfil["inclinacao"] = np.degrees(
    np.arctan(
        perfil.altitude.diff()
        /
        perfil.distancia.diff()
    )
)
subida = perfil[
    perfil.inclinacao > 2
]
print("\n====================")
print("CLASSIFICAÇÃO NBR 6123")
print("====================")
if len(subida) < 3:
    print(
        "OPÇÃO A"
    )
    print(
        "Terreno plano ou fracamente acidentado"
    )
    print(
        "S1 = 1,00"
    )
else:
    base=subida.iloc[0]
    topo=subida.iloc[-1]
    dt=(
        topo.altitude-base.altitude
    )
    distancia=(
        topo.distancia-base.distancia
    )
    theta=np.degrees(
        np.arctan(
            dt/distancia
        )
    )
    print(
        "OPÇÃO B - TALUDE OU MORRO"
    )
    print(
        "Direção:",
        direcao
    )
    print(
        "dt:",
        round(float(dt),2),
        "m"
    )
    print(
        "theta:",
        round(float(theta),2),
        "graus"
    )
    if theta <=3:
        print(
            "Posição A/C"
        )
        print(
            "S1 = 1,00"
        )
    else:
        print(
            "Posição B - Encosta"
        )
        print(
            "Necessário aplicar fórmula S1(z)"
        )
# ======================================================
# GRÁFICO PERFIL
# ======================================================
plt.figure(
    figsize=(12,5)
)
plt.plot(
    perfil.distancia,
    perfil.altitude,
    marker="o"
)
plt.title(
    "Perfil dominante - "+direcao
)
plt.xlabel(
    "Distância (m)"
)
plt.ylabel(
    "Altitude (m)"
)
plt.grid()
plt.show()
# ======================================================
# MAPA
# ======================================================
plt.figure(
    figsize=(8,8)
)
plt.imshow(
    relevo,
    cmap="terrain"
)
plt.scatter(
    centro_col,
    centro_row,
    marker="x",
    s=150
)
plt.title(
    "Área analisada DEM"
)
plt.colorbar(
    label="Altitude"
)
plt.show()