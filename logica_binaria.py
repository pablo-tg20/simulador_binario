"""
logica_binaria.py
=================
LÓGICA del simulador de aritmética binaria (NO contiene nada de interfaz).

Idea central: las operaciones se hacen "a mano", bit por bit, igual que
lo haría una ALU (la parte de un procesador que calcula). Por eso NO usamos
los operadores +, -, *, // de Python sobre los números completos; solo se usan
sobre bits individuales (0 o 1). Así puedes ver cómo funciona cada operación.

Los números binarios se manejan como TEXTO (str), por ejemplo "1011".

Contenido:
    1. Excepciones propias
    2. Utilidades (validar, normalizar, comparar)
    3. Las 4 operaciones: sumar, restar, multiplicar, dividir
    4. Resultado (estructura de datos) y calcular() (punto de entrada)
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# Máximo de bits permitidos por número (evita entradas absurdamente largas).
MAX_BITS = 64

# Operaciones disponibles: clave -> (nombre para mostrar, símbolo).
OPERACIONES = {
    "suma": ("Suma", "+"),
    "resta": ("Resta", "−"),
    "multiplicacion": ("Multiplicación", "×"),
    "division": ("División", "÷"),
}


# ---------------------------------------------------------------------------
# 1. EXCEPCIONES PROPIAS
# ---------------------------------------------------------------------------
# Todas heredan de ErrorBinario, así la interfaz puede capturar "cualquier
# error esperado" con un solo `except ErrorBinario`.

class ErrorBinario(Exception):
    """Error base de todo el simulador."""


class EntradaInvalida(ErrorBinario):
    """El texto ingresado no es un binario válido."""


class DivisionPorCero(ErrorBinario):
    """Se intentó dividir entre 0."""


class OperacionDesconocida(ErrorBinario):
    """Se pidió una operación que no existe."""


# ---------------------------------------------------------------------------
# 2. UTILIDADES
# ---------------------------------------------------------------------------

def validar_binario(texto) -> str:
    """Revisa que `texto` sea un binario válido y lo devuelve limpio.

    Reglas: no vacío, solo 0 y 1 (se ignoran espacios), máximo MAX_BITS bits.
    Lanza EntradaInvalida si algo falla.
    """
    if texto is None:
        raise EntradaInvalida("No se recibió ningún valor.")

    limpio = str(texto).strip().replace(" ", "")

    if limpio == "":
        raise EntradaInvalida("El campo está vacío.")

    if limpio.startswith("-"):
        raise EntradaInvalida(
            "No se ingresan negativos: escribe solo 0 y 1. "
            "(La resta ya muestra el signo si el resultado es negativo.)"
        )

    for caracter in limpio:
        if caracter not in "01":
            raise EntradaInvalida(
                f"'{caracter}' no es válido. Un número binario solo tiene 0 y 1."
            )

    if len(limpio) > MAX_BITS:
        raise EntradaInvalida(f"Máximo {MAX_BITS} bits por número.")

    return limpio


def normalizar(bits: str) -> str:
    """Quita ceros a la izquierda: '00101' -> '101'. Si queda vacío, '0'."""
    return bits.lstrip("0") or "0"


def comparar(a: str, b: str) -> int:
    """Compara dos binarios. Devuelve -1 si a<b, 0 si a==b, 1 si a>b.

    Un binario normalizado con más bits siempre es mayor; si tienen la misma
    longitud, el texto se compara de izquierda a derecha.
    """
    a, b = normalizar(a), normalizar(b)
    if len(a) != len(b):
        return -1 if len(a) < len(b) else 1
    if a == b:
        return 0
    return -1 if a < b else 1  # misma longitud: orden de texto = orden numérico


# ---------------------------------------------------------------------------
# 3. LAS CUATRO OPERACIONES
# ---------------------------------------------------------------------------
# Cada función recibe `pasos` (lista opcional). Si se pasa una lista, la
# función va escribiendo ahí la explicación paso a paso; si es None, calcula
# en silencio (se usa cuando una operación llama a otra internamente).

def sumar(a: str, b: str, pasos: Optional[List[str]] = None,
          detalle: Optional[dict] = None) -> str:
    """SUMA binaria con acarreo (sumador completo, columna por columna).

    `pasos`   → lista de textos explicativos (para leer).
    `detalle` → diccionario con los mismos pasos en forma de DATOS (para que
                la interfaz pueda animarlos). Ambos son opcionales.

    Reglas de cada columna (a + b + acarreo):
        resultado = a XOR b XOR acarreo
        acarreo'  = (a AND b) OR (acarreo AND (a XOR b))
    """
    a, b = normalizar(a), normalizar(b)
    n = max(len(a), len(b))
    a, b = a.zfill(n), b.zfill(n)      # igualamos longitudes con ceros a la izquierda

    if detalle is not None:
        detalle.update({"tipo": "suma", "fila_a": a, "fila_b": b, "columnas": []})

    acarreo = 0
    bits_resultado = []

    # Recorremos de DERECHA a IZQUIERDA (del bit menos al más significativo).
    for i in range(n - 1, -1, -1):
        bit_a, bit_b = int(a[i]), int(b[i])

        bit_suma = bit_a ^ bit_b ^ acarreo                         # XOR
        nuevo_acarreo = (bit_a & bit_b) | (acarreo & (bit_a ^ bit_b))

        if pasos is not None:
            pasos.append(
                f"Columna {n - i}: {bit_a} + {bit_b} + acarreo {acarreo}"
                f"  →  escribo {bit_suma}, llevo {nuevo_acarreo}"
            )
        if detalle is not None:         # pos 0 = columna de la derecha
            detalle["columnas"].append({
                "pos": n - 1 - i, "a": bit_a, "b": bit_b,
                "entra": acarreo, "bit": bit_suma, "sale": nuevo_acarreo,
            })
        bits_resultado.append(str(bit_suma))
        acarreo = nuevo_acarreo

    if detalle is not None:
        detalle["acarreo_final"] = bool(acarreo)

    if acarreo:                         # si sobró acarreo, es un bit extra a la izquierda
        bits_resultado.append("1")
        if pasos is not None:
            pasos.append("Sobró acarreo 1: se escribe al inicio del resultado.")

    # Los bits se fueron guardando al revés (derecha→izquierda); los volteamos.
    return normalizar("".join(reversed(bits_resultado)))


def restar(a: str, b: str, pasos: Optional[List[str]] = None,
           detalle: Optional[dict] = None) -> Tuple[str, bool]:
    """RESTA binaria con préstamo. Devuelve (resultado, es_negativo).

    Si a < b se restan al revés (b - a) y se marca el resultado como negativo.
    En cada columna: x - (y + préstamo). Si x es menor, "pedimos prestado"
    2 (un 1 de la columna izquierda vale 2 en binario).
    """
    a, b = normalizar(a), normalizar(b)
    negativo = False

    if comparar(a, b) < 0:              # a < b → intercambiamos y marcamos signo
        a, b = b, a
        negativo = True
        if pasos is not None:
            pasos.append("El minuendo es menor: calculo (B − A) y pongo signo negativo.")

    n = len(a)
    b = b.zfill(n)

    if detalle is not None:
        detalle.update({"tipo": "resta", "fila_a": a, "fila_b": b,
                        "negativo": negativo, "columnas": []})

    prestamo = 0
    bits_resultado = []

    for i in range(n - 1, -1, -1):
        x, y = int(a[i]), int(b[i])
        a_restar = y + prestamo         # lo que hay que quitarle a x (0, 1 o 2)

        if x >= a_restar:
            diferencia = x - a_restar
            nuevo_prestamo = 0
        else:
            diferencia = x + 2 - a_restar   # pedimos prestado: sumamos 2 a x
            nuevo_prestamo = 1

        if pasos is not None:
            pasos.append(
                f"Columna {n - i}: {x} − {y} − préstamo {prestamo}"
                f"  →  escribo {diferencia}, préstamo {nuevo_prestamo}"
            )
        if detalle is not None:
            detalle["columnas"].append({
                "pos": n - 1 - i, "a": x, "b": y,
                "entra": prestamo, "bit": diferencia, "sale": nuevo_prestamo,
            })
        bits_resultado.append(str(diferencia))
        prestamo = nuevo_prestamo

    resultado = normalizar("".join(reversed(bits_resultado)))
    if resultado == "0":
        negativo = False                # el cero no tiene signo
    return resultado, negativo


def multiplicar(a: str, b: str, pasos: Optional[List[str]] = None,
                detalle: Optional[dict] = None) -> str:
    """MULTIPLICACIÓN binaria por desplazamiento y suma.

    Por cada bit de B (de derecha a izquierda):
        - si el bit es 1 → sumamos A desplazado a la izquierda tantas
          posiciones como lugar ocupe ese bit (se agregan ceros a la derecha);
        - si es 0 → no se suma nada.
    """
    a, b = normalizar(a), normalizar(b)
    total = "0"

    if detalle is not None:
        detalle.update({"tipo": "multiplicacion", "a": a, "b": b, "parciales": []})

    for posicion, bit in enumerate(reversed(b)):
        parcial = None                          # None = este bit no aporta nada
        if bit == "1":
            parcial = a + "0" * posicion        # desplazar = agregar ceros a la derecha
            nuevo_total = sumar(total, parcial)
            if pasos is not None:
                pasos.append(
                    f"Bit {posicion} de B = 1 → producto parcial {parcial}; "
                    f"acumulado: {total} + {parcial} = {nuevo_total}"
                )
            total = nuevo_total
        elif pasos is not None:
            pasos.append(f"Bit {posicion} de B = 0 → no se suma nada.")

        if detalle is not None:
            detalle["parciales"].append({
                "pos": posicion, "bit": bit, "parcial": parcial,
                "acumulado": normalizar(total),
            })

    return normalizar(total)


def dividir(a: str, b: str, pasos: Optional[List[str]] = None,
            detalle: Optional[dict] = None) -> Tuple[str, str]:
    """DIVISIÓN binaria larga. Devuelve (cociente, residuo).

    Igual que la división de primaria, pero en binario: se "baja" un bit de A
    a la vez al residuo parcial. Si el residuo parcial ya es >= B, el bit del
    cociente es 1 y se le resta B; si no, el bit del cociente es 0.
    """
    a, b = normalizar(a), normalizar(b)

    if b == "0":
        raise DivisionPorCero("No se puede dividir entre 0.")

    residuo = "0"
    bits_cociente = []

    if detalle is not None:
        detalle.update({"tipo": "division", "a": a, "b": b, "pasos": []})

    for bit in a:
        residuo = normalizar(residuo + bit)     # "bajamos" el siguiente bit
        parcial = residuo                       # lo guardamos antes de restar
        if comparar(residuo, b) >= 0:
            nuevo_residuo, _ = restar(residuo, b)
            if pasos is not None:
                pasos.append(
                    f"Bajo {bit}: parcial {residuo} ≥ {b} → cociente 1; "
                    f"{residuo} − {b} = {nuevo_residuo}"
                )
            residuo = nuevo_residuo
            bits_cociente.append("1")
        else:
            if pasos is not None:
                pasos.append(
                    f"Bajo {bit}: parcial {residuo} < {b} → cociente 0; no se resta."
                )
            bits_cociente.append("0")

        if detalle is not None:
            detalle["pasos"].append({
                "bit": bit, "parcial": parcial, "resta": bits_cociente[-1] == "1",
                "residuo": residuo, "bit_cociente": bits_cociente[-1],
            })

    return normalizar("".join(bits_cociente)), residuo


# ---------------------------------------------------------------------------
# 4. RESULTADO Y PUNTO DE ENTRADA
# ---------------------------------------------------------------------------

@dataclass
class Resultado:
    """Todo lo que la interfaz necesita mostrar de una operación."""
    operacion: str                  # clave: "suma", "resta", ...
    simbolo: str                    # + − × ÷
    a: str                          # primer número (binario normalizado)
    b: str                          # segundo número (binario normalizado)
    resultado: str                  # resultado binario (con "-" si es negativo)
    residuo: Optional[str] = None   # solo en división
    a_dec: int = 0                  # equivalentes en decimal (solo para comprobar)
    b_dec: int = 0
    res_dec: int = 0
    residuo_dec: Optional[int] = None
    verificado: bool = False        # ¿coincide con el cálculo nativo de Python?
    columnas: str = ""              # operación dibujada en columnas
    pasos: List[str] = field(default_factory=list)
    detalle: dict = field(default_factory=dict)   # pasos como DATOS (para animar)


def _dibujar_columnas(a: str, b: str, simbolo: str, resultado: str,
                      residuo: Optional[str]) -> str:
    """Devuelve la operación escrita en columnas alineadas a la derecha."""
    if residuo is not None:     # la división se muestra en una sola línea
        return f"{a} {simbolo} {b} = {resultado}   (residuo {residuo})"
    linea_b = f"{simbolo} {b}"
    ancho = max(len(a), len(linea_b), len(resultado))
    return "\n".join([
        a.rjust(ancho),
        linea_b.rjust(ancho),
        "─" * ancho,
        resultado.rjust(ancho),
    ])


def calcular(texto_a: str, texto_b: str, operacion: str) -> Resultado:
    """PUNTO DE ENTRADA: valida, opera y arma el Resultado.

    Es la única función que la interfaz necesita llamar.
    Puede lanzar: EntradaInvalida, DivisionPorCero, OperacionDesconocida.
    """
    if operacion not in OPERACIONES:
        raise OperacionDesconocida(f"Operación desconocida: '{operacion}'.")

    a = normalizar(validar_binario(texto_a))
    b = normalizar(validar_binario(texto_b))
    simbolo = OPERACIONES[operacion][1]
    pasos: List[str] = []
    detalle: dict = {}
    residuo = None

    if operacion == "suma":
        texto_res = sumar(a, b, pasos, detalle)
    elif operacion == "resta":
        texto_res, negativo = restar(a, b, pasos, detalle)
        texto_res = ("-" if negativo else "") + texto_res
    elif operacion == "multiplicacion":
        texto_res = multiplicar(a, b, pasos, detalle)
    else:  # division
        texto_res, residuo = dividir(a, b, pasos, detalle)

    # --- Comprobación en decimal (solo para verificar, no para calcular) ---
    a_dec, b_dec = int(a, 2), int(b, 2)
    res_dec = int(texto_res, 2)         # int("-101", 2) == -5, también funciona
    residuo_dec = int(residuo, 2) if residuo is not None else None

    if operacion == "suma":
        verificado = res_dec == a_dec + b_dec
    elif operacion == "resta":
        verificado = res_dec == a_dec - b_dec
    elif operacion == "multiplicacion":
        verificado = res_dec == a_dec * b_dec
    else:
        verificado = (res_dec == a_dec // b_dec) and (residuo_dec == a_dec % b_dec)

    return Resultado(
        operacion=operacion, simbolo=simbolo, a=a, b=b,
        resultado=texto_res, residuo=residuo,
        a_dec=a_dec, b_dec=b_dec, res_dec=res_dec, residuo_dec=residuo_dec,
        verificado=verificado,
        columnas=_dibujar_columnas(a, b, simbolo, texto_res, residuo),
        pasos=pasos,
        detalle=detalle,
    )
