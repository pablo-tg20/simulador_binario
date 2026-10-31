"use strict";
/* ==========================================================================
   app.js — el COMPORTAMIENTO de la página (corre en el navegador).

   Lo que hace este archivo:
     0. Carga Python dentro del navegador (Pyodide) y los archivos .py
     1. Pregunta qué operaciones existen                        (GET  /api/operaciones)
     2. Manda los números para calcular                         (POST /api/calcular)
     3. Dibuja el resultado y anima la simulación paso a paso
     4. Convierte texto <-> binario (ASCII) pidiéndoselo a Python (puente.py)
                                                                (POST /api/convertir)
                                                                (GET  /api/tabla-ascii)

   VERSIÓN WEB: no hay servidor. Las "peticiones" (apiFetch) se resuelven llamando
   a puente.py, que corre en el navegador. Los mensajes tienen el mismo formato.

   IMPORTANTE: aquí NO se calcula nada. Toda la aritmética vive en
   logica_binaria.py y la conversión en conversion_texto.py.
   Este archivo solo pide y dibuja.
   ========================================================================== */

/* ---------- Configuración y estado ---------------------------------------- */
const RUTAS = {
  operaciones: "/api/operaciones", calcular: "/api/calcular",
  convertir: "/api/convertir", tablaAscii: "/api/tabla-ascii",
};
const MAX_HISTORIAL = 20;
const CLAVE_HISTORIAL = "simulador-binario-historial";

// Lista fija de operaciones: así la interfaz se dibuja sin esperar a que Python termine de cargar.
const OPERACIONES_RESPALDO = [
  { clave: "suma", nombre: "Suma", simbolo: "+" },
  { clave: "resta", nombre: "Resta", simbolo: "−" },
  { clave: "multiplicacion", nombre: "Multiplicación", simbolo: "×" },
  { clave: "division", nombre: "División", simbolo: "÷" },
];

const estado = { operacion: "suma", operaciones: [], historial: [], enCurso: false };
const sim = { ins: null, k: 0, timer: null };      // la simulación en marcha

/* Cómo se llama cada número según la operación. Así el usuario siempre sabe
   QUÉ se le hace a QUÉ (cuál se resta de cuál, cuál divide a cuál...). */
const ROLES = {
  suma: {
    a: { nombre: "Primer sumando", ayuda: "Uno de los dos números que se juntan." },
    b: { nombre: "Segundo sumando", ayuda: "El otro número. El orden no importa." },
    filas: ["sumando 1", "sumando 2"],
  },
  resta: {
    a: { nombre: "Minuendo", ayuda: "El número AL QUE le quitas." },
    b: { nombre: "Sustraendo", ayuda: "Lo que LE QUITAS al primero." },
    filas: ["minuendo", "sustraendo"],
  },
  multiplicacion: {
    a: { nombre: "Multiplicando", ayuda: "El número que se repite." },
    b: { nombre: "Multiplicador", ayuda: "Cuántas veces se repite." },
    filas: ["multiplicando", "multiplicador"],
  },
  division: {
    a: { nombre: "Dividendo", ayuda: "Lo que se reparte." },
    b: { nombre: "Divisor", ayuda: "Entre cuántos se reparte." },
    filas: ["dividendo", "divisor"],
  },
};

/* Lo que se ve en el escenario antes de calcular */
const PLACEHOLDER = `<div class="vacio"><div class="deco" aria-hidden="true"><span>0</span><span>1</span><span>1</span><span>0</span></div>
<p>Elige una operación, escribe dos números<br>y pulsa <b>Calcular</b>: aquí verás cómo<br>se construye el resultado, bit por bit.</p></div>`;


/* ---------- Puente con Python (Pyodide) ------------------------------------
   En vez de hablar con un servidor, cargamos Python en el navegador y los
   tres archivos .py. apiFetch() imita a fetch(): recibe la ruta y el cuerpo
   JSON, llama a puente.atender() y devuelve algo con .json(). */
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const ARCHIVOS_PY = ["logica_binaria.py", "conversion_texto.py", "puente.py"];
let atenderPython = null;

async function cargarPython() {
  if (typeof loadPyodide === "undefined") {
    throw new Error("No se pudo descargar Pyodide (¿sin internet?).");
  }
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  for (const nombre of ARCHIVOS_PY) {
    const respuesta = await fetch(nombre);                 // los .py viven junto a index.html
    if (!respuesta.ok) throw new Error(`No se encontró ${nombre}.`);
    pyodide.FS.writeFile(`/home/pyodide/${nombre}`, await respuesta.text());
  }
  pyodide.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')");
  atenderPython = pyodide.pyimport("puente").atender;
}

const pythonListo = cargarPython();     // empieza a cargar apenas se abre la página
pythonListo.catch((error) => console.error("Python no cargó:", error));

async function apiFetch(ruta, opciones = {}) {
  await pythonListo;                                       // si falló, lanza y se muestra el error
  const metodo = opciones.body ? "POST" : "GET";
  const datos = JSON.parse(atenderPython(ruta, metodo, opciones.body ?? ""));
  const estado = datos.ok === false ? 422 : 200;
  return { ok: estado < 300, status: estado, json: async () => datos };
}

/* ---------- Atajos para trabajar con el DOM ------------------------------- */
const $ = (id) => document.getElementById(id);

/** Crea un elemento: el("div", "clase", "<b>html</b>") */
function el(etiqueta, clase = "", html = "") {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (html) nodo.innerHTML = html;
  return nodo;
}

const ICONO_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>';
const ICONO_PAUSA = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

/* ==========================================================================
   1. INICIO
   ========================================================================== */
async function iniciar() {
  enlazarEventos();
  cargarHistorial();
  iconoPlay(true);
  actualizarVista("a");
  actualizarVista("b");

  // La interfaz se dibuja de inmediato; Python termina de cargar en segundo plano.
  estado.operaciones = OPERACIONES_RESPALDO;
  construirSelector();
  elegirModoConversion("texto_a_binario");

  try {
    const respuesta = await apiFetch(RUTAS.operaciones);   // espera a que Python esté listo
    const datos = await respuesta.json();
    conv.maxCaracteres = datos.max_caracteres ?? conv.maxCaracteres;
    elegirModoConversion(conv.modo, true);                 // actualiza el límite de caracteres
    marcarServidor(true);
  } catch (error) {
    marcarServidor(false);
  }
}

function marcarServidor(conectado) {
  const caja = $("estado-servidor");
  caja.classList.toggle("conectado", conectado);
  caja.classList.toggle("caido", !conectado);
  caja.querySelector("span").textContent = conectado
    ? "Python listo"
    : "No se pudo cargar Python";
}

/* ==========================================================================
   2. SELECTOR DE OPERACIÓN
   ========================================================================== */
function construirSelector() {
  const selector = $("selector");
  selector.style.setProperty("--n", estado.operaciones.length);
  estado.operaciones.forEach((op) => {
    const boton = el("button", "opcion",
      `<span class="simbolo">${op.simbolo}</span><span class="nombre">${op.nombre}</span>`);
    boton.type = "button";
    boton.dataset.clave = op.clave;
    boton.setAttribute("role", "tab");
    boton.addEventListener("click", () => elegirOperacion(op.clave));
    selector.appendChild(boton);
  });
  elegirOperacion(estado.operacion);
}

function elegirOperacion(clave) {
  estado.operacion = clave;
  document.body.dataset.op = clave;          // el CSS cambia los colores según este valor
  const indice = Math.max(0, estado.operaciones.findIndex((o) => o.clave === clave));
  $("pastilla").style.transform = `translateX(${indice * 100}%)`;
  document.querySelectorAll(".opcion").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.clave === clave)));
  aplicarRoles(clave);
}

/** Cambia los nombres de los campos (minuendo, divisor...) según la operación. */
function aplicarRoles(clave) {
  const roles = ROLES[clave];
  if (!roles) return;
  const op = estado.operaciones.find((o) => o.clave === clave);
  $("rol-a").textContent = roles.a.nombre;
  $("ayuda-a").textContent = roles.a.ayuda;
  $("rol-b").textContent = roles.b.nombre;
  $("ayuda-b").textContent = roles.b.ayuda;

  const simbolo = $("simbolo-operador");
  simbolo.textContent = op ? op.simbolo : "";
  simbolo.classList.remove("pop");
  void simbolo.offsetWidth;                 // reinicia la animación
  simbolo.classList.add("pop");
  actualizarFrase();
}

/** Frase en lenguaje normal: "a 11 le quitas 6", "11 repartido entre 2"... */
function actualizarFrase() {
  const caja = $("frase");
  const ta = $("entrada-a").value.replace(/\s/g, "");
  const tb = $("entrada-b").value.replace(/\s/g, "");
  const esBinario = (t) => /^[01]+$/.test(t);

  if (!esBinario(ta) || !esBinario(tb)) {
    caja.innerHTML = "Escribe los dos números en binario y aquí te explico, en palabras normales, qué se va a calcular.";
    return;
  }
  const a = BigInt("0b" + ta), b = BigInt("0b" + tb);   // BigInt: sin límite de tamaño
  let texto;
  switch (estado.operacion) {
    case "suma":
      texto = `<b>${a} + ${b}</b>: juntas las dos cantidades.`;
      break;
    case "resta":
      texto = a >= b
        ? `<b>${a} − ${b}</b>: a ${a} le quitas ${b}.`
        : `<b>${a} − ${b}</b>: a ${a} le quieres quitar ${b}, que es más grande. El resultado será negativo.`;
      break;
    case "multiplicacion":
      texto = `<b>${a} × ${b}</b>: repites ${a} un total de ${b} veces.`;
      break;
    default:
      texto = b === 0n
        ? `<b>${a} ÷ 0</b>: no se puede dividir entre 0.`
        : `<b>${a} ÷ ${b}</b>: repartes ${a} entre ${b}.`;
  }
  caja.innerHTML = `En decimal → ${texto}`;
}

/* ==========================================================================
   3. ENTRADAS: vista previa de bits y validación visual
   ========================================================================== */
function actualizarVista(lado) {
  const entrada = $(`entrada-${lado}`);
  const vista = $(`vista-${lado}`);
  const decimal = $(`decimal-${lado}`);
  const texto = entrada.value.replace(/\s/g, "");

  vista.innerHTML = "";
  entrada.classList.remove("valida", "invalida");
  decimal.textContent = "";
  if (texto === "") { actualizarFrase(); return; }

  const MOSTRAR = 40;                          // para no llenar la pantalla con 64 bits
  [...texto].slice(0, MOSTRAR).forEach((c) => {
    const clase = c === "1" ? "bit uno" : c === "0" ? "bit" : "bit malo";
    const chip = el("div", clase);
    chip.textContent = c;
    vista.appendChild(chip);
  });
  if (texto.length > MOSTRAR) vista.appendChild(el("span", "mas", `+${texto.length - MOSTRAR} bits`));

  // Esta validación es solo VISUAL. La validación real la hace Python.
  const valido = /^[01]+$/.test(texto);
  entrada.classList.add(valido ? "valida" : "invalida");
  if (valido) decimal.textContent = `= ${BigInt("0b" + texto).toString()} en decimal`;
  actualizarFrase();
}

/* ==========================================================================
   4. COMUNICACIÓN CON EL SERVIDOR
   ========================================================================== */
async function enviarCalculo() {
  if (estado.enCurso) return;
  ocultarError();

  // (a) Armamos el mensaje: un objeto JavaScript con los datos.
  const peticion = {
    a: $("entrada-a").value,
    b: $("entrada-b").value,
    operacion: estado.operacion,
  };

  estado.enCurso = true;
  $("btn-calcular").classList.add("cargando");

  try {
    // (b) apiFetch() manda el mensaje a Python. JSON.stringify lo convierte a texto JSON.
    let respuesta, datos;
    try {
      respuesta = await apiFetch(RUTAS.calcular, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(peticion),
      });
    } catch (error) {
      marcarServidor(false);
      mostrarError("No se pudo ejecutar Python en el navegador. Recarga la página (la primera vez necesita internet).");
      return;
    }
    marcarServidor(true);

    // (c) Python contesta con texto JSON; .json() lo convierte en un objeto.
    try {
      datos = await respuesta.json();
    } catch (error) {
      mostrarError("Python respondió algo que no se pudo entender.");
      return;
    }

    // (d) Si Python dijo ok:true → dibujamos; si no, mostramos su mensaje de error.
    if (!datos.ok) {
      mostrarError(datos.error?.mensaje ?? "Ocurrió un error desconocido.");
      return;
    }
    mostrarResultado(datos.resultado);
    agregarHistorial(datos.resultado);

    // En pantallas angostas la simulación queda debajo de la calculadora:
    // al calcular se baja sola hasta ella para que se vea de inmediato.
    if (window.innerWidth <= 980) {
      document.querySelector(".simulacion").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } finally {
    estado.enCurso = false;
    $("btn-calcular").classList.remove("cargando");
  }
}

/* ---------- Errores -------------------------------------------------------- */
function mostrarError(mensaje) {
  const caja = $("error");
  caja.textContent = mensaje;               // textContent: nunca interpreta HTML
  caja.hidden = false;
  caja.style.animation = "none"; void caja.offsetWidth; caja.style.animation = "";
}
function ocultarError() { $("error").hidden = true; }

/* ==========================================================================
   5. MOSTRAR EL RESULTADO
   ========================================================================== */
function pintarBits(contenedor, texto) {
  contenedor.innerHTML = "";
  // Cuantos más bits, más pequeños se dibujan (para que 64 bits no ocupen media pantalla).
  const n = texto.length;
  const tope = window.innerWidth <= 900 ? 34 : 46;
  const ancho = n <= 10 ? 46 : n <= 18 ? 34 : n <= 32 ? 24 : n <= 48 ? 18 : 14;
  contenedor.style.setProperty("--w", `${Math.min(ancho, tope)}px`);
  [...texto].forEach((c, i) => {
    const celda = el("div", c === "1" ? "bit uno" : "bit");
    if (c === "-") celda.className = "bit uno";
    celda.textContent = c === "-" ? "−" : c;
    celda.style.setProperty("--i", Math.min(i, 20));   // tope: la animación no tarda segundos
    contenedor.appendChild(celda);
  });
}

function mostrarResultado(res) {
  $("resultado-contenido").hidden = false;

  pintarBits($("resultado-bits"), res.resultado);

  const caja = $("resultado-residuo");
  caja.hidden = res.residuo === null;
  if (res.residuo !== null) {
    const destino = $("residuo-bits");
    destino.innerHTML = "";
    [...res.residuo].forEach((c) => {
      const celda = el("div", c === "1" ? "bit uno" : "bit");
      celda.textContent = c;
      destino.appendChild(celda);
    });
  }

  $("ecuacion").textContent = res.residuo !== null
    ? `${res.a_dec} ${res.simbolo} ${res.b_dec} = ${res.res_dec}, residuo ${res.residuo_dec}  (en decimal)`
    : `${res.a_dec} ${res.simbolo} ${res.b_dec} = ${res.res_dec}  (en decimal)`;

  const insignia = $("insignia");
  insignia.hidden = false;
  insignia.classList.toggle("mal", !res.verificado);
  insignia.textContent = res.verificado ? "✔ Verificado en decimal" : "✖ No coincide con el decimal";

  montarSimulacion(res);
}

function limpiarResultado() {
  $("resultado-contenido").hidden = true;
  $("insignia").hidden = true;
  detenerSimulacion();
  $("escenario").innerHTML = PLACEHOLDER;
  $("leyenda").textContent = "Cuando calcules, cada paso se explicará aquí.";
  $("contador").textContent = "—";
  actualizarControles();
}

/* ==========================================================================
   6. SIMULACIÓN PASO A PASO
   Cada "constructor" (simColumnas, simMultiplicacion, simDivision) recibe el
   resultado de Python y devuelve un objeto con:
        total          → cuántos pasos tiene
        montar(esc)    → dibuja el escenario vacío dentro de `esc`
        pintar(k)      → deja el escenario como se ve en el paso k
        leyenda(k)     → texto explicativo del paso k
   ========================================================================== */

/* ---------- Piezas visuales reutilizables --------------------------------- */
function bit(valor, extra = "") {
  const c = el("div", `bit${valor === "1" ? " uno" : ""}${extra ? " " + extra : ""}`);
  c.textContent = valor;
  return c;
}
const hueco = () => el("div", "bit hueco");
const pendiente = () => el("div", "bit pendiente");
const regla = () => el("div", "regla");

/** Una fila de la pizarra: etiqueta a la izquierda + `nCols` celdas. */
function fila(etiqueta, nCols, fabrica) {
  const contenedor = el("div", "fila");
  const rotulo = el("span", "etiqueta");
  rotulo.textContent = etiqueta;
  const rejilla = el("div", "celdas");
  rejilla.style.setProperty("--cols", nCols);
  const celdas = [];
  for (let i = 0; i < nCols; i++) {
    const c = fabrica(i);
    celdas.push(c);
    rejilla.appendChild(c);
  }
  contenedor.append(rotulo, rejilla);
  return { fila: contenedor, celdas };
}

/** Ancho de cada bit según cuántas columnas caben en el escenario. */
function calcularAncho(cols, reservado = window.innerWidth <= 900 ? 84 : 118, tope = 56) {
  const disponible = $("escenario").clientWidth - 48 - reservado;   // lo que queda para las celdas
  return Math.max(12, Math.min(tope, Math.floor(disponible / cols) - 6));
}

function pizarra(cols, esc) {
  const p = el("div", "pizarra");
  p.style.setProperty("--w", `${calcularAncho(cols)}px`);
  esc.appendChild(p);
  return p;
}

function poner(celda, valor, nuevo) {
  celda.className = `bit${valor === "1" ? " uno" : ""}${nuevo ? " nuevo" : ""}`;
  celda.textContent = valor;
}

/* ---------- Suma y resta: columna por columna ----------------------------- */
function simColumnas(res) {
  const d = res.detalle;
  const n = d.fila_a.length;
  const cols = n + 1;                          // una columna extra a la izquierda
  const esResta = d.tipo === "resta";
  const nombre = esResta ? "préstamo" : "acarreo";
  const operador = esResta ? "−" : "+";
  const invertido = esResta && d.negativo;     // si el minuendo es menor, se resta al revés
  const nombres = ROLES[esResta ? "resta" : "suma"].filas;
  const rotuloArriba = invertido ? "el mayor" : nombres[0];
  const rotuloAbajo = invertido ? "el menor" : nombres[1];

  const pasos = d.columnas.map((c) => ({ t: "col", c }));
  if (!esResta && d.acarreo_final) pasos.push({ t: "final" });
  if (invertido) pasos.push({ t: "signo" });

  let rAcarreo, rResultado, filaA, filaB, raiz;

  function montar(esc) {
    raiz = pizarra(cols, esc);
    const fAc = fila(nombre, cols, () => el("div", "bit hueco acarreo"));
    filaA = fila(rotuloArriba, cols, (i) => (i === 0 ? hueco() : bit(d.fila_a[i - 1])));
    filaB = fila(`${operador} ${rotuloAbajo}`, cols, (i) => (i === 0 ? hueco() : bit(d.fila_b[i - 1])));
    const fRes = fila("resultado", cols, pendiente);
    raiz.append(fAc.fila, filaA.fila, filaB.fila, regla(), fRes.fila);
    rAcarreo = fAc.celdas;
    rResultado = fRes.celdas;
  }

  function pintar(k) {
    rAcarreo.forEach((c) => { c.className = "bit hueco acarreo"; c.textContent = ""; });
    rResultado.forEach((c) => { c.className = "bit pendiente"; c.textContent = ""; });
    raiz.querySelectorAll(".activa").forEach((c) => c.classList.remove("activa"));

    for (let i = 0; i <= k; i++) {
      const p = pasos[i];
      const nuevo = i === k;
      if (p.t === "col") {
        const idx = cols - 1 - p.c.pos;        // pos 0 = columna de la derecha
        poner(rResultado[idx], String(p.c.bit), nuevo);
        if (p.c.sale === 1) {                  // el acarreo/préstamo "vuela" a la columna de la izquierda
          const destino = rAcarreo[idx - 1];
          destino.className = `bit acarreo${nuevo ? " nuevo" : ""}`;
          destino.textContent = "1";
        }
        if (nuevo) [rResultado[idx], filaA.celdas[idx], filaB.celdas[idx]]
          .forEach((c) => c.classList.add("activa"));
      } else if (p.t === "final") {
        poner(rResultado[0], "1", nuevo);
        if (nuevo) rResultado[0].classList.add("activa");
      } else {                                 // signo negativo
        poner(rResultado[0], "−", nuevo);
        rResultado[0].classList.add("uno");
      }
    }
  }

  function leyenda(k) {
    const p = pasos[k];
    if (p.t === "final") {
      return `Sobró un acarreo de <b>1</b> al terminar: se escribe al inicio del resultado.`;
    }
    if (p.t === "signo") {
      return `El minuendo era menor que el sustraendo: se calculó <b>mayor − menor</b>, así que el resultado lleva signo <b>−</b>.`;
    }
    const { pos, a, b, entra, bit: r, sale } = p.c;
    const intro = k === 0 && invertido
      ? `El minuendo es menor que el sustraendo, así que se resta al revés (mayor − menor) y al final se pone signo. `
      : "";
    if (!esResta) {
      const total = a + b + entra;
      return `${intro}Columna <b>${pos + 1}</b>: ${a} + ${b} + acarreo ${entra} = <b>${total}</b>. `
        + `Escribo <b>${r}</b> y ${sale ? "llevo <b>1</b> a la siguiente columna" : "no llevo nada"}.`;
    }
    const quitar = b + entra;
    const cuenta = sale
      ? `${a} es menor que ${quitar}: pido prestado (vale 2) → ${a} + 2 − ${quitar} = <b>${r}</b>, y debo <b>1</b> a la siguiente`
      : `${a} − ${quitar} = <b>${r}</b>, sin préstamo`;
    return `${intro}Columna <b>${pos + 1}</b>: ${a} − ${b} − préstamo ${entra}. ${cuenta}.`;
  }

  return { total: pasos.length, montar, pintar, leyenda };
}

/* ---------- Multiplicación: desplazar y sumar ----------------------------- */
function simMultiplicacion(res) {
  const d = res.detalle;
  const { a, b } = d;
  const cols = Math.max(res.resultado.length, a.length + b.length - 1, a.length, b.length);
  const pasos = d.parciales;
  let filaB, filasParciales, celdasTotal;

  /** Construye una fila alineada a la derecha con el texto dado. */
  const alineada = (texto, estilo) => (i) => {
    const desde = cols - texto.length;
    if (i < desde) return hueco();
    return bit(texto[i - desde], estilo ? estilo(i) : "");
  };

  function montar(esc) {
    const raiz = pizarra(cols, esc);
    const fA = fila("multiplicando", cols, alineada(a));
    filaB = fila("× multiplicador", cols, alineada(b));
    raiz.append(fA.fila, filaB.fila, regla());

    filasParciales = pasos.map((p) => {
      const f = p.parcial === null
        ? fila(`bit ${p.pos} = 0`, cols, (i) => (i === cols - 1 ? bit("0", "relleno") : hueco()))
        : fila(`bit ${p.pos} = 1`, cols, alineada(p.parcial, (i) => (i >= cols - p.pos ? "relleno" : "")));
      f.fila.classList.add("oculta");
      raiz.appendChild(f.fila);
      return f;
    });

    raiz.appendChild(regla());
    const fT = fila("total", cols, pendiente);
    raiz.appendChild(fT.fila);
    celdasTotal = fT.celdas;
  }

  function pintar(k) {
    filasParciales.forEach((f, i) => {
      f.fila.classList.toggle("oculta", i > k);
      f.celdas.forEach((c) => c.classList.toggle("nuevo", i === k && c.classList.contains("uno")));
    });
    filaB.celdas.forEach((c) => c.classList.remove("activa"));
    const marca = filaB.celdas[cols - 1 - k];
    if (marca) marca.classList.add("activa");

    const total = pasos[k].acumulado;
    const desde = cols - total.length;
    celdasTotal.forEach((c, i) => {
      if (i < desde) { c.className = "bit hueco"; c.textContent = ""; }
      else poner(c, total[i - desde], false);
    });
  }

  function leyenda(k) {
    const p = pasos[k];
    const fin = k === pasos.length - 1 ? " Este es el resultado final." : "";
    if (p.parcial === null) {
      return `El bit <b>${p.pos}</b> del multiplicador es <b>0</b>: no se suma nada. Acumulado: <b>${p.acumulado}</b>.${fin}`;
    }
    const ceros = p.pos === 0 ? "sin ceros" : `${p.pos} cero${p.pos > 1 ? "s" : ""}`;
    return `El bit <b>${p.pos}</b> del multiplicador es <b>1</b>: copio el multiplicando y le agrego ${ceros} a la derecha → <b>${p.parcial}</b>. `
      + `Se suma al acumulado: <b>${p.acumulado}</b>.${fin}`;
  }

  return { total: pasos.length, montar, pintar, leyenda };
}

/* ---------- División larga en formato "casita" ---------------------------
   Se dibuja como en el cuaderno:

            cociente →     0 1 1            (arriba, sobre el dividendo)
           ┌───────────
      110  │ 1 0 1 1        dividendo
           │ 1 1 0          ← producto (divisor × bit del cociente)
           │ ─────
           │   1 0 1        ← residuo (+ el bit que "bajamos")

   Hay un bloque (producto, línea, residuo) por cada bit 1 del cociente. */
function simDivision(res) {
  const d = res.detalle;
  const { a, b } = d;
  const pasos = d.pasos;
  const n = a.length, m = b.length;

  // Un bloque por cada paso donde se restó. Cada uno ocupa 3 filas de la rejilla.
  const bloques = [];
  pasos.forEach((p, i) => { if (p.resta) bloques.push({ i, L: p.parcial.length, residuo: p.residuo }); });
  bloques.forEach((bl, j) => {
    bl.hasta = j + 1 < bloques.length ? bloques[j + 1].i : n - 1;   // hasta qué columna se "bajan" bits
    bl.fila = 3 + j * 3;
  });
  const primerUno = pasos.findIndex((p) => p.bit_cociente === "1");

  let raiz, celdasA, celdasQ;

  /** Coloca un nodo en la rejilla: fila `f`, columna de bit `c` (0 = primer bit del dividendo). */
  function colocar(nodo, f, c, ancho = 1) {
    nodo.style.gridRow = String(f);
    nodo.style.gridColumn = ancho > 1 ? `${c + 2} / span ${ancho}` : String(c + 2);
    raiz.appendChild(nodo);
    return nodo;
  }
  const rotulo = (texto, f, col, extra = "") => {
    const r = el("span", `rotulo ${extra}`); r.textContent = texto;
    r.style.gridRow = String(f); r.style.gridColumn = String(col);
    raiz.appendChild(r);
    return r;
  };

  function montar(esc) {
    raiz = el("div", "casita");
    raiz.style.setProperty("--n", n);
    raiz.style.setProperty("--w", `${calcularAncho(n + m, 130, 40)}px`);
    esc.appendChild(raiz);

    // Fila 1: cociente arriba. Fila 2: divisor | dividendo.
    rotulo("divisor", 1, 1, "izq");
    celdasQ = Array.from({ length: n }, (_, c) => colocar(pendiente(), 1, c));
    rotulo("cociente", 1, n + 2);

    const caja = el("div", "divisor");
    [...b].forEach((c) => caja.appendChild(bit(c)));
    caja.style.gridRow = "2"; caja.style.gridColumn = "1";
    raiz.appendChild(caja);
    colocar(el("div", "techo"), 2, 0, n);
    celdasA = [...a].map((c, i) => colocar(bit(c, "dv"), 2, i));
    rotulo("dividendo", 2, n + 2);

    // Bloques de trabajo (ocultos hasta que les toque)
    bloques.forEach((bl) => {
      const { i, L } = bl;
      const ini = i - L + 1;
      const divisor = b.padStart(L, "0");
      const resid = bl.residuo.padStart(L, "0");

      bl.prod = [...divisor].map((c, t) => colocar(bit(c, c === "0" && t < L - m ? "relleno" : ""), bl.fila, ini + t));
      bl.rProd = rotulo("− divisor", bl.fila, n + 2);
      bl.linea = colocar(el("div", "linea-c"), bl.fila + 1, ini, L);

      bl.resto = {};                                   // columna → celda (restos y bits bajados)
      [...resid].forEach((c, t) => {
        bl.resto[ini + t] = colocar(bit(c, t < L - bl.residuo.length ? "relleno" : ""), bl.fila + 2, ini + t);
      });
      for (let c = i + 1; c <= bl.hasta; c++) {
        bl.resto[c] = colocar(bit(a[c], "bajado"), bl.fila + 2, c);
      }
      bl.rResto = rotulo("residuo", bl.fila + 2, n + 2);
      bl.nodos = [...bl.prod, bl.rProd, bl.linea, bl.rResto, ...Object.values(bl.resto)];
    });
  }

  function pintar(k) {
    // Cociente: los bits ya calculados; los ceros de la izquierda se atenúan.
    celdasQ.forEach((c, i) => {
      if (i > k) { c.className = "bit pendiente"; c.textContent = ""; return; }
      poner(c, pasos[i].bit_cociente, i === k);
      if (primerUno === -1 || i < primerUno) c.classList.add("relleno");
    });
    // Dividendo: los bits que aún no se "bajan" se ven tenues.
    celdasA.forEach((c, i) => {
      c.className = `bit dv${a[i] === "1" ? " uno" : ""}${i > k ? " tenue" : ""}`;
    });

    let ultimo = null;                                  // el bloque más reciente que ya apareció
    bloques.forEach((bl) => {
      const visible = bl.i <= k;
      bl.nodos.forEach((nodo) => { nodo.classList.remove("nuevo", "fuera", "activa", "resfinal"); });
      if (!visible) { bl.nodos.forEach((nodo) => nodo.classList.add("fuera")); return; }
      // los bits "bajados" aparecen uno por uno, en el paso que les toca
      Object.entries(bl.resto).forEach(([col, celda]) => {
        if (Number(col) > k) celda.classList.add("fuera");
      });
      if (bl.i === k) bl.nodos.forEach((x) => { if (!x.classList.contains("fuera")) x.classList.add("nuevo"); });
      else if (bl.resto[k]) bl.resto[k].classList.add("nuevo");   // el bit que se acaba de "bajar"
      ultimo = bl;
    });

    // Resalta el número con el que se trabaja en este paso (el "parcial").
    const p = pasos[k];
    const previo = bloques.filter((bl) => bl.i < k).pop();
    const fila = previo ? previo.resto : Object.fromEntries(celdasA.map((c, i) => [i, c]));
    for (let c = k - p.parcial.length + 1; c <= k; c++) if (fila[c]) fila[c].classList.add("activa");

    // Al final, el residuo se marca en verde.
    if (k === pasos.length - 1) {
      const finalFila = bloques.length ? bloques[bloques.length - 1].resto : Object.fromEntries(celdasA.map((c, i) => [i, c]));
      for (let c = n - res.residuo.length; c < n; c++) if (finalFila[c]) finalFila[c].classList.add("resfinal");
    }

    verEnEscenario((ultimo && ultimo.resto[k]) || celdasA[k]);
  }

  function leyenda(k) {
    const p = pasos[k];
    const fin = k === pasos.length - 1 ? ` Fin: cociente <b>${res.resultado}</b>, residuo <b>${res.residuo}</b>.` : "";
    return p.resta
      ? `Bajo el bit <b>${p.bit}</b>: el número con el que trabajo es <b>${p.parcial}</b>. Como ${p.parcial} &ge; ${b}, el divisor <b>sí cabe</b>: `
        + `escribo <b>1</b> arriba, pongo ${b} debajo y resto: ${p.parcial} − ${b} = <b>${p.residuo}</b>.${fin}`
      : `Bajo el bit <b>${p.bit}</b>: el número con el que trabajo es <b>${p.parcial}</b>. Como ${p.parcial} &lt; ${b}, el divisor <b>no cabe</b>: `
        + `escribo <b>0</b> arriba y no resto nada.${fin}`;
  }

  return { total: pasos.length, montar, pintar, leyenda };
}

/** Desplaza el escenario (si hace falta) para que `nodo` quede a la vista, sin mover toda la página. */
function verEnEscenario(nodo) {
  const caja = $("escenario");
  if (!nodo || !caja) return;
  const r = nodo.getBoundingClientRect(), c = caja.getBoundingClientRect();
  if (r.bottom > c.bottom - 8) caja.scrollTop += r.bottom - c.bottom + 20;
  else if (r.top < c.top + 8) caja.scrollTop -= c.top - r.top + 20;
}

/* ---------- Controlador de la simulación ---------------------------------- */
function construirSimulacion(res) {
  switch (res.detalle.tipo) {
    case "suma":
    case "resta": return simColumnas(res);
    case "multiplicacion": return simMultiplicacion(res);
    default: return simDivision(res);
  }
}

function montarSimulacion(res) {
  detenerSimulacion();
  const esc = $("escenario");
  esc.innerHTML = "";
  try {
    sim.ins = construirSimulacion(res);
    sim.ins.montar(esc);
  } catch (error) {
    // Si la animación fallara, el resultado numérico sigue siendo válido.
    console.error("No se pudo construir la simulación:", error);
    sim.ins = null;
    esc.innerHTML = '<p class="vacio-texto">No se pudo animar esta operación, pero el resultado es correcto.</p>';
    actualizarControles();
    return;
  }

  $("barra").max = sim.ins.total - 1;
  if ($("auto").checked) {
    irAPaso(0);
    reproducir();
  } else {
    irAPaso(sim.ins.total - 1);                // sin autoplay: se muestra el final
  }
}

function detenerSimulacion() {
  pausar();
  sim.ins = null;
  sim.k = 0;
}

function irAPaso(k, celebrar = false) {
  if (!sim.ins) return;
  sim.k = Math.max(0, Math.min(sim.ins.total - 1, k));
  sim.ins.pintar(sim.k);
  $("leyenda").innerHTML = sim.ins.leyenda(sim.k);
  $("barra").value = sim.k;
  $("contador").textContent = `Paso ${sim.k + 1} de ${sim.ins.total}`;
  actualizarControles();
  if (celebrar && sim.k === sim.ins.total - 1) confeti();   // llegaste al final avanzando
}

/** Lluvia de confeti al terminar la simulación (se omite si el sistema pide menos movimiento). */
function confeti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tarjeta = document.querySelector(".simulacion");
  const capa = el("div", "confeti");
  const colores = ["#ff6b6b", "#ffb84c", "#34d399", "#60a5fa", "#a78bfa", "#f472b6"];
  for (let i = 0; i < 34; i++) {
    const trozo = el("i");
    trozo.style.left = `${10 + Math.random() * 80}%`;
    trozo.style.background = colores[i % colores.length];
    trozo.style.animationDelay = `${Math.random() * 0.35}s`;
    trozo.style.setProperty("--dx", `${(Math.random() - 0.5) * 220}px`);
    capa.appendChild(trozo);
  }
  tarjeta.appendChild(capa);
  setTimeout(() => capa.remove(), 2600);
}

function actualizarControles() {
  const hay = sim.ins !== null;
  const ultimo = hay && sim.k >= sim.ins.total - 1;
  $("btn-inicio").disabled = !hay || sim.k === 0;
  $("btn-atras").disabled = !hay || sim.k === 0;
  $("btn-adelante").disabled = !hay || ultimo;
  $("btn-play").disabled = !hay;
  $("barra").disabled = !hay;
}

function iconoPlay(mostrarPlay) {
  const boton = $("btn-play");
  boton.innerHTML = mostrarPlay ? ICONO_PLAY : ICONO_PAUSA;
  boton.setAttribute("aria-label", mostrarPlay ? "Reproducir" : "Pausar");
}

function reproducir() {
  if (!sim.ins) return;
  if (sim.k >= sim.ins.total - 1) irAPaso(0);
  iconoPlay(false);
  programarSiguiente();
}

function programarSiguiente() {
  sim.timer = setTimeout(() => {
    if (!sim.ins) return;
    irAPaso(sim.k + 1, true);
    if (sim.k >= sim.ins.total - 1) pausar();
    else programarSiguiente();
  }, Number($("velocidad").value));
}

function pausar() {
  clearTimeout(sim.timer);
  sim.timer = null;
  iconoPlay(true);
}

/* ==========================================================================
   7. HISTORIAL (se guarda en el navegador con localStorage)
   ========================================================================== */
function cargarHistorial() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_HISTORIAL) || "[]");
    if (Array.isArray(guardado)) estado.historial = guardado.slice(0, MAX_HISTORIAL);
  } catch (error) {
    estado.historial = [];                     // sin localStorage: simplemente no se guarda
  }
  pintarHistorial();
}

function guardarHistorial() {
  try { localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(estado.historial)); }
  catch (error) { /* modo privado o disco lleno: se ignora */ }
}

function agregarHistorial(res) {
  estado.historial.unshift({
    operacion: res.operacion, simbolo: res.simbolo, a: res.a, b: res.b,
    resultado: res.resultado, residuo: res.residuo,
  });
  estado.historial.length = Math.min(estado.historial.length, MAX_HISTORIAL);
  guardarHistorial();
  pintarHistorial();
}

function pintarHistorial() {
  const lista = $("lista-historial");
  lista.innerHTML = "";
  if (estado.historial.length === 0) {
    lista.appendChild(el("li", "vacio-texto", "Tus operaciones aparecerán aquí. Haz clic en una para repetirla."));
    return;
  }
  const colores = {
    suma: "linear-gradient(135deg,#059669,#84cc16)", resta: "linear-gradient(135deg,#e11d48,#f472b6)",
    multiplicacion: "linear-gradient(135deg,#6d28d9,#3b82f6)", division: "linear-gradient(135deg,#d97706,#f97316)",
  };
  estado.historial.forEach((h) => {
    const li = el("li");
    const boton = el("button");
    boton.type = "button";
    const sello = el("span", "sello");
    sello.style.background = colores[h.operacion] || "#999";
    sello.textContent = h.simbolo;
    const operacion = el("span", "op-texto");
    operacion.textContent = `${h.a} ${h.simbolo} ${h.b}`;
    const resultado = el("span", "res");
    resultado.textContent = `= ${h.resultado}${h.residuo !== null && h.residuo !== undefined ? `  (r ${h.residuo})` : ""}`;
    boton.append(sello, operacion, resultado);
    boton.addEventListener("click", () => cargarOperacion(h.operacion, h.a, h.b));
    li.appendChild(boton);
    lista.appendChild(li);
  });
}

function cargarOperacion(operacion, a, b) {
  elegirOperacion(operacion);
  $("entrada-a").value = a;
  $("entrada-b").value = b;
  actualizarVista("a");
  actualizarVista("b");
  enviarCalculo();
}

/* ==========================================================================
   9. TEXTO ↔ BINARIO (código ASCII)
   Cada letra tiene un número (su código ASCII) y ese número se guarda con 8 bits.
   Aquí solo se pide y se dibuja: la conversión la hace conversion_texto.py.
   ========================================================================== */
const conv = {
  modo: "texto_a_binario", ultima: null, sel: 0, tabla: null, grupo: 0,
  temporizador: null, peticion: 0, maxCaracteres: 100, placeholder: "",
};

const MODOS_CONV = {
  texto_a_binario: {
    titulo: "Escribe una letra, palabra o frase",
    placeholder: "Hola mundo",
    ayuda: "Los espacios también cuentan: cada espacio es un carácter más (código 32).",
    salida: "Binario",
    ejemplos: [
      { etiqueta: "A", valor: "A" },
      { etiqueta: "Hola mundo", valor: "Hola mundo" },
      { etiqueta: "México 2026", valor: "México 2026" },
      { etiqueta: "¡Qué tal!", valor: "¡Qué tal!" },
    ],
  },
  binario_a_texto: {
    titulo: "Escribe los bytes en binario",
    placeholder: "01001000 01101111 01101100 01100001",
    ayuda: "8 bits por letra, separados con espacios (o pegados). Ejemplo: 00100000 es un espacio.",
    salida: "Texto",
    ejemplos: [
      { etiqueta: "«Hola»", valor: "01001000 01101111 01101100 01100001" },
      { etiqueta: "«Hola mundo»", valor: "01001000 01101111 01101100 01100001 00100000 01101101 01110101 01101110 01100100 01101111" },
      { etiqueta: "«ASCII»", valor: "01000001 01010011 01000011 01001001 01001001" },
    ],
  },
};

const TIPOS = {
  mayuscula: "letra mayúscula", minuscula: "letra minúscula", numero: "dígito",
  espacio: "espacio", signo: "signo", extendido: "ASCII extendido",
};

/** Escapa < > & para poder meter texto del usuario dentro de innerHTML sin riesgos. */
const esc = (t) => String(t).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

/* ---------- Cambiar entre Aritmética y Texto ↔ Binario -------------------- */
function cambiarVista(vista) {
  const texto = vista === "texto";
  document.body.dataset.vista = texto ? "texto" : "aritmetica";
  $("vista-aritmetica").hidden = texto;
  $("vista-texto").hidden = !texto;
  document.querySelectorAll(".modo").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.vista === vista)));
  if (texto) {
    pausar();                                         // detiene la animación de la otra sección
    if (!conv.tabla) cargarTablaAscii();
    $("entrada-texto").focus();
  }
}

function elegirModoConversion(modo, conservarTexto = false) {
  conv.modo = modo;
  const cfg = MODOS_CONV[modo];
  document.querySelectorAll("#selector-conversion .opcion").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.modo === modo)));
  $("pastilla-conv").style.transform = `translateX(${modo === "texto_a_binario" ? 0 : 100}%)`;
  $("titulo-texto").textContent = cfg.titulo;
  $("ayuda-texto").textContent = cfg.ayuda;
  $("etq-salida").textContent = cfg.salida;
  const entrada = $("entrada-texto");
  entrada.placeholder = cfg.placeholder;
  entrada.maxLength = modo === "texto_a_binario" ? conv.maxCaracteres : conv.maxCaracteres * 9;

  const caja = $("ejemplos-texto");
  caja.innerHTML = "<span>Prueba con</span>";
  cfg.ejemplos.forEach((ej) => {
    const chip = el("button", "chip conv");
    chip.type = "button";
    chip.textContent = ej.etiqueta;
    chip.addEventListener("click", () => {
      entrada.value = ej.valor;
      actualizarAvisoTexto();
      enviarConversion(true);
    });
    caja.appendChild(chip);
  });

  if (!conservarTexto) { entrada.value = ""; limpiarConversion(); }
  actualizarAvisoTexto();
}

/* ---------- Ayuda en vivo mientras se escribe ----------------------------- */
function actualizarAvisoTexto() {
  const entrada = $("entrada-texto");
  const valor = entrada.value;
  const caja = $("frase-texto");
  entrada.classList.remove("valida", "invalida");

  if (conv.modo === "texto_a_binario") {
    const n = [...valor].length;                      // [...texto] cuenta letras reales (no mitades de emoji)
    const espacios = [...valor].filter((c) => c === " ").length;
    caja.innerHTML = n === 0
      ? "Cada carácter ocupa <b>8 bits</b>, incluidos los espacios. Escribe algo y aquí verás cuántos bits son."
      : `<b>${n}</b> carácter${n === 1 ? "" : "es"} × 8 = <b>${n * 8} bits</b>`
        + (espacios ? ` (${espacios} espacio${espacios === 1 ? "" : "s"} incluido${espacios === 1 ? "" : "s"}).` : ".");
    return;
  }

  // Esta revisión es solo VISUAL; la validación real la hace el servidor.
  const grupos = valor.trim().split(/\s+/).filter(Boolean);
  const bits = grupos.join("").length;
  if (bits === 0) {
    caja.innerHTML = "Escribe los <b>8 bits</b> de cada letra. Los espacios solo sirven para separar una letra de otra.";
    return;
  }
  const malo = /[^01\s]/.test(valor);
  entrada.classList.add(malo ? "invalida" : "valida");
  caja.innerHTML = malo
    ? "Solo se permiten <b>0</b> y <b>1</b> (y espacios para separar)."
    : `<b>${bits}</b> bits en <b>${grupos.length}</b> grupo${grupos.length === 1 ? "" : "s"}.`;
}

function alEscribirTexto() {
  actualizarAvisoTexto();
  ocultarErrorTexto();
  clearTimeout(conv.temporizador);
  if (conv.modo !== "texto_a_binario") return;        // binario → texto se convierte con el botón / Enter
  if ($("entrada-texto").value === "") { limpiarConversion(); return; }
  conv.temporizador = setTimeout(() => enviarConversion(false), 250);   // convierte mientras escribes
}

/* ---------- Comunicación con Python ---------------------------------- */
async function enviarConversion(irAlResultado = false) {
  clearTimeout(conv.temporizador);
  ocultarErrorTexto();
  const peticion = { modo: conv.modo, texto: $("entrada-texto").value };
  const numero = ++conv.peticion;                     // si llega una respuesta vieja, se ignora

  let respuesta, datos;
  try {
    respuesta = await apiFetch(RUTAS.convertir, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(peticion),
    });
  } catch (error) {
    marcarServidor(false);
    mostrarErrorTexto("No se pudo ejecutar Python en el navegador. Recarga la página (la primera vez necesita internet).");
    return;
  }
  marcarServidor(true);
  try {
    datos = await respuesta.json();
  } catch (error) {
    mostrarErrorTexto("Python respondió algo que no se pudo entender.");
    return;
  }
  if (numero !== conv.peticion) return;               // ya hay una petición más reciente

  if (!datos.ok) {
    limpiarConversion(false);
    mostrarErrorTexto(datos.error?.mensaje ?? "Ocurrió un error desconocido.");
    return;
  }
  mostrarConversion(datos.conversion);
  if (irAlResultado && window.innerWidth <= 980) {
    document.querySelector(".resultado-texto").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function mostrarErrorTexto(mensaje) {
  const caja = $("error-texto");
  caja.textContent = mensaje;                         // textContent: nunca interpreta HTML
  caja.hidden = false;
}
function ocultarErrorTexto() { $("error-texto").hidden = true; }

/* ---------- Dibujar el resultado ------------------------------------------ */
function limpiarConversion(borrarError = true) {
  conv.ultima = null;
  $("banda-texto").hidden = true;
  $("nota-texto").hidden = true;
  $("desglose").hidden = true;
  $("cont-chars").textContent = "";
  if (!conv.placeholder) conv.placeholder = $("tabla-conv").innerHTML;
  $("tabla-conv").innerHTML = conv.placeholder;
  if (borrarError) ocultarErrorTexto();
}

function mostrarConversion(c) {
  conv.ultima = c;
  const n = c.caracteres.length;
  $("cont-chars").textContent = `${n} carácter${n === 1 ? "" : "es"} · ${n * 8} bits`;

  $("banda-texto").hidden = false;
  const salida = $("salida-texto");
  salida.classList.toggle("texto", c.modo === "binario_a_texto");
  salida.textContent = c.modo === "texto_a_binario" ? c.binario : c.texto;

  const notas = [];
  if (c.hay_extendidos) notas.push("Las letras como ñ o á no están en el ASCII original (0–127): aquí se usa el ASCII extendido (Latin-1), que también cabe en 8 bits.");
  if (c.relleno) notas.push("Algunos grupos tenían menos de 8 bits: se completaron con ceros a la izquierda.");
  const nota = $("nota-texto");
  nota.hidden = notas.length === 0;
  nota.textContent = notas.join(" ");

  pintarTablaConversion(c);
  mostrarDesglose(0);
}

/** Tabla Letra | Decimal ASCII | Binario (8 bits): una fila por letra. */
function pintarTablaConversion(c) {
  const tabla = $("tabla-conv");
  tabla.innerHTML = "";
  tabla.appendChild(el("div", "fila-conv cab", "<span>Letra</span><span>Decimal</span><span>Binario (8 bits)</span>"));
  c.caracteres.forEach((ch, i) => {
    const fila = el("button", "fila-conv");
    fila.type = "button";
    fila.dataset.i = i;
    fila.style.setProperty("--i", Math.min(i, 14));
    const letra = el("span", ch.tipo === "espacio" ? "c-letra esp" : "c-letra");
    letra.textContent = ch.tipo === "espacio" ? "␣ espacio" : ch.visible;
    const dec = el("span", "c-dec");
    dec.textContent = ch.decimal;
    const bits = el("span", "c-bits");
    [...ch.binario].forEach((b) => bits.appendChild(bit(b)));
    fila.append(letra, dec, bits);
    fila.addEventListener("click", () => mostrarDesglose(i));
    tabla.appendChild(fila);
  });
}

/** Panel con el "por qué": cada peso (128, 64, 32...) y si el bit vale 1 o 0. */
function mostrarDesglose(i) {
  const c = conv.ultima;
  if (!c || !c.caracteres[i]) return;
  const ch = c.caracteres[i];
  conv.sel = i;
  document.querySelectorAll("#tabla-conv .fila-conv.sel").forEach((x) => x.classList.remove("sel"));
  const fila = document.querySelector(`#tabla-conv .fila-conv[data-i="${i}"]`);
  if (fila) fila.classList.add("sel");

  const alReves = c.modo === "binario_a_texto";
  const nombre = ch.tipo === "espacio" ? "el espacio" : `«${esc(ch.caracter)}»`;
  const caja = $("desglose");
  caja.hidden = false;
  caja.innerHTML = "";

  const cabeza = el("div", "cabeza");
  const grande = el("div", ch.tipo === "espacio" ? "grande espacio" : "grande");
  grande.textContent = ch.visible;
  const frase = el("p");
  frase.innerHTML = alReves
    ? `El byte <b>${ch.binario}</b> vale <b>${ch.decimal}</b>, y ese número es la letra ${nombre}.`
    : `${nombre[0].toUpperCase() + nombre.slice(1)} tiene el código ASCII <b>${ch.decimal}</b>, que en 8 bits se escribe <b>${ch.binario}</b>.`;
  frase.appendChild(el("span", "etiqueta-tipo", TIPOS[ch.tipo] || ""));
  cabeza.append(grande, frase);

  // Cuadrícula: peso / bit / lo que queda (o lo que se lleva sumado)
  const rejilla = el("div", "pesos");
  const fila1 = [el("span", "rot", "peso")], fila2 = [el("span", "rot", "bit")];
  const fila3 = [el("span", "rot", alReves ? "suma" : "queda")];
  ch.desglose.forEach((paso) => {
    const peso = el("span", "peso"); peso.textContent = paso.peso;
    const dato = el("span", `queda${paso.bit ? " on" : " cero"}`);
    dato.textContent = alReves ? paso.suma : paso.queda;
    fila1.push(peso); fila2.push(bit(String(paso.bit))); fila3.push(dato);
  });
  rejilla.append(...fila1, ...fila2, ...fila3);

  const encendidos = ch.desglose.filter((p) => p.bit === 1).map((p) => p.peso);
  const suma = el("div", "suma");
  suma.textContent = alReves
    ? `${encendidos.join(" + ")} = ${ch.decimal}`
    : `${ch.decimal} = ${encendidos.join(" + ")}`;
  const como = el("p", "como", alReves
    ? "Cada <b>1</b> suma el peso de su posición; cada <b>0</b> no suma nada."
    : "De izquierda a derecha: si el peso <b>cabe</b> en lo que queda, escribo <b>1</b> y se lo resto; si no cabe, escribo <b>0</b>.");

  caja.append(cabeza, rejilla, suma, como);
}

/* ---------- Botones de la sección ----------------------------------------- */
function invertirConversion() {
  const otro = conv.modo === "texto_a_binario" ? "binario_a_texto" : "texto_a_binario";
  const previo = conv.ultima;
  const valor = previo ? (conv.modo === "texto_a_binario" ? previo.binario : previo.texto) : "";
  elegirModoConversion(otro, true);
  $("entrada-texto").value = valor;
  actualizarAvisoTexto();
  if (valor) enviarConversion(true); else limpiarConversion();
}

async function copiarConversion() {
  const boton = $("btn-copiar-conv");
  const c = conv.ultima;
  if (!c) return;
  try {
    await navigator.clipboard.writeText(c.modo === "texto_a_binario" ? c.binario : c.texto);
    boton.textContent = "¡Copiado!";
  } catch (error) {
    boton.textContent = "No se pudo copiar";
  }
  setTimeout(() => { boton.textContent = "Copiar"; }, 1500);
}

/* ---------- Tabla ASCII de referencia ------------------------------------- */
async function cargarTablaAscii() {
  try {
    const respuesta = await apiFetch(RUTAS.tablaAscii);
    const datos = await respuesta.json();
    conv.tabla = datos.grupos;
  } catch (error) {
    $("tabla-ascii").innerHTML = '<p class="vacio-texto">No se pudo cargar la tabla (Python no cargó; recarga la página).</p>';
    return;
  }
  pintarGruposAscii();
  pintarTablaAscii();
}

function pintarGruposAscii() {
  const caja = $("grupos-ascii");
  caja.innerHTML = "";
  conv.tabla.forEach((g, i) => {
    const boton = el("button");
    boton.type = "button";
    boton.textContent = g.nombre;
    boton.setAttribute("aria-selected", String(i === conv.grupo));
    boton.addEventListener("click", () => { conv.grupo = i; pintarGruposAscii(); pintarTablaAscii(); });
    caja.appendChild(boton);
  });
}

function pintarTablaAscii() {
  const tabla = $("tabla-ascii");
  tabla.innerHTML = "";
  tabla.appendChild(el("div", "fila-conv cab", "<span>Letra</span><span>Dec.</span><span>Binario</span>"));
  conv.tabla[conv.grupo].filas.forEach((f) => {
    const fila = el("button", "fila-conv");
    fila.type = "button";
    fila.title = `Usar ${f.caracter === " " ? "el espacio" : f.caracter}`;
    const letra = el("span", f.tipo === "espacio" ? "c-letra esp" : "c-letra");
    letra.textContent = f.tipo === "espacio" ? "␣" : f.visible;
    const dec = el("span", "c-dec"); dec.textContent = f.decimal;
    const bits = el("span", "c-bits"); bits.textContent = f.binario;
    fila.append(letra, dec, bits);
    fila.addEventListener("click", () => usarFilaAscii(f));
    tabla.appendChild(fila);
  });
}

/** Al tocar una fila de la tabla: agrega esa letra (o su binario) a la entrada y convierte. */
function usarFilaAscii(f) {
  const entrada = $("entrada-texto");
  if (conv.modo === "texto_a_binario") entrada.value += f.caracter;
  else entrada.value = (entrada.value.trim() ? entrada.value.trim() + " " : "") + f.binario;
  actualizarAvisoTexto();
  enviarConversion(false);
  entrada.focus();
}

function enlazarEventosTexto() {
  document.querySelectorAll(".modo").forEach((b) =>
    b.addEventListener("click", () => cambiarVista(b.dataset.vista)));
  document.querySelectorAll("#selector-conversion .opcion").forEach((b) =>
    b.addEventListener("click", () => elegirModoConversion(b.dataset.modo)));
  $("entrada-texto").addEventListener("input", alEscribirTexto);
  $("entrada-texto").addEventListener("keydown", (e) => { if (e.key === "Enter") enviarConversion(true); });
  $("btn-convertir").addEventListener("click", () => enviarConversion(true));
  $("btn-invertir").addEventListener("click", invertirConversion);
  $("btn-copiar-conv").addEventListener("click", copiarConversion);
  $("btn-limpiar-texto").addEventListener("click", () => {
    $("entrada-texto").value = "";
    limpiarConversion();
    actualizarAvisoTexto();
    $("entrada-texto").focus();
  });
}

/* ==========================================================================
   8. ACCIONES DE LOS BOTONES
   ========================================================================== */
function limpiar() {
  $("entrada-a").value = "";
  $("entrada-b").value = "";
  actualizarVista("a");
  actualizarVista("b");
  ocultarError();
  limpiarResultado();
  $("entrada-a").focus();
}

function intercambiar() {
  const a = $("entrada-a").value;
  $("entrada-a").value = $("entrada-b").value;
  $("entrada-b").value = a;
  actualizarVista("a");
  actualizarVista("b");
}

async function copiarResultado() {
  const boton = $("btn-copiar");
  const texto = $("resultado-bits").textContent.replace(/−/g, "-");
  try {
    await navigator.clipboard.writeText(texto);
    boton.textContent = "¡Copiado!";
  } catch (error) {
    boton.textContent = "No se pudo copiar";
  }
  setTimeout(() => { boton.textContent = "Copiar"; }, 1500);
}

function enlazarEventos() {
  enlazarEventosTexto();
  $("btn-calcular").addEventListener("click", enviarCalculo);
  $("btn-limpiar").addEventListener("click", limpiar);
  $("btn-intercambiar").addEventListener("click", intercambiar);
  $("btn-copiar").addEventListener("click", copiarResultado);
  $("btn-borrar-historial").addEventListener("click", () => {
    estado.historial = [];
    guardarHistorial();
    pintarHistorial();
  });

  ["a", "b"].forEach((lado) => {
    $(`entrada-${lado}`).addEventListener("input", () => actualizarVista(lado));
    $(`entrada-${lado}`).addEventListener("keydown", (e) => { if (e.key === "Enter") enviarCalculo(); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.dataset.vista !== "texto") limpiar();
  });

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => cargarOperacion(chip.dataset.op, chip.dataset.a, chip.dataset.b)));

  // Controles de la simulación
  $("btn-play").addEventListener("click", () => (sim.timer ? pausar() : reproducir()));
  $("btn-inicio").addEventListener("click", () => { pausar(); irAPaso(0); });
  $("btn-atras").addEventListener("click", () => { pausar(); irAPaso(sim.k - 1); });
  $("btn-adelante").addEventListener("click", () => { pausar(); irAPaso(sim.k + 1, true); });
  $("barra").addEventListener("input", (e) => { pausar(); irAPaso(Number(e.target.value)); });
}

iniciar();
