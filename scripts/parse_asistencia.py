#!/usr/bin/env python3
"""
Lector robusto de la planilla de asistencia de relojes biometricos.

Estructura del reporte (matricial, por bloques):

    Fila 0 ....... Titulo: "Reporte de Eventos de Asistencia"
    Fila 2 ....... Periodo: Col. C -> "2026-08-01 ~ 2026-08-31"
    Fila 3 ....... Cabecera de dias del mes (1, 2, 3, ... 31), una columna por dia
    Fila 4 ....... "ID:" (col 0) | <ID> (col 2) | "Nombre:" (col 8) | <nombre> (col 10)
                   | "Departamento:" (col 18) | <valor> (col 20)
    Fila 5 ....... Marcaciones alineadas a los dias de la fila de cabecera
    Fila 6, 7 .... Se repite el patron (un par de filas por funcionario)

El parser NO depende de posiciones fijas: detecta la fila de dias, deduce el
desplazamiento de las columnas, busca las etiquetas ID/Nombre/Departamento en
cualquier columna y toma el primer valor no vacio a la derecha. Asi sobrevive a
cambios de version del reloj, a la paginacion que repite encabezados y a bloques
con filas intermedias.

Uso:
    python scripts/parse_asistencia.py planilla.xlsx
    python scripts/parse_asistencia.py planilla.xlsx --hoja 0 --out-dir salida --json
    python scripts/parse_asistencia.py planilla.xlsx --mes 2026-08 --incluir-vacios

Salidas (por defecto en ./salida):
    asistencia_largo.csv  -> ID;NOMBRE;DEPARTAMENTO;FECHA;DIA;ENTRADA;SALIDA;MARCADAS
    asistencia_matriz.csv -> ID;NOMBRE;DEPARTAMENTO;DIA_01..DIA_31
    asistencia.json       -> solo con --json (listo para el motor de calculo)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import pandas as pd

# ---------------------------- Configuracion ----------------------------

MIN_DIAS_ENCABEZADO = 5  # dias 1..31 minimos para aceptar una fila como cabecera
MAX_FILAS_CABECERA = 20  # rango donde se busca la cabecera de dias y el periodo

CAMPOS_TEMPRANOS = ("DEPARTAMENTO", "DEPTO", "AREA", "SECCION", "CARGO", "PUESTO")

PATRON_PERIODO = re.compile(
    r"(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:~|-|a|to|hasta)\s*(\d{4})-(\d{1,2})-(\d{1,2})",
    re.IGNORECASE,
)
PATRON_PERIODO_DMA = re.compile(
    r"(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\s*(?:~|-|a|to|hasta)\s*(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})",
    re.IGNORECASE,
)
PATRON_HORA = re.compile(r"(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?", re.IGNORECASE)
PATRON_TITULO = re.compile(r"reporte\s+de\s+eventos|eventos\s+de\s+asistencia", re.IGNORECASE)


# ---------------------------- Utilidades ----------------------------


def es_vacio(valor) -> bool:
    """True para None, NaN, NaT, NA y cadenas en blanco."""
    if valor is None:
        return True
    try:
        if pd.isna(valor):
            return True
    except (TypeError, ValueError):
        pass
    return isinstance(valor, str) and not valor.strip()


def texto(valor) -> str:
    """Texto limpio; evita que un ID numerico termine como '1234.0'."""
    if es_vacio(valor):
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def etiqueta_y_valor(valor, campos: tuple[str, ...]) -> tuple[bool, str]:
    """
    Detecta etiquetas como 'ID:', 'Nombre:' o 'Departamento:'.

    Devuelve (es_etiqueta, valor_en_la_misma_celda). Exige dos puntos cuando la
    celda trae valor, para no confundir textos como "Nombre del empleado" con la
    etiqueta "Nombre:".
    """
    if es_vacio(valor):
        return False, ""

    contenido = str(valor).strip()
    patron = re.compile(
        rf"^({'|'.join(campos)})(?:\s+(?:Y\s+APELLIDO|COMPLETO|DEL?\s+\w+))?\s*:?\s*(.*)$",
        re.IGNORECASE,
    )
    coincidencia = patron.match(contenido)
    if not coincidencia:
        return False, ""

    resto = coincidencia.group(2).strip()
    if ":" not in contenido and resto:
        return False, ""
    return True, resto


def buscar_campo(fila: list, campos: tuple[str, ...], offset_preferido: int = 2) -> tuple[str, int | None]:
    """
    Busca una etiqueta en la fila y devuelve (valor, columna_de_la_etiqueta).

    Si la celda trae el valor ('ID: 1234') se usa ese. Si solo trae la etiqueta
    ('ID:') se prioriza el valor que esta `offset_preferido` columnas a la derecha
    (en el reporte del reloj el ID esta en la col 2 con la etiqueta en la 0, y el
    nombre en la 10 con la etiqueta en la 8) y, si ahi no hay nada, se toma el
    primer valor no vacio a la derecha.
    """
    for columna, valor in enumerate(fila):
        es_etiqueta, valor_en_linea = etiqueta_y_valor(valor, campos)
        if not es_etiqueta:
            continue

        if valor_en_linea:
            return valor_en_linea, columna

        candidato = columna + offset_preferido
        if candidato < len(fila) and not es_vacio(fila[candidato]):
            return texto(fila[candidato]), candidato

        for siguiente in range(columna + 1, len(fila)):
            if not es_vacio(fila[siguiente]):
                return texto(fila[siguiente]), siguiente
        return "", columna

    return "", None


def extraer_horas(valor) -> list[str]:
    """
    Extrae todas las marcas horarias de una celda, en formato HH:MM.

    Soporta celdas de hora reales (datetime/time de Excel), seriales numericos,
    textos con una marca ('08:00') y con varias ('08:00 12:30 18:05', incluso
    separadas por saltos de linea).
    """
    if es_vacio(valor):
        return []

    if isinstance(valor, dt.datetime):
        return [f"{valor.hour:02d}:{valor.minute:02d}"]
    if isinstance(valor, dt.time):
        return [f"{valor.hour:02d}:{valor.minute:02d}"]

    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        total = round((float(valor) % 1) * 24 * 60)
        return [f"{total // 60:02d}:{total % 60:02d}"] if 0 < total < 1440 else []

    horas: list[str] = []
    for coincidencia in PATRON_HORA.finditer(str(valor)):
        hora = int(coincidencia.group(1))
        minuto = int(coincidencia.group(2))
        sufijo = (coincidencia.group(4) or "").lower().replace(".", "").replace(" ", "")
        if hora > 23 or minuto > 59:
            continue
        if sufijo.startswith("p") and hora < 12:
            hora += 12
        if sufijo.startswith("a") and hora == 12:
            hora = 0
        marca = f"{hora:02d}:{minuto:02d}"
        if marca not in horas:
            horas.append(marca)
    return horas


def dia_de_celda(valor) -> int | None:
    """Devuelve el dia del mes (1-31) que representa una celda de la cabecera."""
    if es_vacio(valor):
        return None

    if isinstance(valor, (dt.datetime, dt.date)):
        return valor.day

    contenido = str(valor).strip()
    if ":" in contenido:  # una hora nunca es un dia
        return None

    coincidencia = re.search(r"\d{4}-(\d{1,2})-(\d{1,2})", contenido)
    if coincidencia:
        return int(coincidencia.group(2))

    coincidencia = re.search(r"(\d{1,2})[/.\-](\d{1,2})(?:[/.\-]\d{2,4})?\s*$", contenido)
    if coincidencia:
        dia = int(coincidencia.group(1))
        return dia if 1 <= dia <= 31 else None

    coincidencia = re.fullmatch(r"\D*(\d{1,2})\D*", contenido)
    if coincidencia:
        dia = int(coincidencia.group(1))
        if 1 <= dia <= 31:
            return dia
    return None


def mapa_de_dias(fila: list) -> dict[int, int]:
    """Mapea {dia: columna} a partir de una fila con numeros del 1 al 31."""
    mapa: dict[int, int] = {}
    for columna, valor in enumerate(fila):
        dia = dia_de_celda(valor)
        if dia is not None and dia not in mapa:
            mapa[dia] = columna
    return mapa


def es_fila_cabecera(fila: list) -> bool:
    """True si la fila parece la cabecera de dias del mes."""
    return len(mapa_de_dias(fila)) >= MIN_DIAS_ENCABEZADO


def detectar_cabecera_dias(grilla: list[list], limite: int = MAX_FILAS_CABECERA):
    """
    Busca la fila de cabecera de dias y devuelve (indice_de_fila, {dia: columna}).

    Se queda con la fila que tenga mas dias reconocidos dentro de las primeras
    `limite` filas, asi que funciona tanto si los dias empiezan en la columna 0
    como si empiezan corridos por las columnas de encabezado del reporte.
    """
    mejor: tuple[int, dict[int, int]] | None = None

    for fila in range(min(limite, len(grilla))):
        mapa = mapa_de_dias(grilla[fila])
        if len(mapa) >= MIN_DIAS_ENCABEZADO and (mejor is None or len(mapa) > len(mejor[1])):
            mejor = (fila, mapa)

    return mejor


def detectar_periodo(grilla: list[list], fila_limite: int):
    """
    Busca el periodo ('2026-08-01 ~ 2026-08-31') en las filas del encabezado.

    Devuelve {desde, hasta, anio, mes} o None. Acepta tambien el formato
    '01/08/2026 ~ 31/08/2026'.
    """
    for fila in range(min(fila_limite + 1, len(grilla))):
        for valor in grilla[fila]:
            if es_vacio(valor):
                continue

            contenido = str(valor)
            coincidencia = PATRON_PERIODO.search(contenido)
            if coincidencia:
                anio, mes, dia = int(coincidencia.group(1)), int(coincidencia.group(2)), int(coincidencia.group(3))
                anio2, mes2, dia2 = int(coincidencia.group(4)), int(coincidencia.group(5)), int(coincidencia.group(6))
                return {
                    "desde": f"{anio:04d}-{mes:02d}-{dia:02d}",
                    "hasta": f"{anio2:04d}-{mes2:02d}-{dia2:02d}",
                    "anio": anio,
                    "mes": mes,
                }

            coincidencia = PATRON_PERIODO_DMA.search(contenido)
            if coincidencia:
                anio = int(coincidencia.group(3))
                anio = anio + 2000 if anio < 100 else anio
                anio2 = int(coincidencia.group(6))
                anio2 = anio2 + 2000 if anio2 < 100 else anio2
                mes = int(coincidencia.group(2))
                return {
                    "desde": f"{anio:04d}-{mes:02d}-{int(coincidencia.group(1)):02d}",
                    "hasta": f"{anio2:04d}-{int(coincidencia.group(5)):02d}-{int(coincidencia.group(4)):02d}",
                    "anio": anio,
                    "mes": mes,
                }

    return None


# ---------------------------- Recorrido por bloques ----------------------------


def fila_vacia(fila: list) -> bool:
    return all(es_vacio(valor) for valor in fila)


def parsear_reporte(grilla: list[list], anio_mes: tuple[int, int] | None = None):
    """
    Recorre el reporte y devuelve (funcionarios, periodo, mapa_dias, avisos).

    Cada funcionario queda como:
        {id, nombre, departamento, marcas: {dia: [HH:MM, ...]}, fila}
    """
    cabecera = detectar_cabecera_dias(grilla)
    if cabecera is None:
        raise ValueError(
            "No se encontro la fila con los dias del mes (1..31). Verifica que el archivo "
            "sea el reporte de eventos de asistencia del reloj."
        )

    fila_dias, mapa_dias = cabecera
    avisos: list[str] = []
    periodo = detectar_periodo(grilla, fila_dias)

    if periodo is None and anio_mes is None:
        raise ValueError(
            "No se pudo detectar el periodo ('YYYY-MM-DD ~ YYYY-MM-DD') en el encabezado. "
            "Indicalo con --mes YYYY-MM (por ejemplo --mes 2026-08)."
        )
    if periodo is None:
        periodo = {"desde": None, "hasta": None, "anio": anio_mes[0], "mes": anio_mes[1]}
        avisos.append(f"Periodo no detectado: se uso --mes {anio_mes[0]}-{anio_mes[1]:02d}.")
    elif anio_mes:
        periodo = {**periodo, "anio": anio_mes[0], "mes": anio_mes[1]}

    funcionarios: list[dict] = []
    por_id: dict[str, dict] = {}

    fila = fila_dias + 1
    while fila < len(grilla):
        actual = grilla[fila]

        if fila_vacia(actual):
            fila += 1
            continue
        if es_fila_cabecera(actual):
            avisos.append(f"Fila {fila + 1}: encabezado de dias repetido (paginacion), se omite.")
            fila += 1
            continue
        if any(PATRON_TITULO.search(str(valor)) for valor in actual if not es_vacio(valor)):
            avisos.append(f"Fila {fila + 1}: titulo del reporte repetido (paginacion), se omite.")
            fila += 1
            continue

        valor_id, _ = buscar_campo(actual, ("ID",))
        if not valor_id:
            fila += 1
            continue

        nombre, _ = buscar_campo(actual, ("NOMBRE",))
        departamento, _ = buscar_campo(actual, CAMPOS_TEMPRANOS)

        # La fila de marcaciones es la inmediatamente posterior; puede estar vacia
        # (funcionario sin marcaciones) o no existir (bloque incompleto).
        siguiente = fila + 1
        fila_siguiente = grilla[siguiente] if siguiente < len(grilla) else None
        siguiente_es_otro_bloque = fila_siguiente is not None and (
            es_fila_cabecera(fila_siguiente) or bool(buscar_campo(fila_siguiente, ("ID",))[0])
        )
        tiene_marcas = fila_siguiente is not None and not siguiente_es_otro_bloque

        marcas: dict[int, list[str]] = {}
        if tiene_marcas:
            for dia, columna in mapa_dias.items():
                if columna >= len(grilla[siguiente]):
                    continue
                horas = extraer_horas(grilla[siguiente][columna])
                if horas:
                    marcas[dia] = horas
        else:
            avisos.append(f"Fila {fila + 1}: ID {valor_id} sin fila de marcaciones.")

        if valor_id in por_id:
            existente = por_id[valor_id]
            avisos.append(f"ID {valor_id} repetido ('{existente['nombre']}' / '{nombre}'): se fusionan los dias.")
            existente["marcas"].update(marcas)
            if not existente["nombre"] and nombre:
                existente["nombre"] = nombre
        else:
            registro = {"id": valor_id, "nombre": nombre, "departamento": departamento, "marcas": marcas, "fila": fila + 1}
            por_id[valor_id] = registro
            funcionarios.append(registro)

        fila = siguiente + 1 if tiene_marcas else fila + 1

    if not funcionarios:
        avisos.append("No se encontro ninguna fila de funcionario (etiqueta 'ID:').")

    return funcionarios, periodo, mapa_dias, avisos


# ---------------------------- Salidas ----------------------------

COLUMNAS_LARGO = ["ID", "NOMBRE", "DEPARTAMENTO", "FECHA", "DIA", "ENTRADA", "SALIDA", "MARCADAS"]


def dias_del_mes(anio: int, mes: int) -> int:
    """Cantidad de dias del mes (sin depender del modulo calendar)."""
    primero_siguiente = dt.date(anio + (mes // 12), (mes % 12) + 1, 1)
    return (primero_siguiente - dt.timedelta(days=1)).day


def a_largo(funcionarios: list[dict], periodo: dict, incluir_vacios: bool = False) -> pd.DataFrame:
    """
    Formato largo: una fila por funcionario y dia.

    Es el formato que consume el importador web (columnas ID/NOMBRE/FECHA/
    ENTRADA/SALIDA). Con `incluir_vacios` se agregan los dias sin marcacion con
    las horas en blanco, util para revisar la planilla completa.
    """
    anio, mes = periodo["anio"], periodo["mes"]
    filas: list[dict] = []

    for funcionario in funcionarios:
        dias = range(1, dias_del_mes(anio, mes) + 1) if incluir_vacios else sorted(funcionario["marcas"])
        for dia in dias:
            horas = funcionario["marcas"].get(dia, [])
            filas.append(
                {
                    "ID": funcionario["id"],
                    "NOMBRE": funcionario["nombre"],
                    "DEPARTAMENTO": funcionario["departamento"],
                    "FECHA": f"{anio:04d}-{mes:02d}-{dia:02d}",
                    "DIA": dia,
                    "ENTRADA": horas[0] if horas else "",
                    "SALIDA": horas[-1] if len(horas) > 1 else "",
                    "MARCADAS": " ".join(horas),
                }
            )

    return pd.DataFrame(filas, columns=COLUMNAS_LARGO)


def a_matriz(funcionarios: list[dict], mapa_dias: dict[int, int], periodo: dict) -> pd.DataFrame:
    """Formato matriz (igual al reporte): una fila por funcionario, una columna por dia."""
    dias = sorted(mapa_dias) if mapa_dias else list(range(1, dias_del_mes(periodo["anio"], periodo["mes"]) + 1))
    columnas = ["ID", "NOMBRE", "DEPARTAMENTO", *[f"DIA_{dia:02d}" for dia in dias]]

    filas = []
    for funcionario in funcionarios:
        fila = {"ID": funcionario["id"], "NOMBRE": funcionario["nombre"], "DEPARTAMENTO": funcionario["departamento"]}
        for dia in dias:
            fila[f"DIA_{dia:02d}"] = " ".join(funcionario["marcas"].get(dia, []))
        filas.append(fila)

    return pd.DataFrame(filas, columns=columnas)


def a_json(funcionarios: list[dict], periodo: dict) -> dict:
    """Estructura lista para el motor de calculo (identica al importador web)."""
    anio, mes = periodo["anio"], periodo["mes"]
    registros = [
        {
            "biometricId": funcionario["id"],
            "nombre": funcionario["nombre"],
            "fecha": f"{anio:04d}-{mes:02d}-{dia:02d}",
            "entrada": horas[0],
            "salida": horas[-1] if len(horas) > 1 else None,
            "marcas": horas,
        }
        for funcionario in funcionarios
        for dia, horas in sorted(funcionario["marcas"].items())
    ]

    return {
        "periodo": periodo,
        "funcionarios": [
            {
                "id": funcionario["id"],
                "nombre": funcionario["nombre"],
                "departamento": funcionario["departamento"],
                "diasConMarcacion": len(funcionario["marcas"]),
            }
            for funcionario in funcionarios
        ],
        "registros": registros,
    }


# ---------------------------- CLI ----------------------------


def leer_grilla(ruta: Path, hoja) -> list[list]:
    """Lee la hoja completa como grilla (lista de listas) sin asumir encabezados."""
    if not ruta.exists():
        raise SystemExit(f"No existe el archivo: {ruta}")

    try:
        marco = pd.read_excel(ruta, sheet_name=hoja, header=None, dtype=object)
    except ImportError as error:  # motor de lectura faltante (.xls necesita xlrd)
        raise SystemExit(f"Falta el motor de lectura para '{ruta.suffix}'. Para .xls: pip install xlrd") from error

    # Una hoja seleccionada por nombre/indice puede devolver un dict.
    if isinstance(marco, dict):
        marco = next(iter(marco.values()))

    return marco.to_numpy(dtype=object).tolist()


def imprimir_resumen(funcionarios, periodo, mapa_dias, largo, avisos, out_dir: Path, con_json: bool) -> None:
    rango = f"{periodo['desde']} ~ {periodo['hasta']}" if periodo["desde"] else f"{periodo['anio']:04d}-{periodo['mes']:02d}"
    columnas_dias = f"{min(mapa_dias)}..{max(mapa_dias)}" if mapa_dias else "-"

    print("Lectura OK")
    print(f"  Periodo        : {rango}")
    print(f"  Dias detectados: {len(mapa_dias)} (numeros {columnas_dias})")
    print(f"  Funcionarios   : {len(funcionarios)}")
    print(f"  Filas ID/dia   : {len(largo)}")
    print("")
    print(f"{'ID':<14} | {'DIAS':>4} | NOMBRE")
    print("-" * 72)
    for funcionario in funcionarios:
        print(f"{funcionario['id'][:14]:<14} | {len(funcionario['marcas']):>4} | {funcionario['nombre']}")

    sin_marcas = [funcionario for funcionario in funcionarios if not funcionario["marcas"]]
    if sin_marcas:
        print(f"\nATENCION: {len(sin_marcas)} funcionario(s) sin ninguna marcacion en el periodo.")

    if avisos:
        print("\nAvisos:")
        for aviso in avisos[:20]:
            print(f"  - {aviso}")
        if len(avisos) > 20:
            print(f"  ... y {len(avisos) - 20} aviso(s) mas")

    print(f"\nSalidas en '{out_dir}': asistencia_largo.csv, asistencia_matriz.csv" + (", asistencia.json" if con_json else ""))


def main(argv=None) -> int:
    analizador = argparse.ArgumentParser(
        description="Lee el reporte de asistencia del reloj biometrico (matriz por bloques con ID/Nombre/marcaciones)."
    )
    analizador.add_argument("archivo", type=Path, help="Ruta del Excel del reloj (.xlsx)")
    analizador.add_argument("--hoja", default="0", help="Nombre o indice de la hoja (por defecto la primera)")
    analizador.add_argument("--out-dir", type=Path, default=Path("salida"), help="Carpeta de salida (por defecto ./salida)")
    analizador.add_argument("--mes", help="Periodo a usar si el archivo no lo trae: YYYY-MM")
    analizador.add_argument("--json", action="store_true", help="Genera ademas asistencia.json")
    analizador.add_argument("--incluir-vacios", action="store_true", help="Incluye tambien los dias sin marcacion")
    analizador.add_argument("--quiet", action="store_true", help="No imprime el resumen")
    argumentos = analizador.parse_args(argv)

    anio_mes = None
    if argumentos.mes:
        coincidencia = re.fullmatch(r"(\d{4})-(\d{1,2})", argumentos.mes.strip())
        if not coincidencia:
            print("--mes debe tener el formato YYYY-MM (ej. 2026-08)", file=sys.stderr)
            return 2
        anio_mes = (int(coincidencia.group(1)), int(coincidencia.group(2)))

    hoja = int(argumentos.hoja) if str(argumentos.hoja).isdigit() else argumentos.hoja

    grilla = leer_grilla(argumentos.archivo, hoja)
    funcionarios, periodo, mapa_dias, avisos = parsear_reporte(grilla, anio_mes)

    largo = a_largo(funcionarios, periodo, argumentos.incluir_vacios)
    matriz = a_matriz(funcionarios, mapa_dias, periodo)

    argumentos.out_dir.mkdir(parents=True, exist_ok=True)
    largo.to_csv(argumentos.out_dir / "asistencia_largo.csv", index=False, sep=";", encoding="utf-8-sig")
    matriz.to_csv(argumentos.out_dir / "asistencia_matriz.csv", index=False, sep=";", encoding="utf-8-sig")

    if argumentos.json:
        contenido = json.dumps(a_json(funcionarios, periodo), ensure_ascii=False, indent=2)
        (argumentos.out_dir / "asistencia.json").write_text(contenido, encoding="utf-8")

    if not argumentos.quiet:
        imprimir_resumen(funcionarios, periodo, mapa_dias, largo, avisos, argumentos.out_dir, argumentos.json)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
