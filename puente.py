"""
puente.py
=========
El PUENTE de la versión web estática (GitHub Pages). Reemplaza a servidor.py.

En la versión con servidor, el navegador le mandaba mensajes HTTP a servidor.py.
Aquí NO hay servidor: Python corre DENTRO del navegador (gracias a Pyodide) y
app.js llama directamente a la función `atender()` de este archivo.

Se conserva el mismo formato de mensajes (JSON) que usaba el servidor, así la
interfaz casi no cambia:

    app.js ──► atender("/api/calcular", "POST", '{"a":"101","b":"11",...}')
           ◄── '{"ok": true, "resultado": {...}}'

La lógica real sigue estando en logica_binaria.py y conversion_texto.py,
sin ningún cambio.
"""

import json
from dataclasses import asdict

from conversion_texto import MAX_CARACTERES, convertir, tabla_ascii
from logica_binaria import MAX_BITS, OPERACIONES, ErrorBinario, calcular

# Campos que se envían como TEXTO para no perder precisión en JavaScript (>2^53).
CAMPOS_DECIMALES = ("a_dec", "b_dec", "res_dec", "residuo_dec")


def _error(tipo: str, mensaje: str) -> dict:
    return {"ok": False, "error": {"tipo": tipo, "mensaje": mensaje}}


def _operaciones() -> dict:
    return {
        "operaciones": [
            {"clave": clave, "nombre": nombre, "simbolo": simbolo}
            for clave, (nombre, simbolo) in OPERACIONES.items()
        ],
        "max_bits": MAX_BITS,
        "max_caracteres": MAX_CARACTERES,
    }


def _calcular(datos: dict) -> dict:
    operacion = datos.get("operacion")
    if not isinstance(operacion, str):
        return _error("PeticionInvalida", "Falta el campo 'operacion'.")
    resultado = asdict(calcular(datos.get("a"), datos.get("b"), operacion))
    for campo in CAMPOS_DECIMALES:
        if resultado[campo] is not None:
            resultado[campo] = str(resultado[campo])
    return {"ok": True, "resultado": resultado}


def _convertir(datos: dict) -> dict:
    modo = datos.get("modo")
    if not isinstance(modo, str):
        return _error("PeticionInvalida", "Falta el campo 'modo'.")
    return {"ok": True, "conversion": asdict(convertir(modo, datos.get("texto")))}


def atender(ruta: str, metodo: str, cuerpo: str) -> str:
    """Punto de entrada: recibe la "petición" y devuelve la respuesta como texto JSON."""
    try:
        if metodo == "GET" and ruta == "/api/operaciones":
            respuesta = _operaciones()
        elif metodo == "GET" and ruta == "/api/tabla-ascii":
            respuesta = {"grupos": tabla_ascii()}
        elif metodo == "POST" and ruta in ("/api/calcular", "/api/convertir"):
            try:
                datos = json.loads(cuerpo)
            except (TypeError, json.JSONDecodeError):
                datos = None
            if not isinstance(datos, dict):
                respuesta = _error("PeticionInvalida", "Se esperaba un objeto JSON.")
            elif ruta == "/api/calcular":
                respuesta = _calcular(datos)
            else:
                respuesta = _convertir(datos)
        else:
            respuesta = _error("NoEncontrado", f"La ruta {ruta} no existe.")
    except ErrorBinario as e:               # error esperado (entrada inválida, ÷0...)
        respuesta = _error(type(e).__name__, str(e))
    except Exception:                       # noqa: BLE001  (bug inesperado)
        respuesta = _error("ErrorServidor", "Ocurrió un error interno.")
    return json.dumps(respuesta, ensure_ascii=False)
