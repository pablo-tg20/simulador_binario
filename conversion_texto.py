"""
conversion_texto.py
===================
LÓGICA de la conversión TEXTO <-> BINARIO (código ASCII). No contiene interfaz.

Idea central: una computadora solo guarda números. Para guardar una letra,
a cada letra se le asigna un número: su CÓDIGO ASCII (la "A" es 65, la "a" es
97, el espacio es 32...). Y ese número se guarda en binario, con 8 bits.

    Texto → binario:   "H"  →  72  →  01001000
    Binario → texto:   01001000  →  72  →  "H"

Cómo se pasa un número a 8 bits (método de los PESOS):
    Cada posición del byte "vale" una potencia de 2:

            128   64   32   16    8    4    2    1

    De izquierda a derecha: si el peso CABE en lo que queda del número,
    se escribe 1 y se resta; si no cabe, se escribe 0.
    Ejemplo con 72:
        128 no cabe → 0 | 64 cabe → 1 (quedan 8) | 32 → 0 | 16 → 0
        8 cabe → 1 (quedan 0) | 4 → 0 | 2 → 0 | 1 → 0      =  01001000

Y al revés: se SUMAN los pesos de las posiciones que tienen 1.
    01001000  →  64 + 8 = 72  →  "H"

Contenido:
    1. Constantes y excepciones
    2. Número <-> byte (el método de los pesos)
    3. Describir un carácter
    4. texto_a_binario(), binario_a_texto() y convertir() (punto de entrada)
    5. tabla_ascii() (datos para la tabla de referencia)
"""

import unicodedata
from dataclasses import dataclass, field
from typing import List

from logica_binaria import EntradaInvalida, ErrorBinario

# ---------------------------------------------------------------------------
# 1. CONSTANTES Y EXCEPCIONES
# ---------------------------------------------------------------------------
MAX_CARACTERES = 100                    # máximo de letras por conversión
PESOS = (128, 64, 32, 16, 8, 4, 2, 1)   # lo que "vale" cada posición de un byte
MODOS = ("texto_a_binario", "binario_a_texto")


class ModoDesconocido(ErrorBinario):
    """Se pidió una conversión que no existe."""


# ---------------------------------------------------------------------------
# 2. NÚMERO <-> BYTE
# ---------------------------------------------------------------------------

def decimal_a_byte(numero: int):
    """Pasa un número (0–255) a 8 bits con el método de los pesos.

    Devuelve (bits, desglose). `desglose` guarda cada decisión para poder
    mostrarla en pantalla:
        [{"peso": 128, "bit": 0, "queda": 72, "suma": 0}, ...]
    donde `queda` es lo que falta por repartir y `suma` lo que llevan sumado
    los pesos que ya tienen 1 (siempre queda + suma = número).
    """
    queda = numero
    suma = 0
    bits = []
    desglose = []
    for peso in PESOS:
        if queda >= peso:       # ¿cabe el peso en lo que queda?
            bit = 1
            queda -= peso       # sí: escribo 1 y lo resto
            suma += peso
        else:
            bit = 0             # no: escribo 0
        bits.append(str(bit))
        desglose.append({"peso": peso, "bit": bit, "queda": queda, "suma": suma})
    return "".join(bits), desglose


def byte_a_decimal(bits: str) -> int:
    """Pasa 8 bits a número: suma el peso de cada posición que tenga 1."""
    total = 0
    for bit, peso in zip(bits, PESOS):
        if bit == "1":
            total += peso
    return total


# ---------------------------------------------------------------------------
# 3. DESCRIBIR UN CARÁCTER
# ---------------------------------------------------------------------------

def es_imprimible(codigo: int) -> bool:
    """¿Este código es una letra, número, signo o espacio que se pueda ver?

    Se aceptan:  32–126  → ASCII estándar (espacio, signos, números, letras)
                161–255  → ASCII extendido / Latin-1 (á, é, ñ, ¿, ¡...), excepto 173
    Quedan fuera los códigos de control (salto de línea, tabulador...), que no se ven.
    """
    return 32 <= codigo <= 126 or (161 <= codigo <= 255 and codigo != 173)


def _tipo(codigo: int) -> str:
    """Clasifica el carácter (la interfaz lo usa para etiquetarlo)."""
    if codigo == 32:
        return "espacio"
    if 65 <= codigo <= 90:
        return "mayuscula"
    if 97 <= codigo <= 122:
        return "minuscula"
    if 48 <= codigo <= 57:
        return "numero"
    if codigo > 127:
        return "extendido"
    return "signo"


@dataclass
class Caracter:
    """Una letra con todo lo necesario para mostrarla."""
    caracter: str           # "H"
    visible: str            # lo que se dibuja ("␣" para el espacio, que no se vería)
    decimal: int            # código ASCII: 72
    binario: str            # 8 bits: "01001000"
    tipo: str               # mayuscula, minuscula, numero, espacio, signo, extendido
    extendido: bool         # True si está fuera del ASCII original (0–127)
    desglose: List[dict] = field(default_factory=list)   # decisiones por peso


def describir(codigo: int) -> Caracter:
    """Arma el Caracter que corresponde a un código ASCII."""
    bits, desglose = decimal_a_byte(codigo)
    return Caracter(
        caracter=chr(codigo),
        visible="␣" if codigo == 32 else chr(codigo),
        decimal=codigo,
        binario=bits,
        tipo=_tipo(codigo),
        extendido=codigo > 127,
        desglose=desglose,
    )


@dataclass
class Conversion:
    """Todo lo que la interfaz necesita mostrar de una conversión."""
    modo: str                       # "texto_a_binario" o "binario_a_texto"
    entrada: str                    # lo que escribió el usuario
    texto: str                      # el texto completo (entrada o resultado)
    binario: str                    # los bytes separados por espacio
    caracteres: List[Caracter]      # una entrada por letra
    relleno: bool = False           # ¿se completaron grupos de menos de 8 bits?
    hay_extendidos: bool = False    # ¿hay letras fuera del ASCII original (ñ, á...)?


# ---------------------------------------------------------------------------
# 4. LAS DOS CONVERSIONES
# ---------------------------------------------------------------------------

def _mostrar(caracter: str) -> str:
    """Cómo nombrar un carácter dentro de un mensaje de error."""
    return f"'{caracter}'" if caracter.isprintable() else f"U+{ord(caracter):04X}"


def texto_a_binario(texto) -> Conversion:
    """Convierte letras, palabras o frases (con espacios) a binario de 8 bits."""
    if not isinstance(texto, str):
        raise EntradaInvalida("No se recibió ningún texto.")

    # NFC: una "ñ" escrita como n + tilde suelta se junta en un solo carácter.
    # Los espacios "duros" (U+00A0) que trae el texto copiado de webs se vuelven espacios normales.
    texto = unicodedata.normalize("NFC", texto).replace(" ", " ")

    if texto == "":
        raise EntradaInvalida("El campo está vacío. Escribe una letra, una palabra o una frase.")
    if len(texto) > MAX_CARACTERES:
        raise EntradaInvalida(f"Máximo {MAX_CARACTERES} caracteres (escribiste {len(texto)}).")

    caracteres = []
    for posicion, c in enumerate(texto, start=1):
        codigo = ord(c)
        if not es_imprimible(codigo):
            raise EntradaInvalida(
                f"El carácter {_mostrar(c)} (posición {posicion}) no se puede convertir a 8 bits. "
                "Usa letras, números, signos, espacios, acentos o ñ."
            )
        caracteres.append(describir(codigo))

    return Conversion(
        modo="texto_a_binario",
        entrada=texto,
        texto=texto,
        binario=" ".join(c.binario for c in caracteres),
        caracteres=caracteres,
        hay_extendidos=any(c.extendido for c in caracteres),
    )


def binario_a_texto(entrada) -> Conversion:
    """Convierte bytes binarios a texto.

    Formas de escribirlos:
      - Separados por espacios:  01001000 01101111       (lo más claro)
      - Pegados:                 0100100001101111        (múltiplo de 8 bits)
      - Un grupo de menos de 8 bits se completa con ceros a la izquierda:
        1000001 → 01000001 (la "A").
    """
    if not isinstance(entrada, str):
        raise EntradaInvalida("No se recibió ningún valor.")

    grupos = entrada.split()            # separa por espacios (uno o varios)
    if not grupos:
        raise EntradaInvalida("El campo está vacío. Escribe bytes de 0 y 1, por ejemplo 01001000.")

    # --- Paso 1: separar todo en bytes de 8 bits ---
    bytes_ = []
    relleno = False
    for n, grupo in enumerate(grupos, start=1):
        for c in grupo:
            if c not in "01":
                raise EntradaInvalida(
                    f"{_mostrar(c)} no es válido (grupo {n}). Solo se permiten 0 y 1; "
                    "usa espacios para separar una letra de otra."
                )
        if len(grupo) <= 8:
            if len(grupo) < 8:
                relleno = True
            bytes_.append(grupo.rjust(8, "0"))          # completa con ceros a la izquierda
        elif len(grupo) % 8 == 0:
            bytes_.extend(grupo[i:i + 8] for i in range(0, len(grupo), 8))
        else:
            raise EntradaInvalida(
                f"El grupo {n} tiene {len(grupo)} bits. Cada letra usa 8 bits: "
                "sepáralos con espacios o pega un múltiplo de 8."
            )

    if len(bytes_) > MAX_CARACTERES:
        raise EntradaInvalida(f"Máximo {MAX_CARACTERES} letras (son {len(bytes_)} bytes).")

    # --- Paso 2: cada byte -> número -> carácter ---
    caracteres = []
    for posicion, byte in enumerate(bytes_, start=1):
        codigo = byte_a_decimal(byte)
        if not es_imprimible(codigo):
            raise EntradaInvalida(
                f"El byte {posicion} ({byte}) vale {codigo}, que no es una letra visible. "
                "Los códigos válidos son 32–126 y 161–255."
            )
        caracteres.append(describir(codigo))

    return Conversion(
        modo="binario_a_texto",
        entrada=entrada,
        texto="".join(c.caracter for c in caracteres),
        binario=" ".join(bytes_),
        caracteres=caracteres,
        relleno=relleno,
        hay_extendidos=any(c.extendido for c in caracteres),
    )


def convertir(modo, texto) -> Conversion:
    """PUNTO DE ENTRADA: elige la conversión según `modo`.

    Puede lanzar: EntradaInvalida, ModoDesconocido.
    """
    if modo == "texto_a_binario":
        return texto_a_binario(texto)
    if modo == "binario_a_texto":
        return binario_a_texto(texto)
    raise ModoDesconocido(f"Conversión desconocida: '{modo}'.")


# ---------------------------------------------------------------------------
# 5. TABLA DE REFERENCIA
# ---------------------------------------------------------------------------
_SIGNOS = [32] + list(range(33, 48)) + list(range(58, 65)) + list(range(91, 97)) + list(range(123, 127))

_GRUPOS_TABLA = [
    ("mayusculas", "Mayúsculas A–Z", list(range(65, 91))),
    ("minusculas", "Minúsculas a–z", list(range(97, 123))),
    ("numeros", "Números 0–9", list(range(48, 58))),
    ("signos", "Espacio y signos", _SIGNOS),
    ("espanol", "Acentos y ñ", [ord(c) for c in "áéíóúüñÁÉÍÓÚÜÑ¿¡"]),
]


def tabla_ascii() -> List[dict]:
    """Datos de la tabla de referencia: grupos con letra, decimal y binario."""
    grupos = []
    for clave, nombre, codigos in _GRUPOS_TABLA:
        filas = []
        for codigo in codigos:
            c = describir(codigo)
            filas.append({"caracter": c.caracter, "visible": c.visible,
                          "decimal": c.decimal, "binario": c.binario, "tipo": c.tipo})
        grupos.append({"clave": clave, "nombre": nombre, "filas": filas})
    return grupos
